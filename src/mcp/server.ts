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
import { getSkillRegistryEntry, upsertSkillRegistryEntry } from '../storage/skill-registry.js';
import type {
  AaiJson,
  DetailedCapability,
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
import { deriveLocalId } from '../utils/ids.js';
import { getSystemLocale } from '../utils/locale.js';
import { logger } from '../utils/logger.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';

import {
  generateAppListDescription,
  generateOperationGuide,
} from '../guides/app-guide-generator.js';
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
  buildImportSearchResponse,
  IMPORT_SEARCH_TOOL_ALIASES,
  IMPORT_SEARCH_TOOL_NAME,
  importSearchInputSchema,
  parseImportSearchArguments,
} from './search-guidance.js';
import { McpTaskRunner } from './task-runner.js';
import type { ExecutionObserver } from '../executors/events.js';

const MCP_DOWNSTREAM_INACTIVITY_TIMEOUT_MS = 60_000;
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
      { name: AAI_GATEWAY_NAME, version: AAI_GATEWAY_VERSION },
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
          'Execute an operation for a discovered app. Before calling this tool, always call app:<id> first and read its guide. Do not guess tool names or arguments. Parameters: app, tool, args.',
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
          'Import an MCP server into AAI Gateway managed apps. This tool works in two steps. First call it with only the MCP source config to inspect the server and return tool names plus descriptions. Then ask the user to confirm keywords, summary, and exposure, and call the same tool again with the same source config plus those three fields. Only the second call creates the import record.',
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
        } as Record<string, unknown>,
      });

      tools.push({
        name: 'skill:import',
        description:
          'Import a local or remote skill into AAI Gateway managed apps. This tool also works in two steps. First call it with only the skill source so the gateway can read SKILL.md and return the name and opening description. Then ask the user to confirm keywords, summary, and exposure, and call the same tool again with the same source plus those fields. Only the second call creates the import record.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: `Use this for a local skill import. Point to a directory containing SKILL.md and any companion files. Maximum length: ${IMPORT_LIMITS.pathLength} characters.`,
            },
            url: {
              type: 'string',
              description: `Use this for a remote skill import. The gateway will fetch <url>/SKILL.md and store it as a managed skill. Maximum length: ${IMPORT_LIMITS.urlLength} characters.`,
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
            {
              url: 'https://example.com/skill',
              exposure: 'keywords',
              keywords: ['random', 'dice', 'roll'],
              summary: 'Use this skill when the user asks for a dice roll or random die result.',
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
            appId: {
              type: 'string',
              description:
                'Optional if app is provided. The imported app id, for example "playwright".',
            },
            localId: {
              type: 'string',
              description: 'Deprecated alias for appId. Optional if app or appId is provided.',
            },
            app: {
              type: 'string',
              description:
                'Optional if appId is provided. Accepts either "app:<id>" or the plain imported app id.',
            },
            exposure: {
              type: 'string',
              enum: ['summary', 'keywords'],
              description: 'Optional. Update the recorded exposure choice to summary or keywords.',
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: `Optional. Replace the current keywords with these exact values. Up to ${EXPOSURE_LIMITS.keywordCount} keywords, each at most ${EXPOSURE_LIMITS.keywordLength} characters.`,
            },
            summary: {
              type: 'string',
              description: `Optional. Replace the current summary with this exact summary. Maximum length: ${EXPOSURE_LIMITS.summaryLength} characters.`,
            },
          },
        } as Record<string, unknown>,
      });

      tools.push({
        name: IMPORT_SEARCH_TOOL_NAME,
        description:
          'Plan discovery for MCP servers and skills, normalize agent-gathered search results into a shortlist, and generate install handoff guidance that routes to existing import tools.',
        inputSchema: importSearchInputSchema,
      });

      for (const alias of IMPORT_SEARCH_TOOL_ALIASES) {
        tools.push({
          name: alias,
          description: `Alias for \`${IMPORT_SEARCH_TOOL_NAME}\`. Use it to get discovery guidance, shortlist candidates, and hand off confirmed items to existing import tools.`,
          inputSchema: importSearchInputSchema,
        });
      }

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

      if (name === 'import:config') {
        return this.handleImportConfig(args as Record<string, unknown> | undefined);
      }

      if (name === IMPORT_SEARCH_TOOL_NAME || IMPORT_SEARCH_TOOL_ALIASES.includes(name as any)) {
        return this.handleImportSearch(args as Record<string, unknown> | undefined);
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

    if (!options.metadata) {
      const preview = await discoverMcpImport(getMcpExecutor(), {
        name: options.name,
        config: options.config,
        headers: options.headers,
      });

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

    this.appRegistry.set(result.entry.localId, {
      localId: result.entry.localId,
      descriptor: result.descriptor,
      source: 'mcp-import',
      location: result.entry.descriptorPath,
    });

    const detail: DetailedCapability = {
      title: 'MCP Tools',
      body: JSON.stringify(result.tools, null, 2),
    };

    return {
      content: [
        {
          type: 'text',
          text: [
            `Imported MCP app: ${result.descriptor.app.name.default}`,
            `App ID: ${result.entry.localId}`,
            `App tool name after restart: app:${result.entry.localId}`,
            `Descriptor: ${result.entry.descriptorPath}`,
            `Exposure mode: ${options.metadata.exposureMode}`,
            `Keywords: ${result.descriptor.exposure.keywords.join(', ')}`,
            `Summary: ${result.descriptor.exposure.summary}`,
            ...describeExposureBehavior(options.metadata.exposureMode, result.descriptor.exposure),
            '请重启后，才能使用新导入的工具。',
            'If you want to change the exposure mode, summary, or keywords later, call `import:config` with this app id.',
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
    if (
      !app ||
      app.source !== 'mcp-import' ||
      !isMcpAccess(app.descriptor.access) ||
      !app.location
    ) {
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

    if (!options.metadata) {
      const preview = await discoverSkillImport({
        path: options.path,
        url: options.url,
      });

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
            `Imported skill: ${result.descriptor.app.name.default}`,
            `App ID: ${result.localId}`,
            `App tool name after restart: app:${result.localId}`,
            `Skill directory: ${result.managedPath}`,
            `Exposure mode: ${options.metadata.exposureMode}`,
            `Keywords: ${result.descriptor.exposure.keywords.join(', ')}`,
            `Summary: ${result.descriptor.exposure.summary}`,
            ...describeExposureBehavior(options.metadata.exposureMode, result.descriptor.exposure),
            '请重启后，才能使用新导入的工具。',
            'If you want to change the exposure mode, summary, or keywords later, call `import:config` with this app id.',
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

    const nextDescriptor: AaiJson = {
      ...app.descriptor,
      exposure: normalizeExposureInput({
        keywords: options.keywords ?? app.descriptor.exposure.keywords,
        summary: options.summary ?? app.descriptor.exposure.summary,
      }),
    };

    if (isMcpAccess(app.descriptor.access) && app.source === 'mcp-import') {
      const entry = await this.resolveImportedMcpEntry(options.localId);
      if (!entry) {
        throw new AaiError('UNKNOWN_APP', `Imported MCP app not found: ${options.localId}`);
      }

      await upsertMcpRegistryEntry(
        {
          localId: options.localId,
          protocol: 'mcp',
          config: app.descriptor.access.config,
          exposureMode: options.exposureMode ?? entry.exposureMode,
        },
        nextDescriptor
      );
    } else if (isSkillAccess(app.descriptor.access) && app.source === 'skill-import') {
      const entry = await getSkillRegistryEntry(options.localId);
      await upsertSkillRegistryEntry(
        {
          localId: options.localId,
          protocol: 'skill',
          config: app.descriptor.access.config,
          exposureMode: options.exposureMode ?? entry?.exposureMode,
        },
        nextDescriptor
      );
    }

    this.appRegistry.set(options.localId, {
      ...app,
      descriptor: nextDescriptor,
    });

    const inferredExposureMode = options.exposureMode ?? inferExposureMode(nextDescriptor.exposure);

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

  private async handleImportSearch(
    args: Record<string, unknown> | undefined
  ): Promise<CallToolResult> {
    try {
      const options = parseImportSearchArguments(args);
      return {
        content: [
          {
            type: 'text',
            text: buildImportSearchResponse(options),
          },
        ],
      };
    } catch (err) {
      throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
    }
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
      (typeof args.progressToken === 'string' || typeof args.progressToken === 'number'
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
      }
    }

    const taskRequest =
      task && !request.params.task
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
        body: JSON.stringify(tools, null, 2),
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

  if (typeof args.turnId === 'string') {
    summary.turnId = args.turnId;
  }

  if (typeof args.cursor === 'number') {
    summary.cursor = args.cursor;
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
        args: asStringArray(args?.args),
        env: isStringRecord(args?.env) ? args.env : undefined,
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
  if (!isStringRecord(value)) {
    return undefined;
  }

  validateImportHeaders(value);
  return value;
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

function parseImportConfigArguments(args: Record<string, unknown> | undefined): {
  localId: string;
  exposureMode?: ExposureMode;
  keywords?: string[];
  summary?: string;
} {
  const localId = normalizeImportedAppId(args?.appId, args?.localId, args?.app);
  if (!localId) {
    throw new AaiError('INVALID_REQUEST', "import:config requires 'appId' or 'app'");
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

function normalizeImportedAppId(
  appIdValue: unknown,
  localIdValue: unknown,
  appValue: unknown
): string | undefined {
  const appId = asOptionalString(appIdValue);
  if (appId) {
    return appId;
  }

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

function asOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer in milliseconds`);
  }

  return value;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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
  return exposure.summary.length <= 80 ? 'keywords' : 'summary';
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

function formatToolPreview(tools: Array<{ name: string; description?: string }>): string {
  if (tools.length === 0) {
    return 'No MCP tools reported.';
  }

  return tools.map((tool) => `- ${tool.name}: ${tool.description ?? ''}`.trimEnd()).join('\n');
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
          '- `tool: "prompt"` to start a turn and wait up to 30 seconds for the first increment',
          '- `tool: "session/new"` then `tool: "session/prompt"` for explicit session control',
          '- `tool: "turn/poll"` with `args.turnId` and the returned `cursor` to fetch the next increment until `done: true`',
          '- `tool: "turn/cancel"` with `args.turnId` to cancel a queued or running turn',
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
