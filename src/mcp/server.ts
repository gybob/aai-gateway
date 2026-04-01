import { rm } from 'node:fs/promises';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { createConsentDialog } from '../consent/dialog/index.js';
import { ConsentManager } from '../consent/manager.js';
import { createDiscoveryManager, type DiscoveryOptions } from '../discovery/index.js';
import { AaiError } from '../errors/errors.js';
import { getAcpExecutor } from '../executors/acp.js';
import {
  legacyExecuteCli as executeCli,
  getCliExecutor,
} from '../executors/cli.js';
import { getMcpExecutor } from '../executors/mcp.js';
import type { Executor } from '../executors/interface.js';
import {
  legacyExecuteSkill as executeSkill,
  getSkillExecutor,
} from '../executors/skill.js';
import { createSecureStorage, type SecureStorage } from '../storage/secure-storage/index.js';
import type {
  AaiJson,
  McpConfig,
  RuntimeAppRecord,
} from '../types/aai-json.js';
import {
  getLocalizedName,
  isAcpAgentAccess,
  isCliAccess,
  isMcpAccess,
  isSkillAccess,
} from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';
import { logger } from '../utils/logger.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';

import {
  generateAppGuideMarkdown,
  generateGuideToolSummary,
} from '../guides/app-guide-generator.js';
import { generateSkillCreateGuide } from '../guides/skill-create-guide.js';
import { writeAppProxySkill, type SkillImportMode } from '../guides/skill-stub-generator.js';
import {
  buildMcpImportConfig,
  buildSkillImportSource,
  deleteImportedMcpHeaders,
  discoverMcpImport,
  EXPOSURE_LIMITS,
  IMPORT_LIMITS,
  importMcpServer,
  importSkill,
  loadImportedMcpHeaders,
  normalizeSummaryInput,
  validateImportHeaders,
} from './importer.js';
import {
  buildSearchDiscoverResponse,
  SEARCH_DISCOVER_TOOL_NAME,
  searchDiscoverInputSchema,
  parseSearchDiscoverArguments,
} from './search-guidance.js';
import type { ExecutionObserver } from '../executors/events.js';
import type { CallerContext } from '../types/caller.js';
import { createMcpCallerContext } from '../utils/caller-context.js';
import { getDotenvPath } from '../utils/dotenv.js';
import {
  deleteAppPolicyState,
  disableAppForAgent,
  enableAppForAgent,
  loadAppPolicyState,
  removeAppFromAllAgents,
  saveAgentState,
  saveAppPolicyState,
  upsertAgentState,
} from '../storage/agent-state.js';
import { getManagedAppDir } from '../storage/paths.js';
import { getMcpRegistry } from '../storage/mcp-registry.js';
import { getSkillRegistry } from '../storage/skill-registry.js';

const DOWNSTREAM_INACTIVITY_TIMEOUT_MS = 10 * 60_000;

interface GatewayToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  listInputSchema?: Record<string, unknown>;
}

export class AaiGatewayServer {
  private readonly server: Server;
  private readonly options: DiscoveryOptions;
  private readonly appRegistry = new Map<string, RuntimeAppRecord>();
  private consentManager!: ConsentManager;
  private secureStorage!: SecureStorage;
  private callerContext?: CallerContext;
  private discoveryManager?: import('../discovery/manager.js').DiscoveryManager;

  constructor(options?: DiscoveryOptions) {
    this.options = options ?? {};
    this.server = new Server(
      { name: AAI_GATEWAY_NAME, version: AAI_GATEWAY_VERSION },
      {
        capabilities: {
          tools: { listChanged: true },
          logging: {},
        },
      }
    );
    this.setupHandlers();
  }

  async initialize(): Promise<void> {
    this.secureStorage = createSecureStorage();
    this.consentManager = new ConsentManager(this.secureStorage, createConsentDialog());

    // Initialize MCP executor with secure storage for headers
    getMcpExecutor(this.secureStorage);

    // Create and use DiscoveryManager
    const { manager } = createDiscoveryManager();
    this.discoveryManager = manager;

    try {
      const discoveredApps = await this.discoveryManager.scanAll(this.options);
      for (const app of discoveredApps) {
        this.appRegistry.set(app.appId, app);
      }
      logger.info({ count: discoveredApps.length }, 'Discovery completed');
    } catch (err) {
      logger.error({ err }, 'Discovery failed');
    }

    // Eagerly pre-warm ACP agent processes so the first prompt doesn't pay
    // the full initialization + session-creation penalty (up to 90 s).
    this.prewarmAcpAgents();
  }

  setCallerContext(caller: CallerContext): void {
    this.callerContext = caller;
  }

