import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/index.js';
import {
  CallToolRequestSchema,
  CancelTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
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
import { legacyExecuteCli as executeCli, legacyLoadCliDetail as loadCliDetail } from '../executors/cli.js';
import { getMcpExecutor } from '../executors/mcp.js';
import { legacyExecuteSkill as executeSkill, legacyLoadSkillDetail as loadSkillDetail } from '../executors/skill.js';
import { createSecureStorage, type SecureStorage } from '../storage/secure-storage/index.js';
import type { AaiJson, DetailedCapability, RuntimeAppRecord } from '../types/aai-json.js';
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

import { generateAppListDescription, generateOperationGuide } from './guide-generator.js';
import { loadImportedMcpHeaders } from './importer.js';
import { McpTaskRunner } from './task-runner.js';

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
      }> =
        Array.from(this.appRegistry.values()).map((app) => ({
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
          'Execute an operation for a discovered app. Parameters: app, tool, args.',
        inputSchema: {
          type: 'object',
          properties: {
            app: { type: 'string' },
            tool: { type: 'string' },
            args: { type: 'object', additionalProperties: true },
          },
          required: ['app', 'tool'],
        } as Record<string, unknown>,
        execution: { taskSupport: 'optional' },
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
        const payload = args as { app: string; tool: string; args?: Record<string, unknown> };
        return this.handleExec(
          request as CallToolRequest,
          extra.requestId,
          payload.app,
          payload.tool,
          payload.args ?? {}
        );
      }

      throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
    });

    this.server.setRequestHandler(GetTaskRequestSchema, async (request) => {
      return this.taskRunner.getTask(request.params.taskId);
    });

    this.server.setRequestHandler(GetTaskPayloadRequestSchema, async (request) => {
      return this.taskRunner.getTaskResult(request.params.taskId);
    });

    this.server.setRequestHandler(ListTasksRequestSchema, async (request) => {
      return this.taskRunner.listTasks(request.params?.cursor);
    });

    this.server.setRequestHandler(CancelTaskRequestSchema, async (request) => {
      return this.taskRunner.cancelTask(request.params.taskId);
    });
  }

  private async handleAppGuide(appId: string): Promise<{ content: Array<{ type: string; text: string }> }> {
    const app = this.appRegistry.get(appId);
    if (!app) {
      throw new AaiError('UNKNOWN_APP', `App not found: ${appId}`);
    }

    const detail = await this.loadGuideDetail(app.localId, app.descriptor);
    return {
      content: [{ type: 'text', text: generateOperationGuide(app.localId, app.descriptor, detail) }],
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
    args: Record<string, unknown>
  ): Promise<CallToolResult | CreateTaskResult> {
    const resolved = await this.resolveApp(appIdOrUrl);
    const locale = getSystemLocale();
    const appName = getLocalizedName(resolved.descriptor.app.name, locale);

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

    if (!request.params.task) {
      const result = await this.executeApp(resolved.localId, resolved.descriptor, toolName, args);
      return this.toCallToolResult(result);
    }

    const taskResult = await this.taskRunner.createTask(requestId, request);
    const taskId = taskResult.task.taskId;
    const progressToken = request.params._meta?.progressToken;

    this.taskRunner.runTask(taskId, async () => {
      const result = await this.executeApp(
        resolved.localId,
        resolved.descriptor,
        toolName,
        args,
        this.taskRunner.createObserver(taskId, progressToken)
      );
      return this.toCallToolResult(result);
    });

    return taskResult;
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

  private async loadLayer3Detail(localId: string, descriptor: AaiJson): Promise<DetailedCapability> {
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
            : tools
                .map((tool) => `- ${tool.name}: ${tool.description ?? ''}`.trimEnd())
                .join('\n'),
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
        args
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

  private toCallToolResult(result: unknown): CallToolResult {
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

export async function createGatewayServer(options?: DiscoveryOptions): Promise<AaiGatewayServer> {
  return new AaiGatewayServer(options);
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
