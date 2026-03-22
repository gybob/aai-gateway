import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/index.js';
import {
  CallToolRequestSchema,
  CancelTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
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

import {
  generateAppListDescription,
  generateOperationGuide,
} from '../guides/app-guide-generator.js';
import { loadImportedMcpHeaders } from './importer.js';
import { McpTaskRunner } from './task-runner.js';
import type { ExecutionObserver } from '../executors/events.js';

/**
 * How often the keepalive heartbeat fires for long-running ACP prompts (ms).
 * Must be well below the default MCP client request timeout (60 s).
 */
const ACP_KEEPALIVE_INTERVAL_MS = 15_000;
export const DEFAULT_GATEWAY_HOST = '127.0.0.1';
export const DEFAULT_GATEWAY_PORT = 8765;
export const DEFAULT_GATEWAY_PATH = '/mcp';

export interface GatewayServerOptions extends DiscoveryOptions {
  host?: string;
  port?: number;
  path?: string;
}

interface SharedGatewayState {
  appRegistry: Map<string, RuntimeAppRecord>;
  consentManager: ConsentManager;
  secureStorage: SecureStorage;
  discoveryManager?: import('../discovery/manager.js').DiscoveryManager;
}

interface GatewaySessionContext {
  clientContextId: string;
  sharedState?: SharedGatewayState;
}

interface GatewaySessionState {
  gateway: AaiGatewayServer;
  transport: StreamableHTTPServerTransport;
  clientContextId: string;
}

export class AaiGatewayServer {
  private readonly server: Server;
  private readonly options: DiscoveryOptions;
  private readonly taskRunner: McpTaskRunner;
  private readonly appRegistry: Map<string, RuntimeAppRecord>;
  private readonly clientContextId: string;
  private consentManager!: ConsentManager;
  private secureStorage!: SecureStorage;
  private callerIdentity?: CallerIdentity;
  private discoveryManager?: import('../discovery/manager.js').DiscoveryManager;
  private readonly sharedState?: SharedGatewayState;
  private initialized = false;

  constructor(options?: DiscoveryOptions, context?: GatewaySessionContext) {
    this.options = options ?? {};
    this.clientContextId = context?.clientContextId ?? 'standalone';
    this.sharedState = context?.sharedState;
    this.appRegistry = context?.sharedState?.appRegistry ?? new Map<string, RuntimeAppRecord>();
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
    if (this.initialized) {
      return;
    }

    if (this.sharedState) {
      this.secureStorage = this.sharedState.secureStorage;
      this.consentManager = this.sharedState.consentManager;
      this.discoveryManager = this.sharedState.discoveryManager;
      this.initialized = true;
      return;
    }

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
    this.initialized = true;
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
        const observer =
          isAcpPrompt || progressToken !== undefined
            ? this.createProgressObserver(progressToken)
            : undefined;
        const result = await this.executeApp(
          resolved.localId,
          resolved.descriptor,
          toolName,
          args,
          observer
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
        const result = await this.executeApp(
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
      return getAcpExecutor().inspect(this.scopeLocalId(localId), access.config);
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
      const scopedLocalId = this.scopeLocalId(localId);
      if (observer && executor.executeWithObserver) {
        return executor.executeWithObserver(scopedLocalId, access.config, toolName, args, observer);
      }
      return executor.execute(scopedLocalId, access.config, toolName, args);
    }

    if (isCliAccess(access)) {
      return executeCli(access.config, toolName, args);
    }

    throw new AaiError('NOT_IMPLEMENTED', `Unsupported protocol ${JSON.stringify(access)}`);
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

  private createProgressObserver(progressToken?: string | number): ExecutionObserver {
    let progress = 0;

    return {
      onMessage: async ({ message }) => {
        progress += 1;
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
        progress = nextProgress ?? progress + 1;
        if (message) {
          await this.server.notification({
            method: 'notifications/message',
            params: {
              level: 'info',
              logger: 'aai-gateway',
              data: message,
            },
          });
        }

        if (progressToken === undefined) {
          return;
        }

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
        progress += 1;
        await this.server.notification({
          method: 'notifications/message',
          params: {
            level: status === 'failed' ? 'error' : 'info',
            logger: 'aai-gateway',
            data: message ?? status,
          },
        });

        if (progressToken === undefined) {
          return;
        }

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

  async connectTransport(transport: StreamableHTTPServerTransport): Promise<void> {
    await this.initialize();
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }

  private scopeLocalId(localId: string): string {
    return `${this.clientContextId}:${localId}`;
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

export class AaiGatewayHttpServer {
  private readonly discoveryOptions: DiscoveryOptions;
  private readonly host: string;
  private readonly path: string;
  private port: number;
  private readonly sessions = new Map<string, GatewaySessionState>();
  private sharedState?: SharedGatewayState;
  private httpServer?: HttpServer;

  constructor(options?: GatewayServerOptions) {
    const normalized = options ?? {};
    this.discoveryOptions = { devMode: normalized.devMode };
    this.host = normalized.host ?? DEFAULT_GATEWAY_HOST;
    this.port = normalized.port ?? DEFAULT_GATEWAY_PORT;
    this.path = normalizePath(normalized.path ?? DEFAULT_GATEWAY_PATH);
  }

  async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    this.sharedState = await createSharedGatewayState(this.discoveryOptions);
    this.httpServer = createHttpServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.httpServer?.off('error', onError);
        reject(error);
      };

      this.httpServer?.once('error', onError);
      this.httpServer?.listen(this.port, this.host, () => {
        this.httpServer?.off('error', onError);
        const address = this.httpServer?.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
        }
        resolve();
      });
    });

    logger.info(
      { host: this.host, port: this.port, path: this.path },
      'AAI Gateway started (streamable-http)'
    );
  }

  async stop(): Promise<void> {
    const activeSessions = Array.from(this.sessions.values());
    this.sessions.clear();

    await Promise.allSettled(activeSessions.map(async ({ gateway, transport }) => {
      await transport.close();
      await gateway.close();
    }));

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      this.httpServer = undefined;
    }
  }

  getUrl(): string {
    return `http://${this.host}:${this.port}${this.path}`;
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!matchesPath(req, this.path)) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const method = req.method ?? 'GET';
      const body = method === 'POST' ? await readRequestBody(req, res) : undefined;
      if (method === 'POST' && body === INVALID_JSON) {
        return;
      }

      const sessionId = getHeaderValue(req.headers['mcp-session-id']);
      const existing = sessionId ? this.sessions.get(sessionId) : undefined;

      if (existing) {
        await existing.transport.handleRequest(req, res, body);
        return;
      }

      if (method === 'POST' && isInitializeRequest(body)) {
        const created = await this.createSession();
        await created.transport.handleRequest(req, res, body);
        return;
      }

      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      }));
    } catch (error) {
      logger.error({ err: error }, 'Failed to handle streamable HTTP request');
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        }));
      }
    }
  }

  private async createSession(): Promise<GatewaySessionState> {
    if (!this.sharedState) {
      throw new Error('Gateway shared state was not initialized');
    }

    const clientContextId = randomUUID();
    const gateway = new AaiGatewayServer(this.discoveryOptions, {
      clientContextId,
      sharedState: this.sharedState,
    });
    await gateway.initialize();

    let transport!: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, { gateway, transport, clientContextId });
      },
    });

    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) {
        this.sessions.delete(sessionId);
      }
      void gateway.close();
    };

    await gateway.connectTransport(transport);
    return { gateway, transport, clientContextId };
  }
}