  async listToolsForCaller(caller: CallerContext): Promise<Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>> {
    this.setCallerContext(caller);
    const visibleApps = await this.listVisibleApps(caller);
    return [
      ...visibleApps.map((app) => ({
        name: `app:${app.appId}`,
        description: generateGuideToolSummary(app.appId, app.descriptor),
        inputSchema: { type: 'object', properties: {} },
      })),
      ...buildGatewayToolDefinitions().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.listInputSchema ?? tool.inputSchema,
      })),
    ];
  }

  async getAppGuideForCaller(appIdOrUrl: string, caller: CallerContext): Promise<string> {
    this.setCallerContext(caller);
    const result = await this.handleAppGuide(appIdOrUrl, caller);
    return result.content[0]?.text ?? '';
  }

  async executeForCaller(
    appIdOrUrl: string | undefined,
    toolName: string,
    args: Record<string, unknown>,
    caller: CallerContext
  ): Promise<CallToolResult> {
    this.setCallerContext(caller);
    return this.handleExec(
      { params: { name: 'aai:exec', arguments: args } } as unknown as CallToolRequest,
      'cli',
      appIdOrUrl,
      toolName,
      args,
      caller
    );
  }

  /**
   * Pre-initializes all discovered ACP agents in the background so that the
   * `initialize` + `session/new` handshake has already finished by the time a
   * prompt request arrives.  Failures are non-fatal; the regular lazy path
   * will retry when the prompt is actually executed.
   */
  private prewarmAcpAgents(): void {
    const acpApps = Array.from(this.appRegistry.values()).filter(
      (app) => app.descriptor.access.protocol === 'acp-agent'
    );

    if (acpApps.length === 0) return;

    logger.info({ count: acpApps.length }, 'Pre-warming ACP agents');

    for (const app of acpApps) {
      const config = app.descriptor.access.config as import('../types/index.js').AcpAgentConfig;
      void getAcpExecutor()
        .connect(app.appId, config)
        .then(() => {
          logger.info({ appId: app.appId }, 'ACP agent pre-warm completed');
        })
        .catch((err) => {
          logger.warn(
            { appId: app.appId, err },
            'ACP agent pre-warm failed (will retry lazily)'
          );
        });
    }
  }

  private requireCallerContext(transport: CallerContext['transport']): CallerContext {
    if (this.callerContext) {
      return this.callerContext;
    }

    return {
      id: 'unknown-client',
      name: 'Unknown Client',
      transport,
      type: 'unknown',
    };
  }

  private async listVisibleApps(caller: CallerContext): Promise<RuntimeAppRecord[]> {
    const apps = Array.from(this.appRegistry.values());
    const enabledApps = await Promise.all(
      apps.map(async (app) => ((await this.isAppEnabledForCaller(app, caller)) ? app : null))
    );
    return enabledApps.filter((app): app is RuntimeAppRecord => app !== null);
  }

  private async listManageableApps(caller: CallerContext): Promise<Array<{
    app: RuntimeAppRecord;
    enabled: boolean;
  }>> {
    const apps = Array.from(this.appRegistry.values());
    const manageable = await Promise.all(
      apps.map(async (app) => {
        return {
          app,
          enabled: await this.isAppEnabledForCaller(app, caller),
        };
      })
    );

    return manageable.filter(
      (entry): entry is { app: RuntimeAppRecord; enabled: boolean } => entry !== null
    );
  }

  private async isAppEnabledForCaller(
    app: RuntimeAppRecord,
    caller: CallerContext
  ): Promise<boolean> {
    const agentState = await upsertAgentState({
      agentId: caller.id,
      callerName: caller.name,
      agentType: caller.type,
      skillDir: caller.skillDir,
    });

    const override = agentState.appOverrides[app.appId];
    if (override === 'enabled') {
      return true;
    }
    if (override === 'disabled') {
      return false;
    }

    const policy = await loadAppPolicyState(app.appId);
    if (!policy || policy.defaultEnabled === 'all') {
      return true;
    }

    return policy.importerAgentId === caller.id;
  }

  private setupHandlers(): void {
    this.server.oninitialized = () => {
      const clientVersion = this.server.getClientVersion();
      this.callerContext = createMcpCallerContext(clientVersion);
    };

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const visibleApps = await this.listVisibleApps(this.requireCallerContext('mcp'));
      const tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }> = visibleApps.map((app) => ({
        name: `app:${app.appId}`,
        description: generateGuideToolSummary(app.appId, app.descriptor),
        inputSchema: { type: 'object', properties: {} },
      }));

      tools.push(
        ...buildGatewayToolDefinitions().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.listInputSchema ?? tool.inputSchema,
        }))
      );

      // Cache tool schemas for validation
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: rawArgs } = request.params;
      const toolDefinition = getGatewayToolDefinition(name);
      const args = toolDefinition
        ? (normalizeArgumentsWithSchema(rawArgs, toolDefinition.inputSchema) as
            | Record<string, unknown>
            | undefined)
        : rawArgs;

      if (name.startsWith('app:')) {
        return this.handleAppGuide(name.slice(4), this.requireCallerContext('mcp'));
      }

      if (name === 'aai:exec') {
        const payload = args as {
          app?: string;
          tool: string;
          args?: Record<string, unknown>;
        };
        return this.handleExec(
          request as CallToolRequest,
          extra.requestId,
          payload.app,
          payload.tool,
          payload.args ?? {},
          this.requireCallerContext('mcp')
        );
      }

      if (name === 'mcp:import' || name === 'skill:import') {
        return this.handleGatewayToolGuide(name);
      }

      if (
        name === SEARCH_DISCOVER_TOOL_NAME ||
        name === 'listAllAaiApps' ||
        name === 'disableApp' ||
        name === 'enableApp' ||
        name === 'removeApp'
      ) {
        return this.executeGatewayTool(
          name,
          (args as Record<string, unknown> | undefined) ?? {},
          this.requireCallerContext('mcp')
        );
      }

      if (name === 'skill:create') {
        return this.handleSkillCreate();
      }

      throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
    });
  }

  private async handleAppGuide(
    appId: string,
    caller: CallerContext
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const app = await this.resolveManagedApp(appId, caller);
    if (!app) {
      throw new AaiError('UNKNOWN_APP', `App not found: ${appId}`);
    }

    const { descriptor } = app;
    const access = descriptor.access;
    const executor = this.getExecutor(access.protocol);
    const capabilities = await executor.loadAppCapabilities(appId, access.config as any);

    return {
      content: [
        {
          type: 'text',
          text: generateAppGuideMarkdown(appId, descriptor, capabilities),
        },
      ],
    };
  }

  private async handleGatewayToolGuide(toolName: string): Promise<CallToolResult> {
    const tool = getGatewayToolDefinition(toolName);
    if (!tool) {
      throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
    }

    return {
      content: [{ type: 'text', text: generateGatewayToolGuide(tool) }],
    };
  }

  // ============================================================
  // Notification helpers
  // ============================================================

  /**
   * Notify connected clients that the tool list has changed.
   * This enables hot-reload of MCP tools without requiring a restart.
   */
  private async notifyToolsListChanged(): Promise<void> {
    try {
      await this.server.sendToolListChanged();
      logger.debug('Sent tools/listChanged notification');
    } catch (error) {
      logger.error({ err: error }, 'Failed to send tools/listChanged notification');
    }
  }

  // ============================================================
  // Tool handlers
  // ============================================================

  private async handleMcpImport(
    args: Record<string, unknown> | undefined,
    caller: CallerContext
  ): Promise<CallToolResult> {
    try {
      const options = parseMcpImportArguments(args);
      logger.info(
        {
          tool: 'mcp:import',
          phase: options.metadata ? 'import' : 'inspect',
          request: summarizeMcpImportRequest(options),
        },
        'MCP import request started'
      );

      if (!options.metadata) {
        const preview = await discoverMcpImport(getMcpExecutor(), {
          name: options.name,
          config: options.config,
          headers: options.headers,
        });

        logger.info(
          {
            tool: 'mcp:import',
            phase: 'inspect',
            appId: preview.appId,
            appName: preview.name,
            toolCount: preview.tools.length,
          },
          'MCP import inspection completed'
        );

        return {
          content: [
            {
              type: 'text',
              text: [
                'MCP inspection completed. No import record has been created yet.',
                `App name: ${preview.name}`,
                '',
                'Available tools:',
                formatToolPreview(preview.tools),
                '',
                'Next step:',
                '1. Summarize when this MCP should be used.',
                `2. Confirm a summary (in English, max ${EXPOSURE_LIMITS.summaryLength} chars) with the user. Communicate in the user\'s preferred language, but the actual summary value must be English.`,
                '3. Ask the user whether this imported MCP should be enabled only for the current agent or for all agents.',
                '4. Call `mcp:import` again with the same source config plus `summary` and `enableScope`.',
              ].join('\n'),
            },
          ],
        };
      }

      const result = await importMcpServer(getMcpExecutor(), this.secureStorage, {
        name: options.name,
        config: options.config,
        headers: options.headers,
        summary: options.metadata.summary,
      });
      await saveAppPolicyState(result.entry.appId, {
        defaultEnabled: options.metadata.enableScope === 'current' ? 'importer-only' : 'all',
        importerAgentId: caller.id,
        updatedAt: new Date().toISOString(),
      });

      this.appRegistry.set(result.entry.appId, {
        appId: result.entry.appId,
        descriptor: result.descriptor,
        source: 'mcp-import',
        location: result.entry.descriptorPath,
      });

      logger.info(
        {
          tool: 'mcp:import',
          phase: 'import',
          appId: result.entry.appId,
          descriptorPath: result.entry.descriptorPath,
          toolCount: result.tools.length,
        },
        'MCP import completed'
      );

      // Notify clients that the tool list has changed (hot-reload)
      await this.notifyToolsListChanged();

      const capabilities = {
        title: 'MCP Tools',
        tools: result.tools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema ?? { type: 'object' as const, properties: {} },
        })),
      };

      return {
        content: [
          {
            type: 'text',
            text: [
              `Imported MCP app: ${result.descriptor.app.name.default}`,
              `App ID: ${result.entry.appId}`,
              `App tool prefix: app:${result.entry.appId}`,
              `Descriptor: ${result.entry.descriptorPath}`,
              `Summary: ${result.descriptor.exposure.summary}`,
              `Default enabled for: ${options.metadata.enableScope === 'current' ? 'importing agent only' : 'all agents'}`,
              ...(result.warnings ?? []),
              '✓ 新工具已可用，Agent 无需重启即可感知。',
              '',
              generateAppGuideMarkdown(result.entry.appId, result.descriptor, capabilities),
            ].join('\n'),
          },
        ],
      };
    } catch (err) {
      logger.error(
        {
          tool: 'mcp:import',
          request: summarizeRawImportArgs(args),
          err,
        },
        'MCP import failed'
      );

      if (isMissingEnvVarsError(err)) {
        return buildMissingEnvVarsResult(err);
      }

      return createToolErrorResult('MCP import failed.', err);
    }
  }

  private async handleSkillImport(
    args: Record<string, unknown> | undefined,
    caller: CallerContext
  ): Promise<CallToolResult> {
    try {
      const options = parseSkillImportArguments(args);
      logger.info(
        {
          tool: 'skill:import',
          phase: 'import',
          request: summarizeSkillImportRequest(options),
        },
        'Skill import request started'
      );

      const result = await importSkill({
        path: options.path,
      });
      await saveAppPolicyState(result.appId, {
        defaultEnabled: 'importer-only',
        importerAgentId: caller.id,
        updatedAt: new Date().toISOString(),
      });

      const agentState = await upsertAgentState({
        agentId: caller.id,
        callerName: caller.name,
        agentType: caller.type,
        skillDir: caller.skillDir,
      });

      let stubPath: string | undefined;
      if (options.importMode === 'auto') {
        if (!agentState.skillDir) {
          throw new AaiError(
            'INVALID_REQUEST',
            'Current agent does not expose a skills directory. Import the skill in manual mode or configure AAI_GATEWAY_SKILL_DIR.'
          );
        }
        stubPath = await writeAppProxySkill({
          skillsDir: agentState.skillDir,
          name: result.descriptor.app.name.default,
          appId: result.appId,
          summary: result.descriptor.exposure.summary,
          mode: 'auto',
        });
        agentState.generatedStubs[result.appId] = stubPath;
        agentState.updatedAt = new Date().toISOString();
        await saveAgentState(agentState);
      }

      this.appRegistry.set(result.appId, {
        appId: result.appId,
        descriptor: result.descriptor,
        source: 'skill-import',
        location: result.managedPath,
      });

      logger.info(
        {
          tool: 'skill:import',
          phase: 'import',
          appId: result.appId,
          managedPath: result.managedPath,
        },
        'Skill import completed'
      );

      // Notify clients that the tool list has changed (hot-reload)
      await this.notifyToolsListChanged();

      const executor = this.getExecutor(result.descriptor.access.protocol);
      let capabilities;
      try {
        capabilities = await executor.loadAppCapabilities(
          result.appId,
          result.descriptor.access.config as any
        );
      } catch {
        capabilities = {
          title: 'Skill',
          tools: [{ name: 'read', description: 'Read the skill documentation', inputSchema: { type: 'object' as const, properties: {} } }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `Imported skill: ${result.descriptor.app.name.default}`,
              `App ID: ${result.appId}`,
              `App tool name after restart: app:${result.appId}`,
              `Skill directory: ${result.managedPath}`,
              `Summary: ${result.descriptor.exposure.summary}`,
              'Default enabled for: importing agent only',
              `Current-agent trigger mode: ${options.importMode}`,
              ...(stubPath ? [`Generated proxy skill: ${stubPath}`] : []),
              '✓ 新工具已可用，Agent 无需重启即可感知。',
              '',
              generateAppGuideMarkdown(result.appId, result.descriptor, capabilities),
            ].join('\n'),
          },
        ],
      };
    } catch (err) {
      logger.error(
        {
          tool: 'skill:import',
          request: summarizeRawImportArgs(args),
          err,
        },
        'Skill import failed'
      );
      return createToolErrorResult('Skill import failed.', err);
    }
  }

  private async handleSkillCreate(): Promise<CallToolResult> {
    return {
      content: [
        {
          type: 'text',
          text: generateSkillCreateGuide(),
        },
      ],
    };
  }

  private async handleSearchDiscover(
    args: Record<string, unknown> | undefined
  ): Promise<CallToolResult> {
    try {
      parseSearchDiscoverArguments(args);
      return {
        content: [
          {
            type: 'text',
            text: buildSearchDiscoverResponse(),
          },
        ],
      };
    } catch (err) {
      throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
    }
  }

  private async handleListAllApps(caller: CallerContext): Promise<CallToolResult> {
    const apps = await this.listManageableApps(caller);
    const payload = {
      apps: apps.map(({ app, enabled }) => ({
        app: app.appId,
        name: app.descriptor.app.name.default,
        summary: app.descriptor.exposure.summary,
        source: app.source,
        enabled,
        removable: app.source === 'mcp-import' || app.source === 'skill-import',
      })),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
      structuredContent: payload,
    };
  }

  private async handleDisableApp(
    args: Record<string, unknown> | undefined,
    caller: CallerContext
  ): Promise<CallToolResult> {
    const appId = typeof args?.app === 'string' ? args.app.trim() : '';
    if (!appId) {
      throw new AaiError('INVALID_REQUEST', "disableApp requires 'app'");
    }

    await this.resolveManageableApp(appId);
    await disableAppForAgent(caller.id, appId);
    await this.notifyToolsListChanged();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              app: appId,
              disabledFor: caller.id,
            },
            null,
            2
          ),
        },
      ],
      structuredContent: {
        app: appId,
        disabledFor: caller.id,
      },
    };
  }

  private async handleEnableApp(
    args: Record<string, unknown> | undefined,
    caller: CallerContext
  ): Promise<CallToolResult> {
    const appId = typeof args?.app === 'string' ? args.app.trim() : '';
    if (!appId) {
      throw new AaiError('INVALID_REQUEST', "enableApp requires 'app'");
    }

    await this.resolveManageableApp(appId);
    await enableAppForAgent(caller.id, appId);
    await this.notifyToolsListChanged();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              app: appId,
              enabledFor: caller.id,
            },
            null,
            2
          ),
        },
      ],
      structuredContent: {
        app: appId,
        enabledFor: caller.id,
      },
    };
  }

  private async handleRemoveApp(
    args: Record<string, unknown> | undefined,
    _caller: CallerContext
  ): Promise<CallToolResult> {
    const appId = typeof args?.app === 'string' ? args.app.trim() : '';
    if (!appId) {
      throw new AaiError('INVALID_REQUEST', "removeApp requires 'app'");
    }

    if (args?.confirm !== true) {
      throw new AaiError(
        'INVALID_REQUEST',
        "removeApp requires 'confirm: true' after the agent explains the global impact and the user explicitly confirms."
      );
    }

    const app = await this.resolveManageableApp(appId);
    if (app.source !== 'mcp-import' && app.source !== 'skill-import') {
      throw new AaiError(
        'INVALID_REQUEST',
        `removeApp only supports AAI Gateway managed imports. '${appId}' is a '${app.source}' app.`
      );
    }

    if (app.source === 'mcp-import') {
      await getMcpRegistry().delete(appId);
      await deleteImportedMcpHeaders(this.secureStorage, appId);
    } else {
      await getSkillRegistry().delete(appId);
    }

    await deleteAppPolicyState(appId);
    await removeAppFromAllAgents(appId);
    await rm(getManagedAppDir(appId), { recursive: true, force: true });
    this.appRegistry.delete(appId);
    await this.notifyToolsListChanged();

    const payload = {
      app: appId,
      removedFrom: 'all-agents',
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
      structuredContent: payload,
    };
  }

  private async handleExec(
    _request: CallToolRequest,
    requestId: string | number,
    appIdOrUrl: string | undefined,
    toolName: string,
    args: Record<string, unknown>,
    caller: CallerContext
  ): Promise<CallToolResult> {
    if (!appIdOrUrl || appIdOrUrl === 'gateway') {
      if (isGatewayExecutionTool(toolName)) {
        return this.executeGatewayTool(toolName, args, caller);
      }

      throw new AaiError('INVALID_REQUEST', "aai:exec requires 'app' for app tools");
    }

    const resolved = await this.resolveApp(appIdOrUrl, caller);
    const locale = getSystemLocale();
    const appName = getLocalizedName(resolved.descriptor.app.name, locale);
    const startedAt = Date.now();

    logger.info(
      {
        requestId,
        app: resolved.appId,
        protocol: resolved.descriptor.access.protocol,
        tool: toolName,
        args: summarizeExecArgs(args),
      },
      'aai:exec received'
    );

    await this.consentManager.checkAndPrompt(
      resolved.appId,
      appName,
      {
        name: toolName,
        description: `${resolved.descriptor.access.protocol} operation`,
        parameters: args,
      },
      { name: caller.name, version: caller.version }
    );

    try {
      const result = await this.executeAppWithInactivityTimeout(
        resolved.appId,
        resolved.descriptor,
        toolName,
        args
      );
      logger.info(
        {
          requestId,
          app: resolved.appId,
          protocol: resolved.descriptor.access.protocol,
          tool: toolName,
          durationMs: Date.now() - startedAt,
          result: summarizeExecResult(result),
        },
        'aai:exec completed'
      );
      return this.toCallToolResult(result);
    } catch (err) {
      logger.error(
        {
          requestId,
          app: resolved.appId,
          protocol: resolved.descriptor.access.protocol,
          tool: toolName,
          durationMs: Date.now() - startedAt,
          err,
        },
        'aai:exec failed'
      );
      throw err;
    }
  }

  private async executeGatewayTool(
    toolName: string,
    args: Record<string, unknown>,
    caller: CallerContext
  ): Promise<CallToolResult> {
    if (toolName === 'mcp:import') {
      return this.handleMcpImport(args, caller);
    }

    if (toolName === 'skill:import') {
      return this.handleSkillImport(args, caller);
    }

    if (toolName === SEARCH_DISCOVER_TOOL_NAME) {
      return this.handleSearchDiscover(args);
    }

    if (toolName === 'listAllAaiApps') {
      return this.handleListAllApps(caller);
    }

    if (toolName === 'disableApp') {
      return this.handleDisableApp(args, caller);
    }

    if (toolName === 'enableApp') {
      return this.handleEnableApp(args, caller);
    }

    if (toolName === 'removeApp') {
      return this.handleRemoveApp(args, caller);
    }

    throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
  }

  private async resolveManagedApp(
    appId: string,
    caller: CallerContext
  ): Promise<RuntimeAppRecord | undefined> {
    const existing = this.appRegistry.get(appId);
    if (!existing) {
      return undefined;
    }

    return (await this.isAppEnabledForCaller(existing, caller)) ? existing : undefined;
  }

  private async resolveManageableApp(appId: string): Promise<RuntimeAppRecord> {
    const existing = this.appRegistry.get(appId);
    if (!existing) {
      throw new AaiError('UNKNOWN_APP', `App not found: ${appId}`);
    }

    return existing;
  }

  private async resolveApp(appIdOrUrl: string, caller: CallerContext): Promise<RuntimeAppRecord> {
    const existing = await this.resolveManagedApp(appIdOrUrl, caller);
    if (existing) {
      return existing;
    }

    throw new AaiError('UNKNOWN_APP', `App not found: ${appIdOrUrl}`);
  }

  /**
   * Get executor instance for a protocol
   */
  private getExecutor(protocol: string): Executor {
    switch (protocol) {
      case 'mcp':
        return getMcpExecutor(this.secureStorage);
      case 'skill':
        return getSkillExecutor();
      case 'acp-agent':
        return getAcpExecutor();
      case 'cli':
        return getCliExecutor();
      default:
        throw new AaiError('NOT_IMPLEMENTED', `Protocol '${protocol}' does not support app capabilities`);
    }
  }

  private async executeApp(
    appId: string,
    descriptor: AaiJson,
    toolName: string,
    args: Record<string, unknown>,
    observer?: import('../executors/events.js').ExecutionObserver
  ): Promise<unknown> {
    const access = descriptor.access;

    if (isMcpAccess(access)) {
      // MCP executor handles schema validation internally
      const executor = getMcpExecutor();
      const headers = await loadImportedMcpHeaders(this.secureStorage, appId);
      return executor.callTool(
        {
          appId,
          config: access.config,
          headers,
        },
        toolName,
        args,
        observer
      );
    }

    if (isSkillAccess(access)) {
      return executeSkill(access.config as any, toolName, args);
    }

    if (isAcpAgentAccess(access)) {
      // ACP executor handles schema validation internally
      const executor = getAcpExecutor();
      if (observer && executor.executeWithObserver) {
        return executor.executeWithObserver(appId, access.config, toolName, args, observer);
      }
      return executor.execute(appId, access.config, toolName, args);
    }

    if (isCliAccess(access)) {
      return executeCli(access.config, toolName, args);
    }

    throw new AaiError('NOT_IMPLEMENTED', `Unsupported protocol ${JSON.stringify(access)}`);
  }

  private async executeAppWithInactivityTimeout(
    appId: string,
    descriptor: AaiJson,
    toolName: string,
    args: Record<string, unknown>,
    observer?: ExecutionObserver
  ): Promise<unknown> {
    const timeoutMs = this.getDownstreamInactivityTimeoutMs();

    return new Promise((resolve, reject) => {
      let completed = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (callback: () => void) => {
        if (completed) {
          return;
        }
        completed = true;
        if (timer) {
          clearTimeout(timer);
        }
        callback();
      };

      const scheduleTimeout = () => {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          const error = new AaiError(
            'TIMEOUT',
            `Downstream '${appId}' timed out after ${timeoutMs}ms without any activity`
          );
          void this.cleanupTimedOutExecution(appId, descriptor).finally(() => {
            finish(() => reject(error));
          });
        }, timeoutMs);
      };

      const activityObserver = this.wrapExecutionObserver(observer, scheduleTimeout);
      scheduleTimeout();

      this.executeApp(appId, descriptor, toolName, args, activityObserver).then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error))
      );
    });
  }

  private getDownstreamInactivityTimeoutMs(): number {
    return DOWNSTREAM_INACTIVITY_TIMEOUT_MS;
  }

  private wrapExecutionObserver(
    observer: ExecutionObserver | undefined,
    onActivity: () => void
  ): ExecutionObserver {
    return {
      onMessage: async (event) => {
        onActivity();
        await observer?.onMessage?.(event);
      },
      onProgress: async (event) => {
        onActivity();
        await observer?.onProgress?.(event);
      },
      onTaskStatus: async (event) => {
        onActivity();
        await observer?.onTaskStatus?.(event);
      },
    };
  }

  private async cleanupTimedOutExecution(appId: string, descriptor: AaiJson): Promise<void> {
    const access = descriptor.access;

    try {
      if (isMcpAccess(access)) {
        await getMcpExecutor().close(appId);
        return;
      }

      if (isAcpAgentAccess(access)) {
        await getAcpExecutor().disconnect(appId);
      }
    } catch (err) {
      logger.warn({ appId, err }, 'Failed to clean up timed out downstream execution');
    }
  }

  private toCallToolResult(result: unknown): CallToolResult {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result as Record<string, unknown>,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  }


  async start(): Promise<void> {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('AAI Gateway started (stdio)');
  }
}

function summarizeExecArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    keys: Object.keys(args),
  };

  if (typeof args.sessionId === 'string') {
    summary.sessionId = args.sessionId;
  }

  if (typeof args.turnId === 'string') {
    summary.turnId = args.turnId;
  }

  if (typeof args.text === 'string') {
    summary.textLength = args.text.length;
    summary.textPreview = truncateLogPreview(args.text);
  } else if (typeof args.message === 'string') {
    summary.messageLength = args.message.length;
    summary.messagePreview = truncateLogPreview(args.message);
  } else if (Array.isArray(args.prompt)) {
    summary.promptBlocks = args.prompt.length;
  }

  if (typeof args.cwd === 'string') {
    summary.cwd = args.cwd;
  }

  return summary;
}

function summarizeExecResult(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  if (typeof record.turnId === 'string') {
    summary.turnId = record.turnId;
  }

  if (typeof record.sessionId === 'string') {
    summary.sessionId = record.sessionId;
  }

  if (typeof record.done === 'boolean') {
    summary.done = record.done;
  }

  if (typeof record.cancelled === 'boolean') {
    summary.cancelled = record.cancelled;
  }

  if (typeof record.status === 'string') {
    summary.status = record.status;
  }

  if (typeof record.error === 'string') {
    summary.error = truncateLogPreview(record.error);
  }

  if (Array.isArray(record.content)) {
    summary.contentBlocks = record.content.length;
    const textPreview = previewStructuredContent(record.content);
    if (textPreview) {
      summary.textPreview = textPreview;
    }
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function previewStructuredContent(content: unknown[], maxChars = 160): string | undefined {
  const text = content
    .filter(
      (item): item is { type?: unknown; text?: unknown } =>
        !!item && typeof item === 'object' && !Array.isArray(item)
    )
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('');

  return text.length > 0 ? truncateLogPreview(text, maxChars) : undefined;
}

function truncateLogPreview(value: string, maxChars = 160): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function parseMcpImportArguments(args: Record<string, unknown> | undefined): {
  name?: string;
  config: McpConfig;
  headers?: Record<string, string>;
  metadata?: {
    summary: string;
    enableScope: 'current' | 'all';
  };
} {
  try {
    // Normalize: when command is an array (common in standard MCP JSON configs),
    // split into command (first element) + args (remaining elements).
    let command = args?.command;
    let argsArray = args?.args;
    if (Array.isArray(command)) {
      const parts = command.filter((item): item is string => typeof item === 'string');
      if (parts.length > 0) {
        command = parts[0];
        if (parts.length > 1) {
          argsArray = [...parts.slice(1), ...(Array.isArray(argsArray) ? argsArray : [])];
        }
      }
    }

    // Normalize: accept "environment" as an alias for "env".
    const env = args?.env ?? args?.environment;

    return {
      name: asOptionalString(args?.name),
      config: buildMcpImportConfig({
        transport:
          args?.transport === 'streamable-http' || args?.transport === 'sse'
            ? args.transport
            : undefined,
        url: asOptionalString(args?.url),
        command: asOptionalString(command),
        timeout: asOptionalPositiveInteger(args?.timeout, 'timeout'),
        args: asOptionalStringArray(argsArray, 'args'),
        env: asOptionalStringRecord(env, 'env'),
        cwd: asOptionalString(args?.cwd),
      }),
      headers: validateAndReturnHeaders(args?.headers),
      metadata: parseOptionalMcpImportMetadata(args),
    };
  } catch (err) {
    throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
  }
}

function validateAndReturnHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const headers = asOptionalStringRecord(value, 'headers');
  if (!headers) {
    return undefined;
  }

  validateImportHeaders(headers);
  return headers;
}

function parseSkillImportArguments(args: Record<string, unknown> | undefined): {
  path: string;
  importMode: SkillImportMode;
} {
  try {
    const source = buildSkillImportSource({
      path: asOptionalString(args?.path),
    });

    return {
      path: source.path!,
      importMode: parseSkillImportMode(args?.mode),
    };
  } catch (err) {
    throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
  }
}

function parseOptionalMcpImportMetadata(args: Record<string, unknown> | undefined):
  | {
      summary: string;
      enableScope: 'current' | 'all';
    }
  | undefined {
  const hasSummary = args?.summary !== undefined;
  const hasEnableScope = args?.enableScope !== undefined;
  const providedCount = Number(hasSummary) + Number(hasEnableScope);

  if (providedCount === 0) {
    return undefined;
  }

  if (providedCount !== 2) {
    throw new Error(
      "MCP import requires 'summary' and 'enableScope' together. Omit both for inspection, or provide both for the final import."
    );
  }

  const summary = asOptionalString(args?.summary);
  const enableScope = parseEnableScope(args?.enableScope);

  if (!summary) {
    throw new Error("Import received an empty 'summary'");
  }

  return {
    ...normalizeSummaryInput(summary),
    enableScope,
  };
}

function parseEnableScope(value: unknown): 'current' | 'all' {
  if (value === 'current' || value === 'all') {
    return value;
  }

  throw new Error("MCP import requires 'enableScope' to be either 'current' or 'all'");
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer in milliseconds`);
  }

  return value;
}

function asOptionalStringArray(value: unknown, field: string): string[] | undefined {
  const normalized = tryParseJsonString(value);
  value = normalized;

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new AaiError('INVALID_REQUEST', `${field} must be an array of strings`);
  }

  const invalidItem = value.find((item) => typeof item !== 'string');
  if (invalidItem !== undefined) {
    throw new AaiError('INVALID_REQUEST', `${field} must contain only strings`);
  }

  return value as string[];
}

function parseSkillImportMode(value: unknown): SkillImportMode {
  if (value === undefined || value === 'manual') {
    return 'manual';
  }
  if (value === 'auto') {
    return 'auto';
  }
  throw new AaiError('INVALID_REQUEST', "Skill import requires 'mode' to be either 'manual' or 'auto'");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === 'string');
}

function asOptionalStringRecord(
  value: unknown,
  field: string
): Record<string, string> | undefined {
  const normalized = tryParseJsonString(value);
  value = normalized;

  if (value === undefined) {
    return undefined;
  }

  if (!isStringRecord(value)) {
    throw new AaiError('INVALID_REQUEST', `${field} must be an object with string values`);
  }

  return value;
}

function tryParseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    (!trimmed.startsWith('[') && !trimmed.startsWith('{'))
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeArgumentsWithSchema(value: unknown, schema: Record<string, unknown>): unknown {
  const normalized = parseJsonStringForExpectedType(value, schema);
  const type = schema.type as string | undefined;

  if (type === 'object' && normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    const properties = schema.properties as Record<string, unknown> | undefined;
    const additionalProperties = schema.additionalProperties;
    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(normalized as Record<string, unknown>)) {
      const propertySchema = properties?.[key];
      if (propertySchema && typeof propertySchema === 'object' && !Array.isArray(propertySchema)) {
        result[key] = normalizeArgumentsWithSchema(item, propertySchema as Record<string, unknown>);
        continue;
      }

      if (
        additionalProperties &&
        typeof additionalProperties === 'object' &&
        !Array.isArray(additionalProperties)
      ) {
        result[key] = normalizeArgumentsWithSchema(
          item,
          additionalProperties as Record<string, unknown>
        );
        continue;
      }

      result[key] = item;
    }

    return result;
  }

  if (type === 'array' && Array.isArray(normalized)) {
    const itemSchema = schema.items;
    if (itemSchema && typeof itemSchema === 'object' && !Array.isArray(itemSchema)) {
      return normalized.map((item) =>
        normalizeArgumentsWithSchema(item, itemSchema as Record<string, unknown>)
      );
    }
  }

  return normalized;
}

function parseJsonStringForExpectedType(value: unknown, schema: Record<string, unknown>): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const expectedType = schema.type as string | undefined;
  const trimmed = value.trim();

  if (expectedType === 'object' && trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  if (expectedType === 'array' && trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

export async function createGatewayServer(options?: DiscoveryOptions): Promise<AaiGatewayServer> {
  return new AaiGatewayServer(options);
}

function createToolErrorResult(summary: string, err: unknown): CallToolResult {
  const details: string[] = [summary];

  if (err instanceof AaiError) {
    details.push(`Error: ${err.message}`);
    if (err.data && Object.keys(err.data).length > 0) {
      details.push('');
      details.push('Details:');
      details.push(JSON.stringify(err.data, null, 2));
    }
  } else if (err instanceof Error) {
    details.push(`Error: ${err.message}`);
  } else {
    details.push(`Error: ${String(err)}`);
  }

  return {
    content: [{ type: 'text', text: details.join('\n') }],
    isError: true,
  };
}

function isMissingEnvVarsError(err: unknown): boolean {
  if (err instanceof AaiError) {
    const data = err.data as Record<string, unknown> | undefined;
    if (data?.code === 'MISSING_ENV_VARS') {
      return true;
    }
  }
  if (err instanceof Error && /Missing environment variables/i.test(err.message)) {
    return true;
  }
  return false;
}

function extractMissingVarNames(err: unknown): string[] {
  if (err instanceof AaiError) {
    const data = err.data as Record<string, unknown> | undefined;
    if (Array.isArray(data?.missingVars)) {
      return data.missingVars as string[];
    }
  }
  if (err instanceof Error) {
    const matches = err.message.match(/\$\{([^}]+)\}/g);
    if (matches) {
      return matches.map((m) => m.slice(2, -1));
    }
  }
  return [];
}

function buildMissingEnvVarsResult(err: unknown): CallToolResult {
  const envFile = getDotenvPath();
  const missingVars = extractMissingVarNames(err);
  const varList = missingVars.length > 0 ? missingVars : ['<VARIABLE_NAME>'];

  const lines: string[] = [
    'MCP import failed: missing environment variables.',
    '',
    '## What to do',
    '',
    `The following environment variables are required but not set: ${varList.map((v) => `\`${v}\``).join(', ')}`,
    '',
    '### Step 1 — Obtain the values',
    '',
    ...varList.map(
      (v) =>
        `- \`${v}\`: search the web for where to obtain this key (e.g. the provider\'s developer portal or API dashboard). Guide the user to the signup / API-key page.`
    ),
    '',
    '### Step 2 — Save to the AAI env file',
    '',
    `Open the env file for the user with a shell command:`,
    '```',
    `open ${envFile}`,
    '```',
    `Ask the user to add the values in the format:`,
    '```',
    ...varList.map((v) => `${v}=<paste_value_here>`),
    '```',
    '',
    '⚠️ NEVER read or display the contents of this file — it contains sensitive secrets.',
    '',
    '### Step 3 — Retry',
    '',
    'After the user confirms the values have been saved, call `mcp:import` again with the same parameters.',
  ];

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    isError: true,
  };
}

function summarizeRawImportArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) {
    return {};
  }

  return {
    keys: Object.keys(args),
    ...(typeof args.name === 'string' ? { name: args.name } : {}),
    ...(typeof args.command === 'string' ? { command: args.command } : {}),
    ...(Array.isArray(args.args) ? { argvLength: args.args.length } : {}),
    ...(typeof args.cwd === 'string' ? { cwd: args.cwd } : {}),
    ...(typeof args.url === 'string' ? { url: args.url } : {}),
    ...(typeof args.transport === 'string' ? { transport: args.transport } : {}),
    ...(typeof args.path === 'string' ? { path: args.path } : {}),
    ...(typeof args.enableScope === 'string' ? { enableScope: args.enableScope } : {}),
    ...(typeof args.mode === 'string' ? { mode: args.mode } : {}),
    ...(typeof args.summary === 'string' ? { summaryLength: args.summary.length } : {}),
    ...(args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)
      ? { headerKeys: Object.keys(args.headers as Record<string, unknown>) }
      : {}),
    ...(args.env && typeof args.env === 'object' && !Array.isArray(args.env)
      ? { envKeys: Object.keys(args.env as Record<string, unknown>) }
      : {}),
  };
}

function summarizeMcpImportRequest(options: {
  name?: string;
  config: McpConfig;
  headers?: Record<string, string>;
  metadata?: {
    summary: string;
    enableScope: 'current' | 'all';
  };
}): Record<string, unknown> {
  return {
    ...(options.name ? { name: options.name } : {}),
    config: summarizeMcpConfig(options.config),
    ...(options.headers ? { headerKeys: Object.keys(options.headers) } : {}),
    ...(options.metadata
      ? {
          summaryLength: options.metadata.summary.length,
          enableScope: options.metadata.enableScope,
        }
      : {}),
  };
}

