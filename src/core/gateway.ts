/**
 * Gateway — Core Business Logic
 *
 * Handles all AAI Gateway operations: app resolution, import,
 * enable/disable, guide generation, and tool execution.
 * Protocol-agnostic — does not depend on MCP types.
 */

import type { RuntimeAppRecord } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';
import { AaiError } from '../errors/errors.js';
import { getMcpExecutor } from '../executors/mcp.js';
import { loadManagedDescriptors } from '../storage/managed-registry.js';
import {
  disableAppForAgent,
  enableAppForAgent,
  loadAppPolicyState,
  upsertAgentState,
} from '../storage/agent-state.js';
import { getDotenvPath } from '../utils/dotenv.js';
import { discoverMcpImport, EXPOSURE_LIMITS } from './importer.js';
import {
  SEARCH_DISCOVER_TOOL_NAME,
  buildSearchDiscoverResponse,
  parseSearchDiscoverArguments,
} from './search-guidance.js';
import type { ParsedMcpImportArgs, ParsedSkillImportArgs } from './parsers.js';
import {
  parseMcpImportArguments,
  parseSkillImportArguments,
  summarizeMcpImportRequest,
  summarizeSkillImportRequest,
  summarizeRawImportArgs,
  summarizeExecArgs,
  summarizeExecResult,
} from './parsers.js';
import type { CallerContext } from '../types/caller.js';
import {
  buildGatewayToolDefinitions,
  getGatewayToolDefinition,
  generateGatewayToolGuide,
  isGatewayExecutionTool,
  type GatewayToolDefinition,
} from './tool-definitions.js';
import { AppRegistry } from './app-registry.js';
import { ExecutionCoordinator } from './execution-coordinator.js';
import { GuideService } from './guide-service.js';
import { ImportService } from './import-service.js';
import { seedPrebuiltDescriptors } from './seed.js';
import { BackgroundTaskManager } from './background/task-manager.js';
import { AcpPrewarmBackgroundTask } from './background/acp-prewarm-task.js';
import { TurnCleanupTask } from './background/turn-cleanup.js';
import { deriveCallerId } from '../storage/agent-state.js';

// ============================================================
// Result types (protocol-agnostic)
// ============================================================

export interface GatewayTextResult {
  text: string;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface GatewayToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ============================================================
// Gateway class
// ============================================================

export class Gateway {
  private readonly appRegistry = new AppRegistry();
  private readonly guideService = new GuideService();
  private executionCoordinator!: ExecutionCoordinator;
  private importService!: ImportService;
  private readonly backgroundTasks = new BackgroundTaskManager();

  async initialize(): Promise<void> {
    this.executionCoordinator = new ExecutionCoordinator();
    this.importService = new ImportService(this.appRegistry);

    // Seed pre-built descriptors (always overwrite)
    await seedPrebuiltDescriptors();

    // Load all managed descriptors (imports + seeded)
    await this.appRegistry.loadFromDiscovery(() => loadManagedDescriptors());

    // Start background tasks
    this.backgroundTasks.register(new AcpPrewarmBackgroundTask(this.appRegistry));
    this.backgroundTasks.register(new TurnCleanupTask());
    await this.backgroundTasks.startAll();
  }

  // ============================================================
  // Caller identity
  // ============================================================

  createCallerContext(clientVersion: { name?: string; version?: string } | undefined): CallerContext {
    const name = clientVersion?.name?.trim() || 'Unknown Client';
    return {
      id: deriveCallerId({ callerName: name }),
      name,
      version: clientVersion?.version,
      transport: 'mcp',
      type: 'unknown',
    };
  }

  // ============================================================
  // Tool listing
  // ============================================================

