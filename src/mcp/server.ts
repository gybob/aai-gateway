import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type CreateTaskResult,
} from '@modelcontextprotocol/sdk/types.js';

import { createConsentDialog } from '../consent/dialog/index.js';
import { ConsentManager } from '../consent/manager.js';
import { createDiscoveryManager, type DiscoveryOptions } from '../discovery/index.js';
import { fetchWebDescriptor, normalizeUrl } from '../discovery/web.js';
import { AaiError } from '../errors/errors.js';
import { getAcpExecutor } from '../executors/acp.js';
import {
  legacyExecuteCli as executeCli,
  legacyLoadCliDetail as loadCliDetail,
} from '../executors/cli.js';
import { getMcpExecutor } from '../executors/mcp.js';
import {
  legacyExecuteSkill as executeSkill,
  legacyLoadSkillDetail as loadSkillDetail,
} from '../executors/skill.js';
import { createSecureStorage, type SecureStorage } from '../storage/secure-storage/index.js';
import {
  getMcpRegistryEntry,
  type McpRegistryEntry,
  upsertMcpRegistryEntry,
} from '../storage/mcp-registry.js';
import { upsertSkillRegistryEntry } from '../storage/skill-registry.js';
import type { AaiJson, DetailedCapability, McpConfig, RuntimeAppRecord } from '../types/aai-json.js';
import {
  getLocalizedName,
  isAcpAgentAccess,
  isCliAccess,
  isMcpAccess,
  isSkillAccess,
  isSkillPathConfig,
} from '../types/aai-json.js';
import type { CallerIdentity } from '../types/consent.js';
import { deriveLocalId } from '../utils/ids.js';
import { getSystemLocale } from '../utils/locale.js';
import { logger } from '../utils/logger.js';

import {
  generateAppListDescription,
  generateOperationGuide,
} from '../guides/app-guide-generator.js';
import {
  buildMcpImportConfig,
  buildSkillExposure,
  type ExposureMode,
  buildSkillImportSource,
  importMcpServer,
  importSkill,
  loadImportedMcpHeaders,
  refreshImportedMcpServer,
} from './importer.js';
import { McpTaskRunner } from './task-runner.js';
import type { ExecutionObserver } from '../executors/events.js';

/**
 * How often the keepalive heartbeat fires for long-running ACP prompts (ms).
 * Must be well below the default MCP client request timeout (60 s).
 */
const ACP_KEEPALIVE_INTERVAL_MS = 15_000;
const DOWNSTREAM_INACTIVITY_TIMEOUT_MS = 300_000;
const ACP_DOWNSTREAM_INACTIVITY_TIMEOUT_MS = 180_000;

export class AaiGatewayServer {
  private readonly server: Server;
  private readonly options: DiscoveryOptions;
  private readonly taskRunner: McpTaskRunner;
  private readonly appRegistry = new Map<string, RuntimeAppRecord>();
  private consentManager!: ConsentManager;
  private secureStorage!: SecureStorage;
  private callerIdentity?: CallerIdentity;
  private discoveryManager?: import('../discovery/manager.js').DiscoveryManager;

  constructor(options?: DiscoveryOptions) {
    this.options = options ?? {};
    const taskStore = new InMemoryTaskStore();
    this.server = new Server(
      { name: 'aai-gateway', version: '0.4.0' },
      {
        capabilities: {
          tools: {},
          logging: {},
          tasks: {
            list: {},
            cancel: {},
            requests: {
              tools: {
                call: {},
              },
            },
          },
        },
        taskStore,
      }
    );
    this.taskRunner = new McpTaskRunner(this.server, taskStore);
    this.setupHandlers();
  }