function summarizeSkillImportRequest(options: {
  path: string;
  importMode: SkillImportMode;
}): Record<string, unknown> {
  return {
    path: options.path,
    importMode: options.importMode,
  };
}

function summarizeMcpConfig(config: McpConfig): Record<string, unknown> {
  switch (config.transport) {
    case 'stdio':
      return {
        transport: config.transport,
        command: config.command,
        argvLength: config.args?.length ?? 0,
        ...(config.cwd ? { cwd: config.cwd } : {}),
        ...(config.env ? { envKeys: Object.keys(config.env) } : {}),
        ...(config.timeout ? { timeout: config.timeout } : {}),
      };
    case 'streamable-http':
    case 'sse':
      return {
        transport: config.transport,
        url: config.url,
        ...(config.timeout ? { timeout: config.timeout } : {}),
      };
  }
}

export function buildGatewayToolDefinitions(): GatewayToolDefinition[] {
  return [
    {
      name: 'aai:exec',
      description:
        'Execute a tool. Read the guide first (e.g. app:*, mcp:import) — it contains the full schema.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description:
              'Required for app tools, omit or use "gateway" for gateway tools.',
          },
          tool: {
            type: 'string',
            description: 'Tool name within the app, not prefixed with app id.',
          },
          args: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments for the selected tool.',
          },
        },
        required: ['tool'],
      },
    },
    {
      name: 'mcp:import',
      description:
        'Import an MCP server into AAI Gateway. Guide tool, no arguments.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: `Optional. Display name for the imported app. When provided, AAI Gateway also uses it to derive the app id. Maximum length: ${IMPORT_LIMITS.nameLength} characters.`,
          },
          transport: {
            type: 'string',
            enum: ['streamable-http', 'sse'],
            description:
              'Optional. Only used with url for remote MCP imports. Defaults to "streamable-http".',
          },
          command: {
            type: 'string',
            description: `Use this for a local stdio MCP import. The executable to launch, for example "npx" or "uvx". If command is present, the import is treated as stdio. Maximum length: ${IMPORT_LIMITS.commandLength} characters.`,
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional for local stdio MCP imports. Command arguments, for example ["-y", "@modelcontextprotocol/server-filesystem", "/repo"]. Maximum ${IMPORT_LIMITS.argCount} items, each at most ${IMPORT_LIMITS.argLength} characters.`,
          },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: `Optional for local stdio MCP imports. Environment variables passed to the MCP process. Maximum ${IMPORT_LIMITS.envCount} entries, key length ${IMPORT_LIMITS.envKeyLength}, value length ${IMPORT_LIMITS.envValueLength}.`,
          },
          cwd: {
            type: 'string',
            description: `Optional for local stdio MCP imports. Working directory used when launching the MCP process. Maximum length: ${IMPORT_LIMITS.cwdLength} characters.`,
          },
          timeout: {
            type: 'integer',
            description: `Optional for all MCP imports. MCP tool execution timeout in milliseconds. If omitted, MCP tool calls time out after 60000ms. Maximum value: ${IMPORT_LIMITS.timeoutMsMax}.`,
          },
          url: {
            type: 'string',
            description: `Use this for a remote MCP import. The remote MCP endpoint URL. Maximum length: ${IMPORT_LIMITS.urlLength} characters.`,
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: `Optional for remote transports. HTTP headers such as Authorization for the remote MCP endpoint. Maximum ${IMPORT_LIMITS.headerCount} entries, key length ${IMPORT_LIMITS.headerKeyLength}, value length ${IMPORT_LIMITS.headerValueLength}.`,
          },
          summary: {
            type: 'string',
            description: `Optional on the first call, required on the second call. A short English summary that explains when this MCP should be used. Must be in English regardless of user language. Maximum length: ${EXPOSURE_LIMITS.summaryLength} characters.`,
          },
          enableScope: {
            type: 'string',
            enum: ['current', 'all'],
            description:
              'Optional on the first call, required on the second call. Use "current" to enable this imported MCP only for the current agent. Use "all" to enable it for all agents by default.',
          },
        },
        examples: [
          {
            name: 'Playwright',
            command: 'npx',
            args: ['@playwright/mcp@latest'],
          },
          {
            name: 'open-websearch',
            command: 'npx',
            args: ['-y', 'open-websearch@latest'],
            env: {
              MODE: 'stdio',
              DEFAULT_SEARCH_ENGINE: 'bing',
            },
            timeout: 30000,
          },
          {
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer <token>' },
            summary: 'Use this MCP for Linear issue and project operations.',
            enableScope: 'all',
          },
          {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/repo'],
            summary:
              'Use this MCP for local filesystem operations inside the imported directory.',
            enableScope: 'current',
          },
        ],
      },
      listInputSchema: buildGuideOnlyInputSchema(),
    },
    {
      name: 'skill:import',
      description:
        'Import a skill into AAI Gateway. Guide tool, no arguments.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `Required. Path to a local directory containing SKILL.md and companion files. Download and extract remote skills first, then provide the local path. Maximum length: ${IMPORT_LIMITS.pathLength} characters.`,
          },
          mode: {
            type: 'string',
            enum: ['manual', 'auto'],
            description:
              'Optional. Use "manual" to import the skill into AAI Gateway without copying a proxy skill into the current agent skills directory. Use "auto" to also generate a proxy SKILL.md for the current agent.',
          },
        },
        examples: [
          {
            path: '/absolute/path/to/skill',
          },
        ],
      },
      listInputSchema: buildGuideOnlyInputSchema(),
    },
    {
      name: 'listAllAaiApps',
      description:
        'List all apps available to the current agent, excluding AAI Gateway built-in management tools.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'disableApp',
      description:
        'Disable one app for the current agent only.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required. The app id to disable for the current agent.',
          },
        },
        required: ['app'],
      },
    },
    {
      name: 'enableApp',
      description:
        'Re-enable one app for the current agent only.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required. The app id to re-enable for the current agent.',
          },
        },
        required: ['app'],
      },
    },
    {
      name: 'removeApp',
      description:
        'Remove one AAI Gateway managed import from all agents.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required. The imported app id to remove globally.',
          },
          confirm: {
            type: 'boolean',
            description:
              'Required. Must be true only after the agent explains that the app will be removed for all agents and the user explicitly confirms.',
          },
        },
        required: ['app', 'confirm'],
      },
    },
    {
      name: 'skill:create',
      description:
        'Create an AAI Gateway compatible skill. Guide tool, no arguments.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: SEARCH_DISCOVER_TOOL_NAME,
      description:
        'Search for MCP servers or skills when the user needs a new capability. Guide tool, no arguments.',
      inputSchema: searchDiscoverInputSchema,
      listInputSchema: buildGuideOnlyInputSchema(),
    },
  ];
}

function buildGuideOnlyInputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
    description: 'No arguments.',
  };
}

function getGatewayToolDefinition(toolName: string): GatewayToolDefinition | undefined {
  return buildGatewayToolDefinitions().find((tool) => tool.name === toolName);
}


function isGatewayExecutionTool(toolName: string): boolean {
  return (
    toolName === 'mcp:import' ||
    toolName === 'skill:import' ||
    toolName === SEARCH_DISCOVER_TOOL_NAME ||
    toolName === 'listAllAaiApps' ||
    toolName === 'disableApp' ||
    toolName === 'enableApp' ||
    toolName === 'removeApp'
  );
}

function generateGatewayToolGuide(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): string {
  if (tool.name === 'mcp:import') {
    return generateMcpImportGuide(tool);
  }

  const examples = extractGuideExamples(tool.inputSchema, tool.name);
  const notes = getGatewayToolGuideNotes(tool.name);
  return [
    `# ${tool.name}`,
    '',
    `This is only an operation guide for \`${tool.name}\`. To perform the actual operation, you must call \`aai:exec\`.`,
    '',
    'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.',
    `For this operation, leave \`app\` empty, set \`tool\` to "${tool.name}", and refer to the examples below for \`args\`.`,
    '',
    ...(examples.length > 0
      ? [
          '',
          '## Examples',
          '',
          'The examples below are complete `aai:exec` calls.',
          '',
          ...examples.flatMap((example) => [
            '```json',
            JSON.stringify(
              {
                tool: 'aai:exec',
                args: {
                  tool: tool.name,
                  args: example,
                },
              },
              null,
              2
            ),
            '```',
            '',
          ]),
        ]
      : []),
    ...(notes
      ? [
          '',
          notes,
        ]
      : []),
  ].join('\n');
}