export async function createGatewayServer(options?: GatewayServerOptions): Promise<AaiGatewayHttpServer> {
  return new AaiGatewayHttpServer(options);
}

const INVALID_JSON = Symbol('invalid-json');

async function createSharedGatewayState(options: DiscoveryOptions): Promise<SharedGatewayState> {
  const secureStorage = createSecureStorage();
  const consentManager = new ConsentManager(secureStorage, createConsentDialog());
  const appRegistry = new Map<string, RuntimeAppRecord>();

  const { manager } = createDiscoveryManager();

  try {
    const discoveredApps = await manager.scanAll(options);
    for (const app of discoveredApps) {
      appRegistry.set(app.localId, app);
    }
    logger.info({ count: discoveredApps.length }, 'Discovery completed');
  } catch (err) {
    logger.error({ err }, 'Discovery failed');
  }

  return {
    appRegistry,
    consentManager,
    secureStorage,
    discoveryManager: manager,
  };
}

function normalizePath(value: string): string {
  if (!value.startsWith('/')) {
    return `/${value}`;
  }
  return value;
}

function matchesPath(req: IncomingMessage, expectedPath: string): boolean {
  if (!req.url) {
    return false;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);
  return url.pathname === expectedPath;
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

async function readRequestBody(
  req: IncomingMessage,
  res: ServerResponse
): Promise<unknown | typeof INVALID_JSON> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32700,
        message: 'Parse error',
      },
      id: null,
    }));
    return INVALID_JSON;
  }
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