  async listTools(caller: CallerContext): Promise<GatewayToolInfo[]> {
    const visibleApps = await this.listVisibleApps(caller);
    return [
      ...visibleApps.map((app) => ({
        name: `app:${app.appId}`,
        description: this.guideService.generateToolSummary(app.appId, app.descriptor),
        inputSchema: { type: 'object' as const, properties: {} },
      })),
      ...buildGatewayToolDefinitions().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.listInputSchema ?? tool.inputSchema,
      })),
    ];
  }

  getGatewayToolDefinition(name: string): GatewayToolDefinition | undefined {
    return getGatewayToolDefinition(name);
  }

  // ============================================================
  // App guide
  // ============================================================

  async handleAppGuide(appId: string, caller: CallerContext): Promise<GatewayTextResult> {
    const result = await this.resolveManagedApp(appId, caller);
    if (!result) {
      throw new AaiError('UNKNOWN_APP', `App not found: ${appId}`);
    }
    if ('disabled' in result) {
      throw new AaiError(
        'UNKNOWN_APP',
        `App "${appId}" is currently disabled for this agent. To enable it, call the enableApp tool with app: "${appId}". Please present this message to the user in their preferred language.`
      );
    }

    const { descriptor } = result.app;
    const access = descriptor.access;
    const executor = this.executionCoordinator.getExecutor(access.protocol);
    const capabilities = await executor.loadAppCapabilities(appId, access.config as any);

    return {
      text: this.guideService.generateAppGuide(appId, descriptor, capabilities),
    };
  }

  // ============================================================
  // Gateway tool guide (mcp:import, skill:import)
  // ============================================================

  handleGatewayToolGuide(toolName: string): GatewayTextResult {
    const tool = getGatewayToolDefinition(toolName);
    if (!tool) {
      throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
    }
    return { text: generateGatewayToolGuide(tool) };
  }

  // ============================================================
  // Exec
  // ============================================================

  async handleExec(
    requestId: string | number,
    appIdOrUrl: string | undefined,
    toolName: string,
    args: Record<string, unknown>,
    caller: CallerContext
  ): Promise<GatewayTextResult> {
    if (!appIdOrUrl || appIdOrUrl === 'gateway') {
      if (isGatewayExecutionTool(toolName)) {
        return this.executeGatewayTool(toolName, args, caller);
      }
      throw new AaiError('INVALID_REQUEST', "aai:exec requires 'app' for app tools");
    }

    const resolved = await this.resolveApp(appIdOrUrl, caller);
    const startedAt = Date.now();

    try {
      const result = await this.executionCoordinator.executeWithInactivityTimeout(
        resolved.appId,
        resolved.descriptor,
        toolName,
        args
      );
      logger.info(
        {
          requestId,
          app: resolved.appId,
          tool: toolName,
          durationMs: Date.now() - startedAt,
          args: summarizeExecArgs(args),
          result: summarizeExecResult(result),
        },
        'aai:exec completed'
      );
      return this.toTextResult(result);
    } catch (err) {
      logger.error(
        {
          requestId,
          app: resolved.appId,
          tool: toolName,
          durationMs: Date.now() - startedAt,
          err,
        },
        'aai:exec failed'
      );
      throw err;
    }
  }

  // ============================================================
  // MCP Import
  // ============================================================

  async handleMcpImport(
    options: ParsedMcpImportArgs,
    rawArgs: Record<string, unknown> | undefined,
    caller: CallerContext
  ): Promise<GatewayTextResult> {
    try {
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
        };
      }

      const result = await this.importService.importMcp(
        {
          name: options.name,
          config: options.config,
          summary: options.metadata.summary,
          enableScope: options.metadata.enableScope,
        },
        caller
      );

      logger.info(
        {
          tool: 'mcp:import',
          phase: 'import',
          appId: result.appId,
          descriptorPath: result.managedPath,
          toolCount: result.tools.length,
        },
        'MCP import completed'
      );

      const capabilities = {
        title: 'MCP Tools',
        tools: result.tools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema ?? { type: 'object' as const, properties: {} },
        })),
      };

      return {
        text: [
          `Imported MCP app: ${result.descriptor.app.name.default}`,
          `App ID: ${result.appId}`,
          `App tool prefix: app:${result.appId}`,
          `Descriptor: ${result.managedPath}`,
          `Summary: ${result.descriptor.exposure.summary}`,
          `Default enabled for: ${options.metadata.enableScope === 'current' ? 'importing agent only' : 'all agents'}`,
          '',
          this.guideService.generateAppGuide(result.appId, result.descriptor, capabilities),
        ].join('\n'),
      };
    } catch (err) {
      logger.error(
        { tool: 'mcp:import', request: summarizeRawImportArgs(rawArgs), err },
        'MCP import failed'
      );

      if (isMissingEnvVarsError(err)) {
        return buildMissingEnvVarsResult(err);
      }

      return createErrorResult('MCP import failed.', err);
    }
  }

  // ============================================================
  // Skill Import
  // ============================================================

  async handleSkillImport(
    options: ParsedSkillImportArgs,
    rawArgs: Record<string, unknown> | undefined,
    caller: CallerContext
  ): Promise<GatewayTextResult> {
    try {
      logger.info(
        {
          tool: 'skill:import',
          phase: 'import',
          request: summarizeSkillImportRequest(options),
        },
        'Skill import request started'
      );

      const result = await this.importService.importSkill({ path: options.path }, caller);

      logger.info(
        {
          tool: 'skill:import',
          phase: 'import',
          appId: result.appId,
          managedPath: result.managedPath,
        },
        'Skill import completed'
      );

      const executor = this.executionCoordinator.getExecutor(result.descriptor.access.protocol);
      let capabilities;
      try {
        capabilities = await executor.loadAppCapabilities(
          result.appId,
          result.descriptor.access.config as any
        );
      } catch {
        capabilities = {
          title: 'Skill',
          tools: [
            {
              name: 'read',
              description: 'Read the skill documentation',
              inputSchema: { type: 'object' as const, properties: {} },
            },
          ],
        };
      }

      return {
        text: [
          `Imported skill: ${result.descriptor.app.name.default}`,
          `App ID: ${result.appId}`,
          `App tool prefix: app:${result.appId}`,
          `Skill directory: ${result.managedPath}`,
          `Summary: ${result.descriptor.exposure.summary}`,
          'Default enabled for: importing agent only',
          '',
          this.guideService.generateAppGuide(result.appId, result.descriptor, capabilities),
        ].join('\n'),
      };
    } catch (err) {
      logger.error(
        { tool: 'skill:import', request: summarizeRawImportArgs(rawArgs), err },
        'Skill import failed'
      );
      return createErrorResult('Skill import failed.', err);
    }
  }

  // ============================================================
  // Search / Discover
  // ============================================================

  handleSearchDiscover(args: Record<string, unknown> | undefined): GatewayTextResult {
    try {
      parseSearchDiscoverArguments(args);
      return { text: buildSearchDiscoverResponse() };
    } catch (err) {
      throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
    }
  }

  // ============================================================
  // List / Enable / Disable / Remove
  // ============================================================

  async handleListAllApps(caller: CallerContext): Promise<GatewayTextResult> {
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
      text: JSON.stringify(payload, null, 2),
      structuredContent: payload,
    };
  }

  async handleDisableApp(
    args: Record<string, unknown> | undefined,
    caller: CallerContext
  ): Promise<GatewayTextResult> {
    const appId = typeof args?.app === 'string' ? args.app.trim() : '';
    if (!appId) {
      throw new AaiError('INVALID_REQUEST', "disableApp requires 'app'");
    }

    await this.resolveManageableApp(appId);
    await disableAppForAgent(caller.id, appId);

    const payload = { app: appId, disabledFor: caller.id };
    return {
      text: JSON.stringify(payload, null, 2),
      structuredContent: payload,
    };
  }

  async handleEnableApp(
    args: Record<string, unknown> | undefined,
    caller: CallerContext
  ): Promise<GatewayTextResult> {
    const appId = typeof args?.app === 'string' ? args.app.trim() : '';
    if (!appId) {
      throw new AaiError('INVALID_REQUEST', "enableApp requires 'app'");
    }

    await this.resolveManageableApp(appId);
    await enableAppForAgent(caller.id, appId);

    const payload = { app: appId, enabledFor: caller.id };
    return {
      text: JSON.stringify(payload, null, 2),
      structuredContent: payload,
    };
  }

  async handleRemoveApp(
    args: Record<string, unknown> | undefined,
    _caller: CallerContext
  ): Promise<GatewayTextResult> {
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

    await this.importService.removeApp(appId);

    const payload = { app: appId, removedFrom: 'all-agents' };
    return {
      text: JSON.stringify(payload, null, 2),
      structuredContent: payload,
    };
  }

  // ============================================================
  // Notification hook (called by server after state changes)
  // ============================================================

  get toolsChanged(): boolean {
    // marker for server to check; or use callback
    return false;
  }

  // ============================================================
  // Internal: Gateway tool routing
  // ============================================================

  private async executeGatewayTool(
    toolName: string,
    args: Record<string, unknown>,
    caller: CallerContext
  ): Promise<GatewayTextResult> {
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
    if (toolName === 'mcp:import') {
      return this.handleMcpImport(parseMcpImportArguments(args), args, caller);
    }
    if (toolName === 'skill:import') {
      return this.handleSkillImport(parseSkillImportArguments(args), args, caller);
    }
    throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
  }

  // ============================================================
  // Internal: App resolution
  // ============================================================

  private async resolveManagedApp(
    appId: string,
    caller: CallerContext
  ): Promise<{ app: RuntimeAppRecord } | { disabled: true; appId: string } | undefined> {
    const existing = this.appRegistry.get(appId);
    if (!existing) return undefined;

    if (await this.isAppEnabledForCaller(existing, caller)) {
      return { app: existing };
    }
    return { disabled: true, appId };
  }

  private async resolveManageableApp(appId: string): Promise<RuntimeAppRecord> {
    const existing = this.appRegistry.get(appId);
    if (!existing) {
      throw new AaiError('UNKNOWN_APP', `App not found: ${appId}`);
    }
    return existing;
  }

  private async resolveApp(appIdOrUrl: string, caller: CallerContext): Promise<RuntimeAppRecord> {
    const result = await this.resolveManagedApp(appIdOrUrl, caller);
    if (result && 'app' in result) return result.app;
    if (result && 'disabled' in result) {
      throw new AaiError(
        'UNKNOWN_APP',
        `App "${appIdOrUrl}" is currently disabled for this agent. To enable it, call the enableApp tool with app: "${appIdOrUrl}". Please present this message to the user in their preferred language.`
      );
    }
    throw new AaiError('UNKNOWN_APP', `App not found: ${appIdOrUrl}`);
  }

  // ============================================================
  // Internal: Visibility
  // ============================================================

  private async listVisibleApps(caller: CallerContext): Promise<RuntimeAppRecord[]> {
    const apps = Array.from(this.appRegistry.values());
    const enabledApps = await Promise.all(
      apps.map(async (app) => ((await this.isAppEnabledForCaller(app, caller)) ? app : null))
    );
    return enabledApps.filter((app): app is RuntimeAppRecord => app !== null);
  }

  private async listManageableApps(caller: CallerContext): Promise<
    Array<{ app: RuntimeAppRecord; enabled: boolean }>
  > {
    const apps = Array.from(this.appRegistry.values());
    return Promise.all(
      apps.map(async (app) => ({
        app,
        enabled: await this.isAppEnabledForCaller(app, caller),
      }))
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
    });

    const override = agentState.appOverrides[app.appId];
    if (override === 'enabled') return true;
    if (override === 'disabled') return false;

    const policy = await loadAppPolicyState(app.appId);
    if (!policy || policy.defaultEnabled === 'all') return true;

    return policy.importerAgentId === caller.id;
  }

  // ============================================================
  // Internal: Result formatting
  // ============================================================

  private toTextResult(result: unknown): GatewayTextResult {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return {
        text: JSON.stringify(result, null, 2),
        structuredContent: result as Record<string, unknown>,
      };
    }
    return {
      text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    };
  }
}