function generateMcpImportGuide(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): string {
  const inspectExample = {
    tool: 'aai:exec',
    args: {
      tool: 'mcp:import',
      args: {
        command: 'npx',
        args: ['-y', '@brave/brave-search-mcp-server'],
        timeout: 60000,
        name: 'brave-search',
      },
    },
  };

  const finalizeExample = {
    tool: 'aai:exec',
    args: {
      tool: 'mcp:import',
      args: {
        command: 'npx',
        args: ['-y', '@brave/brave-search-mcp-server'],
        timeout: 60000,
        name: 'brave-search',
        summary: 'Use this MCP for Brave web search.',
        enableScope: 'all',
      },
    },
  };

  return [
    `# ${tool.name}`,
    '',
    'This is only an operation guide for `mcp:import`. To perform the actual operation, you must call `aai:exec`.',
    '',
    'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.',
    'For this operation, leave `app` empty, set `tool` to `"mcp:import"`, and refer to the examples below for `args`.',
    '',
    'The examples below are complete `aai:exec` calls.',
    '',
    '## Examples',
    '',
    'Phase 1 — inspect:',
    '```json',
    JSON.stringify(inspectExample, null, 2),
    '```',
    '',
    'Phase 2 — finalize import:',
    '```json',
    JSON.stringify(finalizeExample, null, 2),
    '```',
    '',
    getGatewayToolGuideNotes(tool.name) ?? '',
  ].join('\n');
}