  async initialize(): Promise<void> {
    this.secureStorage = createSecureStorage();
    this.consentManager = new ConsentManager(this.secureStorage, createConsentDialog());

    // Create and use DiscoveryManager
    const { manager } = createDiscoveryManager();
    this.discoveryManager = manager;

    try {
      const discoveredApps = await this.discoveryManager.scanAll(this.options);
      for (const app of discoveredApps) {
        this.appRegistry.set(app.localId, app);
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
        .connect(app.localId, config)
        .then(() => {
          logger.info({ localId: app.localId }, 'ACP agent pre-warm completed');
        })
        .catch((err) => {
          logger.warn(
            { localId: app.localId, err },
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
        execution?: { taskSupport: 'optional' };
      }> = Array.from(this.appRegistry.values()).map((app) => ({
        name: `app:${app.localId}`,
        description: generateAppListDescription(app.localId, app.descriptor),
        inputSchema: { type: 'object', properties: {} },
      }));

      tools.push({
        name: 'remote:discover',
        description:
          'Discover a web app by fetching https://<host>/.well-known/aai.json and return its guide.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Host, domain, or URL' },
          },
          required: ['url'],
        } as Record<string, unknown>,
      });

      tools.push({
        name: 'aai:exec',
        description:
          'Execute an operation for a discovered app. Parameters: app, tool, args, task, progressToken.',
        inputSchema: {
          type: 'object',
          properties: {
            app: { type: 'string' },
            tool: { type: 'string' },
            args: { type: 'object', additionalProperties: true },
            task: {
              type: 'object',
              description:
                'MCP task augmentation. For long-running ACP prompts (e.g. "prompt", "session/prompt"), set to {} to enable async task mode and avoid request timeouts.',
              additionalProperties: true,
            },
            progressToken: {
              type: 'string',
              description:
                'MCP progress token for progress notifications. The server will send periodic notifications to reset the client request timeout.',
            },
          },
          required: ['app', 'tool'],
        } as Record<string, unknown>,
        execution: { taskSupport: 'optional' },
      });

      tools.push({
        name: 'mcp:import',
        description:
          'Import an MCP server into AAI Gateway managed apps so it becomes available to app:<generated-id> and aai:exec. Match the CLI import shape: use command plus optional args/env/cwd for a local stdio server, or use url plus optional transport ("streamable-http" by default, or "sse") and headers for a remote server. Before calling this tool, ask the user whether they want exposure mode "summary" or "keywords"; do not choose it silently.',
        inputSchema: {
          type: 'object',
          properties: {
            transport: {
              type: 'string',
              enum: ['streamable-http', 'sse'],
              description:
                'Optional. Only used with url for remote MCP imports. Defaults to "streamable-http".',
            },
            command: {
              type: 'string',
              description:
                'Use this for a local stdio MCP import. The executable to launch, for example "npx" or "uvx". If command is present, the import is treated as stdio.',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional for local stdio MCP imports. Command arguments, for example ["-y", "@modelcontextprotocol/server-filesystem", "/repo"].',
            },
            env: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Optional for local stdio MCP imports. Environment variables passed to the MCP process.',
            },
            cwd: {
              type: 'string',
              description: 'Optional for local stdio MCP imports. Working directory used when launching the MCP process.',
            },
            url: {
              type: 'string',
              description:
                'Use this for a remote MCP import. The remote MCP endpoint URL.',
            },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description:
                'Optional for remote transports. HTTP headers such as Authorization for the remote MCP endpoint.',
            },
            exposure: {
              type: 'string',
              enum: ['summary', 'keywords'],
              description:
                'Required. Do not guess this value. Ask the user to choose before calling the tool. Use "summary" when the user wants the AI to understand when this MCP should be used without needing exact trigger words. Use "keywords" when the user wants to leave room for more tools, but is comfortable mentioning related keywords more explicitly to trigger this MCP.',
            },
          },
          required: ['exposure'],
          examples: [
            {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '/repo'],
              exposure: 'summary',
            },
            {
              url: 'https://example.com/mcp',
              headers: { Authorization: 'Bearer <token>' },
              exposure: 'keywords',
            },
          ],
        } as Record<string, unknown>,
      });

      tools.push({
        name: 'mcp:refresh',
        description:
          'Refresh an imported MCP app and regenerate its exposure using either summary mode or keywords mode.',
        inputSchema: {
          type: 'object',
          properties: {
            localId: {
              type: 'string',
              description: 'Required. The localId of a previously imported MCP app.',
            },
            exposure: {
              type: 'string',
              enum: ['summary', 'keywords'],
              description:
                'Required. Regenerate the imported app exposure using summary mode or keywords mode.',
            },
          },
          required: ['localId', 'exposure'],
        } as Record<string, unknown>,
      });

      tools.push({
        name: 'skill:import',
        description:
          'Import a local or remote skill into AAI Gateway managed apps so it becomes available to app:<generated-id> and aai:exec. Use either path for a local skill directory or url for a remote skill root that exposes SKILL.md. Before calling this tool, ask the user whether they want exposure mode "summary" or "keywords"; do not choose it silently.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Use this for a local skill import. Point to a directory containing SKILL.md and any companion files.',
            },
            url: {
              type: 'string',
              description:
                'Use this for a remote skill import. The gateway will fetch <url>/SKILL.md and store it as a managed skill.',
            },
            exposure: {
              type: 'string',
              enum: ['summary', 'keywords'],
              description:
                'Required. Do not guess this value. Ask the user to choose before calling the tool. Use "summary" when the user wants the AI to understand when this skill should be used without needing exact trigger words. Use "keywords" when the user wants to leave room for more tools, but is comfortable mentioning related keywords more explicitly to trigger this skill.',
            },
          },
          required: ['exposure'],
          examples: [
            {
              path: '/absolute/path/to/skill',
              exposure: 'summary',
            },
            {
              url: 'https://example.com/skill',
              exposure: 'keywords',
            },
          ],
        } as Record<string, unknown>,
      });

      tools.push({
        name: 'import:config',
        description:
          'Inspect or update the generated exposure metadata for an imported MCP app or imported skill. Use this after import if you want to change exposure mode, keywords, or summary without re-importing.',
        inputSchema: {
          type: 'object',
          properties: {
            localId: {
              type: 'string',
              description:
                'Optional if app is provided. The imported app id, for example "server-filesystem".',
            },
            app: {
              type: 'string',
              description:
                'Optional if localId is provided. Accepts either "app:<id>" or the plain imported app id.',
            },
            exposure: {
              type: 'string',
              enum: ['summary', 'keywords'],
              description:
                'Optional. Regenerate exposure using summary mode or keywords mode before applying any manual summary or keyword overrides. "keywords" leaves room for more tools, but usually needs more explicit keyword mentions to trigger.',
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional. Replace the generated keywords with these exact keywords. Use this when you want more precise trigger words.',
            },
            summary: {
              type: 'string',
              description:
                'Optional. Replace the generated summary with this exact summary. Use this when you want the AI to understand more clearly when the imported app should be used.',
            },
          },
        } as Record<string, unknown>,
      });

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args } = request.params;

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
          app: string;
          tool: string;
          args?: Record<string, unknown>;
          task?: Record<string, unknown>;
          progressToken?: string | number;
        };
        return this.handleExec(
          request as CallToolRequest,
          extra.requestId,
          payload.app,
          payload.tool,
          payload.args ?? {},
          payload.task,
          payload.progressToken
        );
      }

      if (name === 'mcp:import') {
        return this.handleMcpImport(args as Record<string, unknown> | undefined);
      }

      if (name === 'skill:import') {
        return this.handleSkillImport(args as Record<string, unknown> | undefined);
      }

      if (name === 'mcp:refresh') {
        return this.handleMcpRefresh(args as Record<string, unknown> | undefined);
      }

      if (name === 'import:config') {
        return this.handleImportConfig(args as Record<string, unknown> | undefined);
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

    const detail = await this.loadGuideDetail(app.localId, app.descriptor);
    return {
      content: [
        { type: 'text', text: generateOperationGuide(app.localId, app.descriptor, detail) },
      ],
    };
  }

  private async handleRemoteDiscover(
    url: string
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const descriptor = await fetchWebDescriptor(url);
    const normalizedUrl = normalizeUrl(url);
    const localId = deriveLocalId(`web:${new URL(normalizedUrl).hostname}`, 'web');
    const detail = await this.loadLayer3Detail(localId, descriptor);

    return {
      content: [{ type: 'text', text: generateOperationGuide(localId, descriptor, detail) }],
    };
  }

  private async handleMcpImport(
    args: Record<string, unknown> | undefined
  ): Promise<CallToolResult> {
    const options = parseMcpImportArguments(args);

    const result = await importMcpServer(getMcpExecutor(), this.secureStorage, {
      config: options.config,
      headers: options.headers,
      exposureMode: options.exposureMode,
    });

    this.appRegistry.set(result.entry.localId, {
      localId: result.entry.localId,
      descriptor: result.descriptor,
      source: 'mcp-import',
      location: result.entry.descriptorPath,
    });

    const detail: DetailedCapability = {
      title: 'MCP Tools',
      body:
        result.tools.length === 0
          ? 'No MCP tools reported.'
          : result.tools
            .map((tool) => `- ${tool.name}: ${tool.description ?? ''}`.trimEnd())
            .join('\n'),
    };

    return {
      content: [
        {
          type: 'text',
          text: [
            `Imported MCP app: ${result.entry.localId}`,
            `App tool name after restart: app:${result.entry.localId}`,
            `Descriptor: ${result.entry.descriptorPath}`,
            `Exposure mode: ${options.exposureMode}`,
            `Generated keywords: ${result.descriptor.exposure.keywords.join(', ')}`,
            `Generated summary: ${result.descriptor.exposure.summary}`,
            ...describeExposureBehavior(options.exposureMode, result.descriptor.exposure),
            '请重启后，才能使用新导入的工具。',
            'If you want to change the exposure mode, summary, or keywords later, call `import:config` with this localId.',
            '',
            generateOperationGuide(result.entry.localId, result.descriptor, detail),
          ].join('\n'),
        },
      ],
    };
  }

  private async handleMcpRefresh(
    args: Record<string, unknown> | undefined
  ): Promise<CallToolResult> {
    const localId = asOptionalString(args?.localId);
    if (!localId) {
      throw new AaiError('INVALID_REQUEST', "mcp:refresh requires 'localId'");
    }

    const entry = await this.resolveImportedMcpEntry(localId);
    if (!entry) {
      throw new AaiError('UNKNOWN_APP', `Imported MCP app not found: ${localId}`);
    }

    const exposureMode = parseExposureMode(args?.exposure);

    const result = await refreshImportedMcpServer(
      getMcpExecutor(),
      this.secureStorage,
      entry,
      exposureMode
    );

    this.appRegistry.set(result.entry.localId, {
      localId: result.entry.localId,
      descriptor: result.descriptor,
      source: 'mcp-import',
      location: result.entry.descriptorPath,
    });

    const detail: DetailedCapability = {
      title: 'MCP Tools',
      body:
        result.tools.length === 0
          ? 'No MCP tools reported.'
          : result.tools
            .map((tool) => `- ${tool.name}: ${tool.description ?? ''}`.trimEnd())
            .join('\n'),
    };

    return {
      content: [
        {
          type: 'text',
          text: [
            `Refreshed MCP app: ${result.entry.localId}`,
            `Descriptor: ${result.entry.descriptorPath}`,
            `Exposure mode: ${exposureMode}`,
            `Generated keywords: ${result.descriptor.exposure.keywords.join(', ')}`,
            `Generated summary: ${result.descriptor.exposure.summary}`,
            ...describeExposureBehavior(exposureMode, result.descriptor.exposure),
            '请重启后，才能使用更新后的工具配置。',
            '',
            generateOperationGuide(result.entry.localId, result.descriptor, detail),
          ].join('\n'),
        },
      ],
    };
  }

  private async resolveImportedMcpEntry(localId: string): Promise<McpRegistryEntry | null> {
    const registryEntry = await getMcpRegistryEntry(localId);
    if (registryEntry) {
      return registryEntry;
    }

    const app = this.appRegistry.get(localId);
    if (!app || app.source !== 'mcp-import' || !isMcpAccess(app.descriptor.access) || !app.location) {
      return null;
    }

    return {
      id: localId,
      localId,
      protocol: 'mcp',
      config: app.descriptor.access.config,
      descriptorPath: app.location,
      importedAt: '',
      updatedAt: '',
    };
  }

  private async handleSkillImport(
    args: Record<string, unknown> | undefined
  ): Promise<CallToolResult> {
    const options = parseSkillImportArguments(args);

    const result = await importSkill({
      path: options.path,
      url: options.url,
      exposureMode: options.exposureMode,
    });

    this.appRegistry.set(result.localId, {
      localId: result.localId,
      descriptor: result.descriptor,
      source: 'skill-import',
      location: result.managedPath,
    });

    const detail = await this.loadGuideDetail(result.localId, result.descriptor);
    return {
      content: [
        {
          type: 'text',
          text: [
            `Imported skill: ${result.localId}`,
            `App tool name after restart: app:${result.localId}`,
            `Skill directory: ${result.managedPath}`,
            `Exposure mode: ${options.exposureMode}`,
            `Generated keywords: ${result.descriptor.exposure.keywords.join(', ')}`,
            `Generated summary: ${result.descriptor.exposure.summary}`,
            ...describeExposureBehavior(options.exposureMode, result.descriptor.exposure),
            '请重启后，才能使用新导入的工具。',
            'If you want to change the exposure mode, summary, or keywords later, call `import:config` with this localId.',
            '',
            generateOperationGuide(result.localId, result.descriptor, detail),
          ].join('\n'),
        },
      ],
    };
  }

  private async handleImportConfig(
    args: Record<string, unknown> | undefined
  ): Promise<CallToolResult> {
    const options = parseImportConfigArguments(args);
    const app = this.appRegistry.get(options.localId);
    if (!app || (app.source !== 'mcp-import' && app.source !== 'skill-import')) {
      throw new AaiError('UNKNOWN_APP', `Imported app not found: ${options.localId}`);
    }

    let descriptor = app.descriptor;
    let inferredExposureMode = options.exposureMode;

    if (options.exposureMode && isMcpAccess(app.descriptor.access) && app.source === 'mcp-import') {
      const entry = await this.resolveImportedMcpEntry(options.localId);
      if (!entry) {
        throw new AaiError('UNKNOWN_APP', `Imported MCP app not found: ${options.localId}`);
      }

      const refreshed = await refreshImportedMcpServer(
        getMcpExecutor(),
        this.secureStorage,
        entry,
        options.exposureMode
      );
      descriptor = refreshed.descriptor;
    } else if (options.exposureMode && isSkillAccess(app.descriptor.access) && app.source === 'skill-import') {
      if (!isSkillPathConfig(app.descriptor.access.config)) {
        throw new AaiError('INVALID_REQUEST', 'Imported skill is missing a local skill path');
      }

      const skillContent = await readFile(join(app.descriptor.access.config.path, 'SKILL.md'), 'utf-8');
      descriptor = {
        ...app.descriptor,
        exposure: buildSkillExposure(
          app.descriptor.app.name.default,
          skillContent,
          options.exposureMode
        ),
      };
    }

    const nextDescriptor: AaiJson = {
      ...descriptor,
      exposure: {
        keywords: options.keywords ?? descriptor.exposure.keywords,
        summary: options.summary ?? descriptor.exposure.summary,
      },
    };

    if (isMcpAccess(app.descriptor.access) && app.source === 'mcp-import') {
      await upsertMcpRegistryEntry(
        {
          localId: options.localId,
          protocol: 'mcp',
          config: app.descriptor.access.config,
        },
        nextDescriptor
      );
    } else if (isSkillAccess(app.descriptor.access) && app.source === 'skill-import') {
      await upsertSkillRegistryEntry(
        {
          localId: options.localId,
          protocol: 'skill',
          config: app.descriptor.access.config,
        },
        nextDescriptor
      );
    }

    this.appRegistry.set(options.localId, {
      ...app,
      descriptor: nextDescriptor,
    });

    if (!inferredExposureMode) {
      inferredExposureMode = inferExposureMode(nextDescriptor.exposure);
    }

    return {
      content: [
        {
          type: 'text',
          text: [
            `Updated imported app: ${options.localId}`,
            `Exposure mode: ${inferredExposureMode}`,
            `Keywords: ${nextDescriptor.exposure.keywords.join(', ')}`,
            `Summary: ${nextDescriptor.exposure.summary}`,
            ...describeExposureBehavior(inferredExposureMode, nextDescriptor.exposure),
            '请重启后，才能使用更新后的工具配置。',
          ].join('\n'),
        },
      ],
    };
  }

  private async loadGuideDetail(localId: string, descriptor: AaiJson): Promise<DetailedCapability> {
    try {
      return await this.loadLayer3Detail(localId, descriptor);
    } catch (err) {
      logger.warn({ localId, err }, 'Failed to load live app detail; using static fallback');
      return createStaticDetail(descriptor, err);
    }
  }

  private async handleExec(
    request: CallToolRequest,
    requestId: string | number,
    appIdOrUrl: string,
    toolName: string,
    args: Record<string, unknown>,
    taskFromPayload?: Record<string, unknown>,
    progressTokenFromPayload?: string | number
  ): Promise<CallToolResult | CreateTaskResult> {
    const resolved = await this.resolveApp(appIdOrUrl);
    const locale = getSystemLocale();
    const appName = getLocalizedName(resolved.descriptor.app.name, locale);
    const startedAt = Date.now();

    // Merge task/progressToken from both protocol-level params and args-level.
    // Args-level takes precedence so the AI can pass them via the tool interface.
    const taskFromArgs =
      typeof args.task === 'object' && args.task !== null ? args.task : undefined;
    const task = taskFromPayload ?? request.params.task ?? taskFromArgs;
    const isTask = Boolean(task);
    const progressToken =
      progressTokenFromPayload ??
      ((typeof args.progressToken === 'string' || typeof args.progressToken === 'number')
        ? args.progressToken
        : undefined) ??
      request.params._meta?.progressToken;

    logger.info(
      {
        requestId,
        app: resolved.localId,
        protocol: resolved.descriptor.access.protocol,
        tool: toolName,
        task: isTask,
        progressToken: progressToken !== undefined,
        args: summarizeExecArgs(args),
      },
      'aai:exec received'
    );

    const isAcpPrompt =
      resolved.descriptor.access.protocol === 'acp-agent' &&
      (toolName === 'prompt' || toolName === 'session/prompt');

    if (!isTask && isAcpPrompt) {
      logger.warn(
        {
          requestId,
          app: resolved.localId,
          tool: toolName,
        },
        'Synchronous ACP prompt may be timed out by the MCP client; prefer task-augmented aai:exec'
      );
    }

    await this.consentManager.checkAndPrompt(
      resolved.localId,
      appName,
      {
        name: toolName,
        description: `${resolved.descriptor.access.protocol} operation`,
        parameters: args,
      },
      this.callerIdentity ?? { name: 'Unknown Client' }
    );

    if (!isTask) {
      // For long-running ACP prompts, start a keepalive heartbeat that sends
      // periodic progress notifications so MCP clients can reset their request
      // timeout. Also sends server-level log notifications for clients that
      // use transport-level keepalives.
      const keepalive = isAcpPrompt ? this.startKeepalive(progressToken) : undefined;

      try {
        const upstreamObserver = this.createUpstreamObserver(progressToken);
        const result = await this.executeAppWithInactivityTimeout(
          resolved.localId,
          resolved.descriptor,
          toolName,
          args,
          upstreamObserver
        );
        logger.info(
          {
            requestId,
            app: resolved.localId,
            protocol: resolved.descriptor.access.protocol,
            tool: toolName,
            task: false,
            durationMs: Date.now() - startedAt,
          },
          'aai:exec completed'
        );
        return this.toCallToolResult(result);
      } catch (err) {
        logger.error(
          {
            requestId,
            app: resolved.localId,
            protocol: resolved.descriptor.access.protocol,
            tool: toolName,
            task: false,
            durationMs: Date.now() - startedAt,
            err,
          },
          'aai:exec failed'
        );
        throw err;
      } finally {
        keepalive?.stop();
      }
    }

    const taskRequest = task && !request.params.task
      ? {
          ...request,
          params: {
            ...request.params,
            task,
          },
        }
      : request;

    const taskResult = await this.taskRunner.createTask(requestId, taskRequest);
    const taskId = taskResult.task.taskId;
    const immediateTaskResponse = this.createImmediateTaskResponse(
      resolved.localId,
      resolved.descriptor.access.protocol,
      toolName,
      taskId
    );
    const taskResultWithImmediateResponse: CreateTaskResult = {
      ...taskResult,
      _meta: {
        ...(taskResult._meta ?? {}),
        'io.modelcontextprotocol/model-immediate-response': immediateTaskResponse,
      },
    };

    logger.info(
      {
        requestId,
        taskId,
        app: resolved.localId,
        protocol: resolved.descriptor.access.protocol,
        tool: toolName,
        task: true,
      },
      'aai:exec task created'
    );

    this.taskRunner.runTask(taskId, async () => {
      try {
        const result = await this.executeAppWithInactivityTimeout(
          resolved.localId,
          resolved.descriptor,
          toolName,
          args,
          this.taskRunner.createObserver(taskId, progressToken)
        );
        logger.info(
          {
            requestId,
            taskId,
            app: resolved.localId,
            protocol: resolved.descriptor.access.protocol,
            tool: toolName,
            task: true,
            durationMs: Date.now() - startedAt,
          },
          'aai:exec completed'
        );
        return this.toCallToolResult(result);
      } catch (err) {
        logger.error(
          {
            requestId,
            taskId,
            app: resolved.localId,
            protocol: resolved.descriptor.access.protocol,
            tool: toolName,
            task: true,
            durationMs: Date.now() - startedAt,
            err,
          },
          'aai:exec failed'
        );
        throw err;
      }
    });

    return taskResultWithImmediateResponse;
  }

  private async resolveApp(appIdOrUrl: string): Promise<RuntimeAppRecord> {
    const existing = this.appRegistry.get(appIdOrUrl);
    if (existing) return existing;

    const normalizedUrl = normalizeUrl(appIdOrUrl);
    const descriptor = await fetchWebDescriptor(normalizedUrl);
    return {
      localId: deriveLocalId(`web:${new URL(normalizedUrl).hostname}`, 'web'),
      descriptor,
      source: 'web',
      location: normalizedUrl,
    };
  }

  private async loadLayer3Detail(
    localId: string,
    descriptor: AaiJson
  ): Promise<DetailedCapability> {
    const access = descriptor.access;

    if (isMcpAccess(access)) {
      const headers = await loadImportedMcpHeaders(this.secureStorage, localId);
      const tools = await getMcpExecutor().listTools({
        localId,
        config: access.config,
        headers,
      });
      return {
        title: 'MCP Tools',
        body:
          tools.length === 0
            ? 'No MCP tools reported.'
            : tools.map((tool) => `- ${tool.name}: ${tool.description ?? ''}`.trimEnd()).join('\n'),
      };
    }

    if (isSkillAccess(access)) {
      return loadSkillDetail(access.config as any);
    }

    if (isAcpAgentAccess(access)) {
      return getAcpExecutor().inspect(localId, access.config);
    }

    return loadCliDetail(access.config);
  }

  private async executeApp(
    localId: string,
    descriptor: AaiJson,
    toolName: string,
    args: Record<string, unknown>,
    observer?: import('../executors/events.js').ExecutionObserver
  ): Promise<unknown> {
    const access = descriptor.access;

    if (isMcpAccess(access)) {
      const headers = await loadImportedMcpHeaders(this.secureStorage, localId);
      return getMcpExecutor().callTool(
        {
          localId,
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
      const executor = getAcpExecutor();
      if (observer && executor.executeWithObserver) {
        return executor.executeWithObserver(localId, access.config, toolName, args, observer);
      }
      return executor.execute(localId, access.config, toolName, args);
    }

    if (isCliAccess(access)) {
      return executeCli(access.config, toolName, args);
    }

    throw new AaiError('NOT_IMPLEMENTED', `Unsupported protocol ${JSON.stringify(access)}`);
  }

  private async executeAppWithInactivityTimeout(
    localId: string,
    descriptor: AaiJson,
    toolName: string,
    args: Record<string, unknown>,
    observer?: ExecutionObserver
  ): Promise<unknown> {
    const timeoutMs = isAcpAgentAccess(descriptor.access)
      ? ACP_DOWNSTREAM_INACTIVITY_TIMEOUT_MS
      : DOWNSTREAM_INACTIVITY_TIMEOUT_MS;

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
            `Downstream '${localId}' timed out after ${timeoutMs}ms without any activity`
          );
          void this.cleanupTimedOutExecution(localId, descriptor).finally(() => {
            finish(() => reject(error));
          });
        }, timeoutMs);
      };

      const activityObserver = this.wrapExecutionObserver(observer, scheduleTimeout);
      scheduleTimeout();

      this.executeApp(localId, descriptor, toolName, args, activityObserver).then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error))
      );
    });
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

  private async cleanupTimedOutExecution(localId: string, descriptor: AaiJson): Promise<void> {
    const access = descriptor.access;

    try {
      if (isMcpAccess(access)) {
        await getMcpExecutor().close(localId);
        return;
      }

      if (isAcpAgentAccess(access)) {
        await getAcpExecutor().disconnect(localId);
      }
    } catch (err) {
      logger.warn({ localId, err }, 'Failed to clean up timed out downstream execution');
    }
  }

  private createImmediateTaskResponse(
    localId: string,
    protocol: string,
    toolName: string,
    taskId: string
  ): string {
    return `Started background task ${taskId} for ${localId} (${protocol}:${toolName}). Poll tasks/get or tasks/result for the final output.`;
  }

  /**
   * Starts a periodic keepalive that sends progress notifications (if a
   * progressToken is available) and a lightweight log-level notification
   * every ACP_KEEPALIVE_INTERVAL_MS.  This prevents MCP clients from timing
   * out during long-running ACP prompt execution.
   */
  private startKeepalive(progressToken?: string | number): { stop: () => void } {
    let progress = 0;
    const timer = setInterval(() => {
      progress += 1;

      if (progressToken !== undefined) {
        void this.server.notification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress,
            message: 'ACP agent is working…',
          },
        });
      }

      // Also send a log notification so that the transport stays active
      // even for clients that don't handle progress-based timeout reset.
      void this.server.notification({
        method: 'notifications/message',
        params: {
          level: 'debug',
          logger: 'aai-gateway',
          data: 'ACP agent keepalive',
        },
      });
    }, ACP_KEEPALIVE_INTERVAL_MS);

    return {
      stop: () => clearInterval(timer),
    };
  }

  private createUpstreamObserver(progressToken?: string | number): ExecutionObserver {
    let progress = 0;

    return {
      onMessage: async ({ message }) => {
        await this.server.notification({
          method: 'notifications/message',
          params: {
            level: 'info',
            logger: 'aai-gateway',
            data: message,
          },
        });

        if (progressToken === undefined) {
          return;
        }

        progress += 1;
        await this.server.notification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress,
            message,
          },
        });
      },
      onProgress: async ({ progress: nextProgress, message }) => {
        if (progressToken === undefined) {
          return;
        }

        progress = nextProgress ?? progress + 1;
        await this.server.notification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress,
            ...(message ? { message } : {}),
          },
        });
      },
      onTaskStatus: async ({ status, message }) => {
        if (progressToken === undefined) {
          return;
        }

        progress += 1;
        await this.server.notification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress,
            message: message ?? status,
          },
        });
      },
    };
  }

  private toCallToolResult(result: unknown): CallToolResult {
    const promptText = extractPrimaryOutputText(result);
    if (promptText) {
      const metadata = stripPrimaryOutputText(result);
      const content = [{ type: 'text' as const, text: promptText }];
      if (metadata !== undefined) {
        content.push({
          type: 'text' as const,
          text: JSON.stringify(metadata, null, 2),
        });
      }
      return { content };
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

function extractPrimaryOutputText(result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const record = result as Record<string, unknown>;
  if (typeof record.outputText === 'string' && record.outputText.length > 0) {
    return record.outputText;
  }

  if (
    record.success === true &&
    record.data &&
    typeof record.data === 'object' &&
    typeof (record.data as Record<string, unknown>).outputText === 'string'
  ) {
    const outputText = (record.data as Record<string, unknown>).outputText as string;
    return outputText.length > 0 ? outputText : null;
  }

  return null;
}

function stripPrimaryOutputText(result: unknown): unknown {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  if (typeof record.outputText === 'string') {
    const { outputText: _outputText, ...rest } = record;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }

  if (record.success === true && record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>;
    if (typeof data.outputText === 'string') {
      const { outputText: _outputText, ...restData } = data;
      const next = {
        ...record,
        data: Object.keys(restData).length > 0 ? restData : undefined,
      };
      if (next.data === undefined) {
        delete (next as Record<string, unknown>).data;
      }
      return next;
    }
  }

  return undefined;
}

function summarizeExecArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    keys: Object.keys(args),
  };

  if (typeof args.sessionId === 'string') {
    summary.sessionId = args.sessionId;
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
  config: McpConfig;
  headers?: Record<string, string>;
  exposureMode: ExposureMode;
} {
  try {
    return {
      config: buildMcpImportConfig({
        transport:
          args?.transport === 'streamable-http' || args?.transport === 'sse'
            ? args.transport
            : undefined,
        url: asOptionalString(args?.url),
        command: asOptionalString(args?.command),
        args: asStringArray(args?.args),
        env: isStringRecord(args?.env) ? args.env : undefined,
        cwd: asOptionalString(args?.cwd),
      }),
      headers: isStringRecord(args?.headers) ? args.headers : undefined,
      exposureMode: parseExposureMode(args?.exposure),
    };
  } catch (err) {
    throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
  }
}

function parseSkillImportArguments(args: Record<string, unknown> | undefined): {
  path?: string;
  url?: string;
  exposureMode: ExposureMode;
} {
  try {
    const source = buildSkillImportSource({
      path: asOptionalString(args?.path),
      url: asOptionalString(args?.url),
    });

    return {
      path: source.path,
      url: source.url,
      exposureMode: parseExposureMode(args?.exposure),
    };
  } catch (err) {
    throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
  }
}

function parseImportConfigArguments(args: Record<string, unknown> | undefined): {
  localId: string;
  exposureMode?: ExposureMode;
  keywords?: string[];
  summary?: string;
} {
  const localId = normalizeImportedAppId(args?.localId, args?.app);
  if (!localId) {
    throw new AaiError('INVALID_REQUEST', "import:config requires 'localId' or 'app'");
  }

  const exposure = args?.exposure;
  const keywords = args?.keywords === undefined ? undefined : asNonEmptyStringArray(args.keywords);
  const summary = args?.summary === undefined ? undefined : asOptionalString(args.summary);

  if (args?.summary !== undefined && !summary) {
    throw new AaiError('INVALID_REQUEST', "import:config received an empty 'summary'");
  }

  return {
    localId,
    exposureMode: exposure === undefined ? undefined : parseExposureMode(exposure),
    keywords,
    summary,
  };
}

function normalizeImportedAppId(localIdValue: unknown, appValue: unknown): string | undefined {
  const localId = asOptionalString(localIdValue);
  if (localId) {
    return localId;
  }

  const app = asOptionalString(appValue);
  if (!app) {
    return undefined;
  }

  return app.startsWith('app:') ? app.slice(4) : app;
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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
    throw new AaiError('INVALID_REQUEST', "import:config received an empty 'keywords' array");
  }

  return Array.from(new Set(items)).slice(0, 8);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === 'string');
}