// ============================================================
// Standalone helpers
// ============================================================

function formatToolPreview(tools: Array<{ name: string; description?: string }>): string {
  if (tools.length === 0) return 'No MCP tools reported.';
  return tools.map((tool) => `- ${tool.name}: ${tool.description ?? ''}`.trimEnd()).join('\n');
}

export function createErrorResult(summary: string, err: unknown): GatewayTextResult {
  const details: string[] = [summary];

  if (err instanceof AaiError) {
    details.push(`Error: ${err.message}`);
    if (err.data && Object.keys(err.data).length > 0) {
      details.push('', 'Details:', JSON.stringify(err.data, null, 2));
    }
  } else if (err instanceof Error) {
    details.push(`Error: ${err.message}`);
  } else {
    details.push(`Error: ${String(err)}`);
  }

  return { text: details.join('\n'), isError: true };
}

function isMissingEnvVarsError(err: unknown): boolean {
  if (err instanceof AaiError) {
    const data = err.data as Record<string, unknown> | undefined;
    if (data?.code === 'MISSING_ENV_VARS') return true;
  }
  if (err instanceof Error && /Missing environment variables/i.test(err.message)) return true;
  return false;
}

function extractMissingVarNames(err: unknown): string[] {
  if (err instanceof AaiError) {
    const data = err.data as Record<string, unknown> | undefined;
    if (Array.isArray(data?.missingVars)) return data.missingVars as string[];
  }
  if (err instanceof Error) {
    const matches = err.message.match(/\$\{([^}]+)\}/g);
    if (matches) return matches.map((m) => m.slice(2, -1));
  }
  return [];
}

function buildMissingEnvVarsResult(err: unknown): GatewayTextResult {
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
        `- \`${v}\`: search the web for where to obtain this key (e.g. the provider\'s developer portal or API dashboard).`
    ),
    '',
    '### Step 2 — Save to the AAI env file',
    '',
    `Open the env file for the user with a shell command:`,
    '```',
    `open ${envFile}`,
    '```',
    `Tell the user which variables are needed, where to obtain them, and the format:`,
    '```',
    ...varList.map((v) => `${v}=<paste_value_here>`),
    '```',
    '',
    '> **CRITICAL**: Never ask the user to send API keys, tokens, or secrets in chat. Never offer to write secrets into files for the user.',
    '> Instead, run `open` via shell to open the env file, tell the user the variable name and format, and let them paste the value themselves.',
    '',
    '### Step 3 — Retry',
    '',
    'No restart is needed. After the user confirms the values have been saved, retry the import by calling `aai:exec` with the same `mcp:import` parameters.',
    'Do NOT call `mcp:import` directly — that only returns the guide. You must use `aai:exec`.',
  ];

  return { text: lines.join('\n'), isError: true };
}
