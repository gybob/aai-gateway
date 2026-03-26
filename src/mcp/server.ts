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
import { fetchWebDescriptor, normalizeUrl } from '../discovery/web.js';
import { AaiError } from '../errors/errors.js';
import { getAcpExecutor } from '../executors/acp.js';
import {
  legacyExecuteCli as executeCli,
} from '../executors/cli.js';
import { getMcpExecutor } from '../executors/mcp.js';
import type { Executor } from '../executors/interface.js';
import {
  legacyExecuteSkill as executeSkill,
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
import type { CallerIdentity } from '../types/consent.js';
import { deriveAppId } from '../utils/ids.js';
import { getSystemLocale } from '../utils/locale.js';
import { logger } from '../utils/logger.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';

import {
  generateAppListDescription,
  generateAppGuide,
} from '../guides/app-guide-generator.js';
import { generateSkillCreateGuide } from '../guides/skill-create-guide.js';
import {
  buildMcpImportConfig,
  buildSkillImportSource,
  discoverMcpImport,
  discoverSkillImport,
  EXPOSURE_LIMITS,
  type ExposureMode,
  IMPORT_LIMITS,
  importMcpServer,
  importSkill,
  loadImportedMcpHeaders,
  normalizeExposureInput,
  validateImportHeaders,
} from './importer.js';
import {
  buildSearchDiscoverResponse,
  SEARCH_DISCOVER_TOOL_NAME,
  searchDiscoverInputSchema,
  parseSearchDiscoverArguments,
} from './search-guidance.js';
import type { ExecutionObserver } from '../executors/events.js';

const MCP_DOWNSTREAM_INACTIVITY_TIMEOUT_MS = 60_000;
const DOWNSTREAM_INACTIVITY_TIMEOUT_MS = 300_000;
const ACP_DOWNSTREAM_INACTIVITY_TIMEOUT_MS = 180_000;

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
  private callerIdentity?: CallerIdentity;
  private discoveryManager?: import('../discovery/manager.js').DiscoveryManager;

  constructor(options?: DiscoveryOptions) {
    this.options = options ?? {};
    this.server = new Server(
      { name: AAI_GATEWAY_NAME, version: AAI_GATEWAY_VERSION },
      {
        capabilities: {
          tools: {},
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

  private setupHandlers(): void {
    this.server.oninitialized = () => {
      const clientVersion = this.server.getClientVersion();
      this.callerIdentity = {
        name: clientVersion?.name ?? 'Unknown Client',
        version: clientVersion?.version,
      };
    };

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }> = Array.from(this.appRegistry.values()).map((app) => ({
        name: `app:${app.appId}`,
        description: generateAppListDescription(app.appId, app.descriptor),
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
        return this.handleAppGuide(name.slice(4));
      }

      if (name === 'remote:discover') {
        const url = (args as { url?: string } | undefined)?.url;
        if (!url) {
          throw new AaiError('INVALID_REQUEST', "Missing 'url' parameter");
        }
        return this.handleRemoteDiscover(url);
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
          payload.args ?? {}
        );
      }

      if (name === 'aai:schema') {
        const payload = args as { app?: string; tool?: string } | undefined;
        if (!payload?.tool) {
          throw new AaiError('INVALID_REQUEST', "aai:schema requires 'tool'");
        }
        return this.handleSchema(payload.app, payload.tool);
      }

      if (name === 'mcp:import' || name === 'skill:import' || name === SEARCH_DISCOVER_TOOL_NAME) {
        return this.handleGatewayToolGuide(name);
      }

      if (name === 'skill:create') {
        return this.handleSkillCreate();
      }

      throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
    });
  }

  private async handleAppGuide(
    appId: string
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const app = this.appRegistry.get(appId);
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
          text: generateAppGuide(appId, descriptor, capabilities),
        },
      ],
    };
  }

  private async handleRemoteDiscover(
    url: string
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const descriptor = await fetchWebDescriptor(url);
    const normalizedUrl = normalizeUrl(url);
    const appId = deriveAppId(`web:${new URL(normalizedUrl).hostname}`, 'web');
    const access = descriptor.access;
    const executor = this.getExecutor(access.protocol);

    let capabilities;
    try {
      capabilities = await executor.loadAppCapabilities(appId, access.config as any);
    } catch (err) {
      // For remote apps, use static fallback if live load fails
      capabilities = { title: access.protocol.toUpperCase(), tools: [] };
    }

    return {
      content: [{ type: 'text', text: generateAppGuide(appId, descriptor, capabilities) }],
    };
  }

  private async handleSchema(
    appIdOrUrl: string | undefined,
    toolName: string
  ): Promise<CallToolResult> {
    const gatewayTool = getGatewayToolDefinition(toolName);
    if (gatewayTool) {
      const schema = buildSchemaResponseDocument(gatewayTool);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(schema, null, 2),
          },
        ],
        structuredContent: schema,
      };
    }

    if (!appIdOrUrl) {
      throw new AaiError(
        'INVALID_REQUEST',
        "aai:schema requires 'app' for app tools. Gateway tools only need 'tool'."
      );
    }

    const resolved = await this.resolveApp(appIdOrUrl);
    const { appId, descriptor } = resolved;
    const access = descriptor.access;
    const executor = this.getExecutor(access.protocol);
    const schema = await executor.loadToolSchema(appId, access.config as any, toolName);

    if (!schema) {
      throw new AaiError('UNKNOWN_TOOL', `Tool '${toolName}' not found in app '${appIdOrUrl}'`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(schema, null, 2),
        },
      ],
      structuredContent: schema as unknown as Record<string, unknown>,
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

  private async handleMcpImport(
    args: Record<string, unknown> | undefined
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
                '1. Ask the user to confirm keywords, summary, and exposure.',
                '2. Call `mcp:import` again with the same source config plus `keywords`, `summary`, and `exposure`.',
                `3. summary must be at most ${EXPOSURE_LIMITS.summaryLength} characters.`,
                `4. keywords must contain at most ${EXPOSURE_LIMITS.keywordCount} items, each at most ${EXPOSURE_LIMITS.keywordLength} characters.`,
                '5. exposure must be either `summary` or `keywords`.',
              ].join('\n'),
            },
          ],
        };
      }

      const result = await importMcpServer(getMcpExecutor(), this.secureStorage, {
        name: options.name,
        config: options.config,
        headers: options.headers,
        exposureMode: options.metadata.exposureMode,
        keywords: options.metadata.keywords,
        summary: options.metadata.summary,
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

      const capabilities = {
        title: 'MCP Tools',
        tools: result.tools.map((t: { name: string; description?: string }) => ({
          name: t.name,
          description: t.description ?? '',
        })),
      };

      return {
        content: [
          {
            type: 'text',
            text: [
              `Imported MCP app: ${result.descriptor.app.name.default}`,
              `App ID: ${result.entry.appId}`,
              `App tool name after restart: app:${result.entry.appId}`,
              `Descriptor: ${result.entry.descriptorPath}`,
              `Exposure mode: ${options.metadata.exposureMode}`,
              `Keywords: ${result.descriptor.exposure.keywords.join(', ')}`,
              `Summary: ${result.descriptor.exposure.summary}`,
              ...describeExposureBehavior(options.metadata.exposureMode, result.descriptor.exposure),
              '请重启后，才能使用新导入的工具。',
              '',
              generateAppGuide(result.entry.appId, result.descriptor, capabilities),
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
      return createToolErrorResult('MCP import failed.', err);
    }
  }

  private async handleSkillImport(
    args: Record<string, unknown> | undefined
  ): Promise<CallToolResult> {
    try {
      const options = parseSkillImportArguments(args);
      logger.info(
        {
          tool: 'skill:import',
          phase: options.metadata ? 'import' : 'inspect',
          request: summarizeSkillImportRequest(options),
        },
        'Skill import request started'
      );

      if (!options.metadata) {
        const preview = await discoverSkillImport({
          path: options.path,
          url: options.url,
        });

        logger.info(
          {
            tool: 'skill:import',
            phase: 'inspect',
            appId: preview.appId,
            appName: preview.name,
          },
          'Skill import inspection completed'
        );

        return {
          content: [
            {
              type: 'text',
              text: [
                'Skill inspection completed. No import record has been created yet.',
                `App name: ${preview.name}`,
                `Opening description: ${preview.description ?? '(not found in front matter)'}`,
                '',
                'Next step:',
                '1. Ask the user to confirm keywords, summary, and exposure.',
                '2. Call `skill:import` again with the same source plus `keywords`, `summary`, and `exposure`.',
                `3. summary must be at most ${EXPOSURE_LIMITS.summaryLength} characters.`,
                `4. keywords must contain at most ${EXPOSURE_LIMITS.keywordCount} items, each at most ${EXPOSURE_LIMITS.keywordLength} characters.`,
                '5. exposure must be either `summary` or `keywords`.',
              ].join('\n'),
            },
          ],
        };
      }

      const result = await importSkill({
        path: options.path,
        url: options.url,
        exposureMode: options.metadata.exposureMode,
        keywords: options.metadata.keywords,
        summary: options.metadata.summary,
      });

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
          tools: [{ name: 'read', description: 'Read the skill documentation' }],
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
              `Exposure mode: ${options.metadata.exposureMode}`,
              `Keywords: ${result.descriptor.exposure.keywords.join(', ')}`,
              `Summary: ${result.descriptor.exposure.summary}`,
              ...describeExposureBehavior(options.metadata.exposureMode, result.descriptor.exposure),
              '请重启后，才能使用新导入的工具。',
              '',
              generateAppGuide(result.appId, result.descriptor, capabilities),
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
      const options = parseSearchDiscoverArguments(args);
      return {
        content: [
          {
            type: 'text',
            text: buildSearchDiscoverResponse(options),
          },
        ],
      };
    } catch (err) {
      throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
    }
  }

  private async handleExec(
    _request: CallToolRequest,
    requestId: string | number,
    appIdOrUrl: string | undefined,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    if (!appIdOrUrl || appIdOrUrl === 'gateway') {
      if (isGatewayExecutionTool(toolName)) {
        return this.executeGatewayTool(toolName, args);
      }

      throw new AaiError('INVALID_REQUEST', "aai:exec requires 'app' for app tools");
    }

    const resolved = await this.resolveApp(appIdOrUrl);
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
      this.callerIdentity ?? { name: 'Unknown Client' }
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
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    if (toolName === 'mcp:import') {
      return this.handleMcpImport(args);
    }

    if (toolName === 'skill:import') {
      return this.handleSkillImport(args);
    }

    if (toolName === SEARCH_DISCOVER_TOOL_NAME) {
      return this.handleSearchDiscover(args);
    }

    throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
  }

  private async resolveApp(appIdOrUrl: string): Promise<RuntimeAppRecord> {
    const existing = this.appRegistry.get(appIdOrUrl);
    if (existing) return existing;

    const normalizedUrl = normalizeUrl(appIdOrUrl);
    const descriptor = await fetchWebDescriptor(normalizedUrl);
    return {
      appId: deriveAppId(`web:${new URL(normalizedUrl).hostname}`, 'web'),
      descriptor,
      source: 'web',
      location: normalizedUrl,
    };
  }

  /**
   * Get executor instance for a protocol
   */
  private getExecutor(protocol: string): Executor {
    switch (protocol) {
      case 'mcp':
        return getMcpExecutor(this.secureStorage);
      case 'acp-agent':
        return getAcpExecutor();
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
    const timeoutMs = this.getDownstreamInactivityTimeoutMs(descriptor);

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

  private getDownstreamInactivityTimeoutMs(descriptor: AaiJson): number {
    if (isMcpAccess(descriptor.access)) {
      return descriptor.access.config.timeout ?? MCP_DOWNSTREAM_INACTIVITY_TIMEOUT_MS;
    }

    if (isAcpAgentAccess(descriptor.access)) {
      return ACP_DOWNSTREAM_INACTIVITY_TIMEOUT_MS;
    }

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

function truncateLogPreview(value: string, maxChars = 160): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function parseMcpImportArguments(args: Record<string, unknown> | undefined): {
  name?: string;
  config: McpConfig;
  headers?: Record<string, string>;
  metadata?: {
    exposureMode: ExposureMode;
    keywords: string[];
    summary: string;
  };
} {
  try {
    return {
      name: asOptionalString(args?.name),
      config: buildMcpImportConfig({
        transport:
          args?.transport === 'streamable-http' || args?.transport === 'sse'
            ? args.transport
            : undefined,
        url: asOptionalString(args?.url),
        command: asOptionalString(args?.command),
        timeout: asOptionalPositiveInteger(args?.timeout, 'timeout'),
        args: asOptionalStringArray(args?.args, 'args'),
        env: asOptionalStringRecord(args?.env, 'env'),
        cwd: asOptionalString(args?.cwd),
      }),
      headers: validateAndReturnHeaders(args?.headers),
      metadata: parseOptionalExposureMetadata(args),
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
  path?: string;
  url?: string;
  metadata?: {
    exposureMode: ExposureMode;
    keywords: string[];
    summary: string;
  };
} {
  try {
    const source = buildSkillImportSource({
      path: asOptionalString(args?.path),
      url: asOptionalString(args?.url),
    });

    return {
      path: source.path,
      url: source.url,
      metadata: parseOptionalExposureMetadata(args),
    };
  } catch (err) {
    throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
  }
}

function parseOptionalExposureMetadata(args: Record<string, unknown> | undefined):
  | {
      exposureMode: ExposureMode;
      keywords: string[];
      summary: string;
    }
  | undefined {
  const hasExposure = args?.exposure !== undefined;
  const hasKeywords = args?.keywords !== undefined;
  const hasSummary = args?.summary !== undefined;
  const providedCount = Number(hasExposure) + Number(hasKeywords) + Number(hasSummary);

  if (providedCount === 0) {
    return undefined;
  }

  if (providedCount !== 3) {
    throw new Error(
      "Import requires 'keywords', 'summary', and 'exposure' together. Omit all three for inspection, or provide all three for the final import."
    );
  }

  const exposureMode = parseExposureMode(args?.exposure);
  const keywords = asNonEmptyStringArray(args?.keywords);
  const summary = asOptionalString(args?.summary);

  if (!summary) {
    throw new Error("Import received an empty 'summary'");
  }

  return {
    exposureMode,
    ...normalizeExposureInput({ keywords, summary }),
  };
}

function parseExposureMode(value: unknown): ExposureMode {
  if (value === 'summary' || value === 'keywords') {
    return value;
  }

  throw new Error("Import requires 'exposure' to be either 'summary' or 'keywords'");
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

function asNonEmptyStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new AaiError('INVALID_REQUEST', "Expected 'keywords' to be an array of strings");
  }

  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new AaiError('INVALID_REQUEST', "Import received an empty 'keywords' array");
  }

  return Array.from(new Set(items)).slice(0, 8);
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

function describeExposureBehavior(
  exposureMode: ExposureMode,
  exposure: AaiJson['exposure']
): string[] {
  const keywordHint = exposure.keywords.join(', ');
  if (exposureMode === 'keywords') {
    return [
      `Trigger behavior: this imported app is optimized for explicit term matching. It is more likely to be selected when the request includes related words such as ${keywordHint}.`,
      `Trigger summary: ${exposure.summary}`,
    ];
  }

  return [
    `Trigger behavior: this imported app is optimized for intent matching. It can be selected when the request matches this summary even if the request does not use the exact keywords.`,
    `Trigger summary: ${exposure.summary}`,
    `Related keywords: ${keywordHint}`,
  ];
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
    ...(typeof args.exposure === 'string' ? { exposure: args.exposure } : {}),
    ...(Array.isArray(args.keywords) ? { keywordsCount: args.keywords.length } : {}),
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
    exposureMode: ExposureMode;
    keywords: string[];
    summary: string;
  };
}): Record<string, unknown> {
  return {
    ...(options.name ? { name: options.name } : {}),
    config: summarizeMcpConfig(options.config),
    ...(options.headers ? { headerKeys: Object.keys(options.headers) } : {}),
    ...(options.metadata
      ? {
          exposure: options.metadata.exposureMode,
          keywordsCount: options.metadata.keywords.length,
          summaryLength: options.metadata.summary.length,
        }
      : {}),
  };
}

function summarizeSkillImportRequest(options: {
  path?: string;
  url?: string;
  metadata?: {
    exposureMode: ExposureMode;
    keywords: string[];
    summary: string;
  };
}): Record<string, unknown> {
  return {
    ...(options.path ? { path: options.path } : {}),
    ...(options.url ? { url: options.url } : {}),
    ...(options.metadata
      ? {
          exposure: options.metadata.exposureMode,
          keywordsCount: options.metadata.keywords.length,
          summaryLength: options.metadata.summary.length,
        }
      : {}),
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
      name: 'remote:discover',
      description:
        'Discover a web app by fetching https://<host>/.well-known/aai.json and return its guide.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Host, domain, or URL' },
        },
        required: ['url'],
      },
    },
    {
      name: 'aai:schema',
      description:
        'Fetch the detailed JSON schema for one tool. For app tools, pass both app and tool. For gateway tools, pass tool only.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description:
              'Optional for gateway tools. Required for app tools. Accepts an app id like "acp-codex", "app:<id>", or a remote URL.',
          },
          tool: {
            type: 'string',
            description: 'Required. Tool name to inspect.',
          },
        },
        required: ['tool'],
      },
    },
    {
      name: 'aai:exec',
      description:
        'Execute an operation. For discovered apps, call app:<id> first, then pass app + tool + args. For gateway guide tools such as mcp:import, skill:import, and search:discover, call the guide tool first, then execute through aai:exec with tool + args and no app (or app: "gateway").',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description:
              'Required for discovered app tools. Omit for gateway guide tools such as mcp:import, skill:import, and search:discover, or use "gateway".',
          },
          tool: { type: 'string' },
          args: { type: 'object', additionalProperties: true },
        },
        required: ['tool'],
      },
    },
    {
      name: 'mcp:import',
      description:
        'Guide tool for importing an MCP server through AAI Gateway. Call this tool to get the full input schema and execution instructions. Execute the import through aai:exec.',
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
            description: `Optional for all MCP imports. Downstream inactivity timeout in milliseconds. If omitted, MCP calls time out after ${MCP_DOWNSTREAM_INACTIVITY_TIMEOUT_MS}ms without any downstream activity. Maximum value: ${IMPORT_LIMITS.timeoutMsMax}.`,
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
          exposure: {
            type: 'string',
            enum: ['summary', 'keywords'],
            description:
              'Optional on the first call, required on the second call. Ask the user to choose before sending the final import. Use "summary" when the user wants the AI to understand when this MCP should be used more broadly. Use "keywords" for lighter context that can fit more tools, but usually needs more explicit keyword mentions to trigger.',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional on the first call, required on the second call. Up to ${EXPOSURE_LIMITS.keywordCount} keywords, each at most ${EXPOSURE_LIMITS.keywordLength} characters.`,
          },
          summary: {
            type: 'string',
            description: `Optional on the first call, required on the second call. A short summary that explains when this MCP should be used. Maximum length: ${EXPOSURE_LIMITS.summaryLength} characters.`,
          },
        },
        examples: [
          {
            name: 'Playwright',
            command: 'npx',
            args: ['@playwright/mcp@latest'],
          },
          {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/repo'],
          },
          {
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer <token>' },
            exposure: 'keywords',
            keywords: ['issues', 'linear', 'projects'],
            summary: 'Use this MCP for Linear issue and project operations.',
          },
          {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/repo'],
            exposure: 'keywords',
            keywords: ['files', 'read', 'write'],
            summary:
              'Use this MCP for local filesystem operations inside the imported directory.',
          },
        ],
      },
      listInputSchema: buildGuideOnlyInputSchema(),
    },
    {
      name: 'skill:import',
      description:
        'Guide tool for importing a skill through AAI Gateway. Call this tool to get the full input schema and execution instructions. Execute the import through aai:exec.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `Required. Path to a directory containing SKILL.md and companion files. Maximum length: ${IMPORT_LIMITS.pathLength} characters. For remote skills: download and extract first, then provide the local path.`,
          },
          exposure: {
            type: 'string',
            enum: ['summary', 'keywords'],
            description:
              'Optional on the first call, required on the second call. Ask the user to choose before sending the final import. Use "summary" when the user wants the AI to understand when this skill should be used more broadly. Use "keywords" for lighter context that can fit more tools, but usually needs more explicit keyword mentions to trigger.',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional on the first call, required on the second call. Up to ${EXPOSURE_LIMITS.keywordCount} keywords, each at most ${EXPOSURE_LIMITS.keywordLength} characters.`,
          },
          summary: {
            type: 'string',
            description: `Optional on the first call, required on the second call. A short summary that explains when this skill should be used. Maximum length: ${EXPOSURE_LIMITS.summaryLength} characters.`,
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
      name: 'skill:create',
      description:
        'Guide for creating AAI Gateway compatible skills. Use this when the user wants to package a workflow or process as a reusable skill. Returns skill structure template and best practices.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: SEARCH_DISCOVER_TOOL_NAME,
      description:
        'Guide tool for MCP and skill discovery through AAI Gateway. Call this tool to get the full input schema and execution instructions. Execute the search through aai:exec.',
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
    description:
      'Call this tool without arguments to get the detailed input schema and execution guidance.',
  };
}

function getGatewayToolDefinition(toolName: string): GatewayToolDefinition | undefined {
  return buildGatewayToolDefinitions().find((tool) => tool.name === toolName);
}

function buildSchemaResponseDocument(tool: {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
  };
}

function isGatewayExecutionTool(toolName: string): boolean {
  return (
    toolName === 'mcp:import' ||
    toolName === 'skill:import' ||
    toolName === SEARCH_DISCOVER_TOOL_NAME
  );
}

function generateGatewayToolGuide(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): string {
  const schema = buildSchemaResponseDocument(tool);
  return [
    `# ${tool.name}`,
    '',
    tool.description,
    '',
    '## Input Schema',
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    '',
    '## Execution',
    '',
    `Call \`aai:exec\` with \`{ tool: "${tool.name}", args: { ... } }\`. Omit \`app\`, or set \`app: "gateway"\`.`,
  ].join('\n');
}

function formatToolPreview(tools: Array<{ name: string; description?: string }>): string {
  if (tools.length === 0) {
    return 'No MCP tools reported.';
  }

  return tools.map((tool) => `- ${tool.name}: ${tool.description ?? ''}`.trimEnd()).join('\n');
}