export async function createGatewayServer(options?: DiscoveryOptions): Promise<AaiGatewayServer> {
  return new AaiGatewayServer(options);
}

function inferExposureMode(exposure: AaiJson['exposure']): ExposureMode {
  return exposure.summary.startsWith('Use for ') ? 'keywords' : 'summary';
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

function createStaticDetail(descriptor: AaiJson, err: unknown): DetailedCapability {
  switch (descriptor.access.protocol) {
    case 'acp-agent':
      return {
        title: 'ACP Agent Details',
        body: [
          'Live ACP inspection is currently unavailable.',
          `App summary: ${descriptor.exposure.summary}`,
          'Use `aai:exec` with:',
          '- `tool: "prompt"` for a simplified prompt flow',
          '- or `tool: "session/new"` then `tool: "session/prompt"` for explicit session control',
          `Inspection error: ${err instanceof Error ? err.message : String(err)}`,
        ].join('\n'),
      };
    case 'mcp':
      return {
        title: 'MCP Tools',
        body: [
          'Live MCP tool discovery is currently unavailable.',
          `App summary: ${descriptor.exposure.summary}`,
          `Inspection error: ${err instanceof Error ? err.message : String(err)}`,
        ].join('\n'),
      };
    case 'skill':
      return {
        title: 'Skill Details',
        body: descriptor.exposure.summary,
      };
    case 'cli':
      return {
        title: 'CLI Details',
        body: [
          'Live CLI inspection is currently unavailable.',
          `App summary: ${descriptor.exposure.summary}`,
          `Inspection error: ${err instanceof Error ? err.message : String(err)}`,
        ].join('\n'),
      };
  }
}