function extractGuideExamples(
  inputSchema: Record<string, unknown>,
  toolName: string
): Record<string, unknown>[] {
  const rawExamples = inputSchema.examples;
  if (Array.isArray(rawExamples) && rawExamples.length > 0) {
    return rawExamples
      .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
      .slice(0, 2);
  }

  if (toolName === 'mcp:import') {
    return [];
  }

  if (toolName === 'listAllAaiApps' || toolName === 'skill:create') {
    return [{}];
  }

  return [];
}

function getGatewayToolGuideNotes(toolName: string): string | null {
  if (toolName === 'mcp:import') {
    return [
      '## Parameters',
      '',
      '### Local stdio MCP',
      '',
      '| Parameter | Type | Required | Description |',
      '|-----------|------|----------|-------------|',
      '| `command` | string | yes | The executable only, e.g. `"npx"`, `"uvx"`, `"node"` |',
      '| `args` | string[] | no | Arguments after the executable |',
      '| `env` | object | no | Environment variables as `{ "KEY": "value" }` pairs |',
      '| `timeout` | integer | no | Tool execution timeout in ms (default 60000) |',
      '| `cwd` | string | no | Working directory for the process |',
      '| `name` | string | no | Display name for the imported app |',
      '| `summary` | string | phase 2 | Short English description of when to use this MCP |',
      '| `enableScope` | `"current"` \\| `"all"` | phase 2 | Enable for current agent or all agents |',
      '',
      'When converting from a standard MCP JSON config where `command` is an array:',
      '`["npx", "-y", "pkg"]` → `command: "npx"`, `args: ["-y", "pkg"]`',
      '',
      '### Remote MCP',
      '',
      '| Parameter | Type | Required | Description |',
      '|-----------|------|----------|-------------|',
      '| `url` | string | yes | Remote MCP endpoint URL |',
      '| `transport` | string | no | `"streamable-http"` (default) or `"sse"` |',
      '| `headers` | object | no | HTTP headers such as Authorization |',
      '| `timeout` | integer | no | Tool execution timeout in ms (default 60000) |',
      '| `name` | string | no | Display name for the imported app |',
      '| `summary` | string | phase 2 | Short English description of when to use this MCP |',
      '| `enableScope` | `"current"` \\| `"all"` | phase 2 | Enable for current agent or all agents |',
      '',
      '## Notes',
      '',
      'Phase 1 omits `summary` and `enableScope`.',
      'Phase 2 repeats the same source config and adds `summary` and `enableScope`.',
      '',
      '## Environment variables & API keys',
      '',
      `\`${getDotenvPath()}\` is a sensitive secrets file.`,
      'Do not read, summarize, or repeat its contents.',
      'Never ask the user to send API keys, tokens, or any other secret values in chat.',
      `Store sensitive values in \`${getDotenvPath()}\` and reference them from the MCP config with \${VAR_NAME} placeholders.`,
      '',
      'If the import fails due to missing environment variables, the error response includes step-by-step setup instructions.',
      'Follow those instructions to guide the user:',
      '1. Explain which environment variables are missing.',
      '2. Guide the user on how to obtain each value, for example from the provider portal or API dashboard.',
      '3. Provide a configuration example such as `BRAVE_API_KEY=your_api_key_here` so the user knows what to put in the file.',
      `4. Only after the user has obtained the required values, open \`${getDotenvPath()}\` for the user via a bash command. The file may be shown to the user, but you must not read, summarize, or repeat its contents.`,
      '5. Tell the user to fill in the real values manually, save the file locally, then retry the import.',
      '',
      '## Web search tips',
      '',
      'When you need to research an MCP server or missing credentials, search for each variable or topic one at a time.',
    ].join('\n');
  }

  return null;
}

function formatToolPreview(tools: Array<{ name: string; description?: string }>): string {
  if (tools.length === 0) {
    return 'No MCP tools reported.';
  }

  return tools.map((tool) => `- ${tool.name}: ${tool.description ?? ''}`.trimEnd()).join('\n');
}
