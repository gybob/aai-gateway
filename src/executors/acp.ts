import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { AaiError } from '../errors/errors.js';
import type {
  AcpAgentConfig,
  AcpExecutorConfig,
  DetailedCapability,
  ExecutionResult,
} from '../types/index.js';
import type { AppCapabilities } from '../types/capabilities.js';
import { logger } from '../utils/logger.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';
import { ACP_TOOL_SCHEMAS } from './acp-tool-schemas.js';
import { validateArgs, formatValidationErrors } from '../utils/schema-validator.js';

import type { ExecutionObserver, TaskCapableExecutor } from './events.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
  timeoutMs?: number;
  method: string;
  sessionId?: string;
}

type AcpContentBlock = Record<string, unknown> & { type: string };

type GatewayTurnState =
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface GatewayTurnError {
  code: string;
  message: string;
}

interface GatewayPermissionOption {
  id: string;
  label: string;
}

interface GatewayPermissionRequest {
  permissionId: string;
  title: string;
  description?: string;
  options: GatewayPermissionOption[];
}

interface PendingPermissionRequest extends GatewayPermissionRequest {
  appId: string;
  turnId: string;
  sessionId: string;
  downstreamRequestId: number | string;
}

interface PromptTurnState {
  appId: string;
  turnId: string;
  sessionId: string;
  promptMessageId: string;
  trackedMessageIds: Set<string>;
  startedAt?: number;
  outputText: string;
  content: AcpContentBlock[];
  pendingContent: AcpContentBlock[];
  done: boolean;
  state: GatewayTurnState;
  message?: string;
  error?: GatewayTurnError;
  stopReason?: string | null;
  permissionRequest?: GatewayPermissionRequest;
  waiters: Set<() => void>;
  cleanupTimer?: NodeJS.Timeout;
  inactivityTimer?: NodeJS.Timeout;
  drainTimer?: NodeJS.Timeout;
  lastTouchedAt: number;
  lastUpdateAt: number;
  params: Record<string, unknown>;
  awaitingDownstreamResponse?: boolean;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification | JsonRpcRequest;

interface ProcessState {
  proc: ChildProcess;
  buffer: string;
  initialized: boolean;
  initializeResult?: Record<string, unknown>;
}

const ACP_INITIALIZE_TIMEOUT_MS = 30000;
const ACP_SESSION_TIMEOUT_MS = 30000;
const ACP_POLL_WAIT_MS = 30000;
const ACP_TURN_INACTIVITY_TIMEOUT_MS = 10 * 60_000;
const ACP_TURN_TTL_MS = 15 * 60_000;
const ACP_MAX_OUTPUT_CHARS = 200_000;

function toToolSchemaReference(schema: { name: string; inputSchema: Record<string, unknown> }): Record<string, unknown> {
  return {
    name: schema.name,
    inputSchema: schema.inputSchema,
  };
}

/**
 * Validate arguments against ACP tool schema
 */
function validateAcpArgs(tool: string, args: Record<string, unknown>): void {
  const schema = ACP_TOOL_SCHEMAS.find((s) => s.name === tool);
  if (!schema) {
    return; // No schema defined for this tool
  }

  const result = validateArgs(args, schema.inputSchema);
  if (!result.valid) {
    const errorMessage = `参数校验失败 for '${tool}'\n${formatValidationErrors(result)}`;
    throw new AaiError(
      'INVALID_PARAMS',
      errorMessage,
      {
        schema: toToolSchemaReference(schema),
        validationErrors: result.errors,
      }
    );
  }
}

/**
 * ACP Executor implementation
 *
 * Implements unified Executor interface for ACP agents.
 */
export class AcpExecutor implements TaskCapableExecutor {
  readonly protocol = 'acp-agent';
  private states = new Map<string, ProcessState>();
  private pendingRequests = new Map<string, PendingRequest>();
  private promptTurns = new Map<string, PromptTurnState>();
  private pendingPermissionRequests = new Map<string, PendingPermissionRequest>();
  private activeTurnIdsBySession = new Map<string, string>();
  private trackedTurnIdsBySessionAndMessage = new Map<string, string>();
  private queuedTurnIdsBySession = new Map<string, string[]>();
  private sessionOwners = new Map<string, string>();
  private requestId = 0;

  constructor(private readonly pollWaitMs = ACP_POLL_WAIT_MS) {}

  async connect(appId: string, config: AcpAgentConfig & AcpExecutorConfig): Promise<void> {
    await this.ensureInitialized(appId, config);
  }

  async disconnect(appId: string): Promise<void> {
    this.stop(appId);
  }


  /**
   * Load app-level capabilities with full tool schemas
   * ACP tools are hardcoded
   */
  async loadAppCapabilities(
    _appId: string,
    _config: AcpAgentConfig & AcpExecutorConfig
  ): Promise<AppCapabilities> {
    const tools = ACP_TOOL_SCHEMAS.map((schema) => ({
      name: schema.name,
      description: schema.description ?? '',
      inputSchema: schema.inputSchema ?? { type: 'object' as const, properties: {} },
      outputSchema: schema.outputSchema,
    }));

    return { title: 'ACP Agent', tools };
  }

  async execute(
    appId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    return this.executeInternal(appId, config, operation, args);
  }

  async executeWithObserver(
    appId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    operation: string,
    args: Record<string, unknown>,
    _observer: ExecutionObserver
  ): Promise<ExecutionResult> {
    return this.executeInternal(appId, config, operation, args);
  }

  private async executeInternal(
    appId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    try {
      // Validate arguments against hardcoded ACP schema
      const schema = ACP_TOOL_SCHEMAS.find((s) => s.name === operation);
      if (schema) {
        const inputSchema = schema.inputSchema ?? { type: 'object', properties: {} };
        const result = validateArgs(args, inputSchema);
        if (!result.valid) {
          const errorMessage = `参数校验失败 for '${operation}'\n${formatValidationErrors(result)}`;
          return {
            success: false,
            error: errorMessage,
            schema: toToolSchemaReference({ name: schema.name, inputSchema }),
          };
        }
      }

      await this.ensureInitialized(appId, config);

      if (operation === 'prompt') {
        throw new AaiError(
          'INVALID_PARAMS',
          'ACP tool "prompt" has been removed. Call "session/new" first, then call "turn/start" with the returned sessionId.'
        );
      }

      if (operation === 'session/new') {
        return { success: true, data: await this.handleSessionNewRequest(appId, args) };
      }

      if (operation === 'session/prompt') {
        throw new AaiError(
          'INVALID_PARAMS',
          'ACP tool "session/prompt" is not exposed by AAI Gateway. Call "session/new" first, then call "turn/start" and poll with "turn/poll".'
        );
      }

      if (operation === 'turn/start') {
        return { success: true, data: await this.handleTurnStartRequest(appId, args) };
      }

      if (operation === 'turn/poll') {
        return { success: true, data: await this.handleTurnPollRequest(appId, args) };
      }

      if (operation === 'turn/respondPermission') {
        return { success: true, data: await this.handleTurnRespondPermissionRequest(appId, args) };
      }

      if (operation === 'turn/cancel') {
        return { success: true, data: await this.handleTurnCancelRequest(appId, args) };
      }

      const normalized = await this.normalizeOperation(appId, operation, args);
      const data = await this.sendRequest(
        appId,
        normalized.method,
        normalized.params,
        normalized.timeoutMs
      );
      return { success: true, data };
    } catch (err) {
      if (err instanceof AaiError) {
        return {
          success: false,
          error: err.message,
          ...(err.data ?? {}),
        };
      }

      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async health(appId: string): Promise<boolean> {
    const state = this.states.get(appId);
    return !!state?.initialized;
  }

  // Legacy methods for backward compatibility

  async inspect(
    appId: string,
    config: AcpAgentConfig & AcpExecutorConfig
  ): Promise<DetailedCapability> {
    const initialize = (await this.ensureInitialized(appId, config)) as Record<string, unknown>;
    return {
      title: 'ACP Agent Details',
      body: JSON.stringify(initialize, null, 2),
    };
  }

  async executeLegacy(
    appId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    await this.ensureInitialized(appId, config);
    return this.sendRequest(appId, method, params, 0);
  }

  stop(appId: string): void {
    const state = this.states.get(appId);
    if (!state) return;
    state.proc.kill();
    this.states.delete(appId);
    this.clearPromptTurnsForLocal(appId);
  }

  private async ensureInitialized(
    appId: string,
    config: AcpAgentConfig & AcpExecutorConfig
  ): Promise<unknown> {
    const state = this.states.get(appId);
    if (state?.initialized && state.initializeResult) {
      return state.initializeResult;
    }

    if (state) {
      state.proc.kill();
      this.states.delete(appId);
    }

    logger.info({ appId, command: config.command, args: config.args }, 'ACP initialize started');

    const proc = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
    });

    const nextState: ProcessState = {
      proc,
      buffer: '',
      initialized: false,
    };
    this.states.set(appId, nextState);

    proc.stdout?.on('data', (data: Buffer) => {
      this.handleMessage(appId, data.toString());
    });

    proc.stderr?.on('data', (data: Buffer) => {
      logger.debug({ appId, stderr: data.toString().trim() }, 'ACP agent stderr');
    });

    proc.on('exit', () => {
      this.states.delete(appId);
      this.clearPromptTurnsForLocal(appId);
    });

    const initializeResult = await this.sendRequest(
      appId,
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: AAI_GATEWAY_NAME,
          title: 'AAI Gateway',
          version: AAI_GATEWAY_VERSION,
        },
      },
      ACP_INITIALIZE_TIMEOUT_MS
    );

    nextState.initialized = true;
    nextState.initializeResult = initializeResult as Record<string, unknown>;
    logger.info({ appId }, 'ACP initialize completed');
    return initializeResult;
  }

  private async normalizeOperation(
    _appId: string,
    operation: string,
    args: Record<string, unknown>
  ): Promise<{ method: string; params: Record<string, unknown>; timeoutMs: number }> {
    return {
      method: operation,
      params: args,
      timeoutMs: 0,
    };
  }

  private async handleSessionNewRequest(
    appId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    validateAcpArgs('session/new', args);
    const normalizedArgs = normalizeSessionNewArgs(args);

    const created = (await this.sendRequest(
      appId,
      'session/new',
      normalizedArgs,
      ACP_SESSION_TIMEOUT_MS
    )) as { sessionId?: unknown };

    const sessionId =
      typeof created?.sessionId === 'string' && created.sessionId.length > 0
        ? created.sessionId
        : null;

    if (!sessionId) {
      throw new AaiError('INTERNAL_ERROR', 'ACP session/new did not return a sessionId');
    }

    this.sessionOwners.set(sessionId, appId);

    return {
      sessionId,
      promptCapabilities: extractPromptCapabilities(
        this.states.get(appId)?.initializeResult ?? null
      ),
    };
  }

  private async handleTurnStartRequest(
    appId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    validateAcpArgs('turn/start', args);
    assertPromptInput(args);
    const sessionId = requireSessionId(
      args,
      'ACP turn/start requires args.sessionId. Call session/new first, then pass the returned sessionId to turn/start.'
    );
    this.sessionOwners.set(sessionId, appId);
    return this.startPromptTurn(appId, sessionId, normalizePromptArgs(args, sessionId));
  }

  private async handleTurnPollRequest(
    appId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    validateAcpArgs('turn/poll', args);
    return this.waitForPromptTurn(appId, requireTurnId(args));
  }

  private async handleTurnRespondPermissionRequest(
    _appId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    validateAcpArgs('turn/respondPermission', args);
    const turn = this.getPromptTurn(requireTurnId(args));
    const permissionId = requirePermissionId(args);
    const pending = this.pendingPermissionRequests.get(permissionId);

    if (!pending || pending.turnId !== turn.turnId) {
      throw new AaiError(
        'INVALID_PARAMS',
        `No active ACP permission request found for permission '${permissionId}' on turn '${turn.turnId}'.`
      );
    }

    const decision = normalizePermissionDecision(args.decision, pending);
    await this.sendJsonRpcResult(pending.appId, pending.downstreamRequestId, {
      outcome: decision,
    });

    this.clearPendingPermissionRequest(turn, permissionId);
    if (!turn.done) {
      turn.state = 'running';
      turn.message = 'Permission response sent downstream.';
      turn.lastTouchedAt = Date.now();
      this.recordPromptTurnActivity(turn);
      this.notifyPromptTurnWaiters(turn);
    }

    return {
      turnId: turn.turnId,
      accepted: true,
    };
  }

  private async handleTurnCancelRequest(
    appId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const turnId = requireTurnId(args);
    const turn = this.getPromptTurn(turnId);
    const isActiveTurn = this.activeTurnIdsBySession.get(turn.sessionId) === turn.turnId;

    if (turn.done) {
      return this.buildTurnCancelResult(turn, false);
    }

    if (!isActiveTurn) {
      this.finishPromptTurn(turn, 'cancelled', undefined, 'cancelled');
      return this.buildTurnCancelResult(turn, true);
    }

    await this.cancelPendingPermissionRequest(turn);
    await this.sendNotification(appId, 'session/cancel', { sessionId: turn.sessionId });
    this.finishPromptTurn(turn, 'cancelled', undefined, 'cancelled');
    return this.buildTurnCancelResult(turn, true);
  }

  private async startPromptTurn(
    appId: string,
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const turnId = randomUUID();
    const promptMessageId = requireMessageId(params);
    const turn: PromptTurnState = {
      appId,
      turnId,
      sessionId,
      promptMessageId,
      trackedMessageIds: new Set([promptMessageId]),
      outputText: '',
      content: [],
      pendingContent: [],
      done: false,
      state: 'running',
      waiters: new Set(),
      lastTouchedAt: Date.now(),
      lastUpdateAt: Date.now(),
      params,
      message: 'Waiting to start.',
    };
    this.promptTurns.set(turnId, turn);
    this.bindMessageIdToTurn(sessionId, promptMessageId, turn);
    this.sessionOwners.set(sessionId, appId);

    const activeTurnId = this.activeTurnIdsBySession.get(sessionId);
    if (activeTurnId) {
      const queued = this.queuedTurnIdsBySession.get(sessionId) ?? [];
      queued.push(turnId);
      this.queuedTurnIdsBySession.set(sessionId, queued);
      turn.message = 'Waiting for an earlier turn on the same session to finish.';
    } else {
      this.launchPromptTurn(turn);
    }

    return {
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      state: turn.state,
    };
  }

  private launchPromptTurn(turn: PromptTurnState): void {
    turn.state = 'running';
    turn.message = 'Turn started.';
    turn.startedAt = Date.now();
    turn.lastTouchedAt = Date.now();
    this.recordPromptTurnActivity(turn);
    this.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);

    try {
      const request = this.sendRequest(turn.appId, 'session/prompt', turn.params, 0);
      void request.then(
        (result) => this.completePromptTurn(turn.turnId, result),
        (error) => this.failPromptTurn(turn.turnId, error)
      );
    } catch (error) {
      this.failPromptTurn(turn.turnId, error);
    }
  }

  private waitForPromptTurn(_appId: string, turnId: string): Promise<unknown> {
    const turn = this.getPromptTurn(turnId);
    if (turn.done) {
      return Promise.resolve(this.buildPromptTurnResult(turn));
    }

    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        turn.waiters.delete(wake);
        resolve(this.buildPromptTurnResult(this.getPromptTurn(turnId)));
      };

      const timer = setTimeout(() => {
        turn.waiters.delete(wake);
        resolve(this.buildPromptTurnResult(this.getPromptTurn(turnId)));
      }, this.pollWaitMs);

      turn.waiters.add(wake);
    });
  }

  private buildPromptTurnResult(turn: PromptTurnState): Record<string, unknown> {
    const content = this.takePendingTurnContent(turn);
    return {
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      done: turn.done,
      state: turn.state,
      ...(turn.message ? { message: turn.message } : {}),
      ...(turn.permissionRequest ? { permissionRequest: { ...turn.permissionRequest } } : {}),
      ...(turn.stopReason !== undefined ? { stopReason: turn.stopReason } : {}),
      ...(turn.error ? { error: { ...turn.error } } : {}),
      content,
    };
  }

  private buildTurnCancelResult(
    turn: PromptTurnState,
    cancelled: boolean
  ): Record<string, unknown> {
    return {
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      accepted: cancelled,
      done: turn.done,
      state: turn.state,
    };
  }

  private completePromptTurn(turnId: string, result: unknown): void {
    const turn = this.promptTurns.get(turnId);
    if (!turn) {
      return;
    }

    if (turn.done) {
      this.handleSettledPromptResponseAfterLocalFinish(turn);
      return;
    }

    const finalContent = extractResultContent(result);
    if (finalContent.length > 0) {
      this.appendPromptTurnContent(turn, finalContent);
    }

    const stopReason = extractStopReason(result);
    const finalState = mapStopReasonToGatewayTurnState(stopReason);
    this.finishPromptTurn(turn, finalState, undefined, stopReason);
  }

  private failPromptTurn(turnId: string, error: unknown): void {
    const turn = this.promptTurns.get(turnId);
    if (!turn) {
      return;
    }

    if (turn.done) {
      this.handleSettledPromptResponseAfterLocalFinish(turn);
      return;
    }

    this.finishPromptTurn(turn, 'failed', {
      code: 'downstream_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private notifyPromptTurnWaiters(turn: PromptTurnState): void {
    const waiters = Array.from(turn.waiters);
    turn.waiters.clear();
    for (const waiter of waiters) {
      waiter();
    }
  }

  private getPromptTurn(turnId: string): PromptTurnState {
    const turn = this.promptTurns.get(turnId);
    if (!turn) {
      throw new AaiError(
        'INVALID_PARAMS',
        `No ACP prompt turn found for turn '${turnId}'. Call turn/start first, or use a valid turnId returned by the gateway.`
      );
    }
    return turn;
  }

  private clearPromptTurnsForLocal(appId: string): void {
    for (const turn of Array.from(this.promptTurns.values())) {
      if (turn.appId !== appId) {
        continue;
      }

      if (!turn.done) {
        this.finishPromptTurn(
          turn,
          'cancelled',
          {
            code: 'downstream_stopped',
            message: `ACP agent '${appId}' stopped before the turn completed.`,
          },
          'cancelled',
          false
        );
      }

      this.removePromptTurn(turn.turnId);
    }

    for (const [sessionId, owner] of Array.from(this.sessionOwners.entries())) {
      if (owner === appId) {
        this.sessionOwners.delete(sessionId);
      }
    }
  }

  private sendRequest(
    appId: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    const state = this.states.get(appId);
    if (!state?.proc.stdin) {
      throw new AaiError('SERVICE_UNAVAILABLE', `ACP agent '${appId}' is not running`);
    }

    const id = ++this.requestId;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    logger.info(
      {
        appId,
        method,
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
        timeoutMs: timeoutMs > 0 ? timeoutMs : undefined,
      },
      'ACP request started'
    );

    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pendingRequests.delete(String(id));
              logger.error({ appId, method, timeoutMs }, 'ACP request timed out');
              reject(new AaiError('TIMEOUT', `${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs)
          : undefined;
      this.pendingRequests.set(String(id), {
        resolve: (value) => {
          logger.info({ appId, method }, 'ACP request completed');
          resolve(value);
        },
        reject: (error) => {
          logger.error({ appId, method, error }, 'ACP request failed');
          reject(error);
        },
        timer,
        timeoutMs: timeoutMs > 0 ? timeoutMs : undefined,
        method,
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
      });
      state.proc.stdin?.write(`${payload}\n`);
    });
  }

  private handleMessage(appId: string, data: string): void {
    const state = this.states.get(appId);
    if (!state) return;

    const combined = state.buffer + data;
    const lines = combined.split('\n');
    state.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JsonRpcMessage;
        this.dispatchMessage(message);
      } catch (err) {
        logger.warn({ appId, line: trimmed, err }, 'Failed to parse ACP message');
      }
    }
  }

  private dispatchMessage(message: JsonRpcMessage): void {
    if (isJsonRpcRequest(message) && message.method === 'session/request_permission') {
      void this.handlePermissionRequest(message).catch((err) => {
        logger.warn({ err, method: message.method, id: message.id }, 'Failed to handle ACP request');
      });
      return;
    }

    if ('id' in message && !('method' in message)) {
      const pending = this.pendingRequests.get(String(message.id));
      if (!pending) {
        return;
      }

      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      this.pendingRequests.delete(String(message.id));

      if (message.error) {
        pending.reject(
          new AaiError('INTERNAL_ERROR', message.error.message, message.error.data as object)
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (isJsonRpcNotification(message) && message.method === 'session/update') {
      const sessionId = extractSessionId(message.params);
      if (sessionId) {
        this.capturePromptUpdate(sessionId, message.params);
      }
    }
  }

  private async handlePermissionRequest(message: JsonRpcRequest): Promise<void> {
    const sessionId = extractSessionId(message.params);
    if (!sessionId) {
      return;
    }

    const turn = this.resolvePromptTurnForPermission(sessionId);
    const appId = turn?.appId ?? this.sessionOwners.get(sessionId);
    const pending = createPendingPermissionRequest(message, appId);
    if (!pending) {
      if (appId) {
        await this.sendJsonRpcResult(appId, message.id, {
          outcome: { outcome: 'cancelled' },
        });
      }
      return;
    }

    if (!turn || turn.done) {
      await this.sendJsonRpcResult(pending.appId, pending.downstreamRequestId, {
        outcome: { outcome: 'cancelled' },
      });
      return;
    }

    pending.turnId = turn.turnId;
    this.clearPendingPermissionRequest(turn);
    this.pendingPermissionRequests.set(pending.permissionId, pending);
    turn.permissionRequest = toGatewayPermissionRequest(pending);
    turn.state = 'waiting_permission';
    turn.message = 'Waiting for user permission.';
    turn.lastTouchedAt = Date.now();
    if (turn.inactivityTimer) {
      clearTimeout(turn.inactivityTimer);
      turn.inactivityTimer = undefined;
    }
    this.notifyPromptTurnWaiters(turn);
  }

  private capturePromptUpdate(sessionId: string, params: unknown): void {
    const content = extractUpdateContent(params);
    const taskStatus = extractTaskStatus(params);
    if (content.length === 0 && !taskStatus) {
      return;
    }

    logger.debug(
      {
        sessionId,
        contentBlocks: content.length,
        textPreview: previewContentBlocks(content),
        taskStatus: taskStatus?.status,
      },
      'ACP session/update received'
    );

    const updateMessageId = extractUpdateMessageId(params);
    const turn = this.resolvePromptTurnForUpdate(sessionId, updateMessageId);
    if (!turn) {
      return;
    }

    if (turn.done) {
      return;
    }

    if (updateMessageId) {
      this.bindMessageIdToTurn(sessionId, updateMessageId, turn);
    }

    let contentChanged = false;
    if (content.length > 0) {
      contentChanged = this.appendPromptTurnContent(turn, content) || contentChanged;
    }

    // session/update taskStatus is treated as downstream activity only.
    // It does not map to the lifetime of the gateway prompt turn.
    if (contentChanged || taskStatus) {
      this.recordPromptTurnActivity(turn);
    }

    if (contentChanged) {
      this.notifyPromptTurnWaiters(turn);
    }
  }

  private appendPromptTurnContent(turn: PromptTurnState, incoming: AcpContentBlock[]): boolean {
    let changed = false;

    for (const block of incoming) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const merged = mergePromptText(turn.outputText, block.text);
        if (merged.deltaText.length === 0) {
          continue;
        }

        turn.outputText = merged.mergedText;
        appendAccumulatedContentBlock(turn.content, { ...block, text: merged.deltaText });
        appendAccumulatedContentBlock(turn.pendingContent, { ...block, text: merged.deltaText });
        changed = true;
        continue;
      }

      const appended = appendAccumulatedContentBlock(turn.content, block);
      if (appended) {
        appendAccumulatedContentBlock(turn.pendingContent, block);
      }
      changed = appended || changed;
    }

    if (!changed) {
      return false;
    }

    turn.lastTouchedAt = Date.now();
    return true;
  }

  private finishPromptTurn(
    turn: PromptTurnState,
    state: 'completed' | 'failed' | 'cancelled',
    error?: GatewayTurnError,
    stopReason?: string | null,
    advanceQueue = true,
    releaseSessionBinding = true
  ): void {
    if (turn.done) {
      return;
    }

    turn.done = true;
    turn.state = state;
    turn.message = undefined;
    turn.error = error;
    turn.stopReason = stopReason ?? null;
    turn.lastTouchedAt = Date.now();
    if (turn.inactivityTimer) {
      clearTimeout(turn.inactivityTimer);
      turn.inactivityTimer = undefined;
    }
    if (turn.drainTimer) {
      clearTimeout(turn.drainTimer);
      turn.drainTimer = undefined;
    }
    this.clearPendingPermissionRequest(turn);

    if (releaseSessionBinding) {
      this.releaseTurnSessionBinding(turn, advanceQueue);
    } else {
      this.dequeuePromptTurn(turn.sessionId, turn.turnId);
    }

    this.schedulePromptTurnCleanup(turn);
    logger.info(
      {
        appId: turn.appId,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        state,
        stopReason: turn.stopReason,
        durationMs: turn.startedAt ? Date.now() - turn.startedAt : undefined,
        outputChars: turn.outputText.length,
        ...(error ? { error: error.message } : {}),
      },
      'ACP session/prompt turn finished'
    );
    this.notifyPromptTurnWaiters(turn);
  }

  private launchNextPromptTurn(sessionId: string): void {
    const queued = this.queuedTurnIdsBySession.get(sessionId);
    if (!queued || queued.length === 0) {
      return;
    }

    const nextTurnId = queued.shift();
    if (!nextTurnId) {
      return;
    }

    if (queued.length === 0) {
      this.queuedTurnIdsBySession.delete(sessionId);
    } else {
      this.queuedTurnIdsBySession.set(sessionId, queued);
    }

    const nextTurn = this.promptTurns.get(nextTurnId);
    if (!nextTurn || nextTurn.done) {
      this.launchNextPromptTurn(sessionId);
      return;
    }

    this.launchPromptTurn(nextTurn);
  }

  private dequeuePromptTurn(sessionId: string, turnId: string): void {
    const queued = this.queuedTurnIdsBySession.get(sessionId);
    if (!queued) {
      return;
    }

    const nextQueued = queued.filter((candidate) => candidate !== turnId);
    if (nextQueued.length === 0) {
      this.queuedTurnIdsBySession.delete(sessionId);
      return;
    }

    this.queuedTurnIdsBySession.set(sessionId, nextQueued);
  }

  private schedulePromptTurnCleanup(turn: PromptTurnState): void {
    if (turn.cleanupTimer) {
      clearTimeout(turn.cleanupTimer);
    }

    turn.cleanupTimer = setTimeout(() => {
      this.removePromptTurn(turn.turnId);
    }, ACP_TURN_TTL_MS);
  }

  private removePromptTurn(turnId: string): void {
    const turn = this.promptTurns.get(turnId);
    if (!turn) {
      return;
    }

    if (turn.cleanupTimer) {
      clearTimeout(turn.cleanupTimer);
    }
    if (turn.inactivityTimer) {
      clearTimeout(turn.inactivityTimer);
    }
    if (turn.drainTimer) {
      clearTimeout(turn.drainTimer);
    }

    this.clearPendingPermissionRequest(turn);

    if (this.activeTurnIdsBySession.get(turn.sessionId) === turn.turnId) {
      this.activeTurnIdsBySession.delete(turn.sessionId);
    } else {
      this.dequeuePromptTurn(turn.sessionId, turn.turnId);
    }

    this.unbindTurnMessageIds(turn);
    this.promptTurns.delete(turnId);
  }

  private takePendingTurnContent(turn: PromptTurnState): AcpContentBlock[] {
    const content = turn.pendingContent.map((block) => ({ ...block }));
    turn.pendingContent = [];
    return content;
  }

  private recordPromptTurnActivity(turn: PromptTurnState): void {
    turn.lastTouchedAt = Date.now();
    turn.lastUpdateAt = turn.lastTouchedAt;

    if (turn.inactivityTimer) {
      clearTimeout(turn.inactivityTimer);
      turn.inactivityTimer = undefined;
    }

    if (turn.state === 'waiting_permission') {
      return;
    }

    turn.inactivityTimer = setTimeout(() => {
      const nextTurn = this.promptTurns.get(turn.turnId);
      if (!nextTurn || nextTurn.done || nextTurn.state === 'waiting_permission') {
        return;
      }

      const inactiveForMs = Date.now() - nextTurn.lastUpdateAt;
      logger.warn(
        {
          sessionId: nextTurn.sessionId,
          turnId: nextTurn.turnId,
          inactiveForMs,
          timeoutMs: ACP_TURN_INACTIVITY_TIMEOUT_MS,
        },
        'ACP turn timed out waiting for session/update activity'
      );
      void this.handlePromptTurnInactivityTimeout(nextTurn);
    }, ACP_TURN_INACTIVITY_TIMEOUT_MS);
  }

  private async handlePromptTurnInactivityTimeout(turn: PromptTurnState): Promise<void> {
    if (turn.done || turn.state === 'waiting_permission') {
      return;
    }

    const error: GatewayTurnError = {
      code: 'downstream_timeout',
      message: `ACP turn timed out after ${ACP_TURN_INACTIVITY_TIMEOUT_MS}ms without any session/update activity.`,
    };
    turn.awaitingDownstreamResponse = true;

    try {
      await this.sendNotification(turn.appId, 'session/cancel', { sessionId: turn.sessionId });
    } catch (cancelError) {
      logger.warn(
        { appId: turn.appId, sessionId: turn.sessionId, turnId: turn.turnId, err: cancelError },
        'Failed to send ACP session/cancel after inactivity timeout'
      );
    }

    this.finishPromptTurn(turn, 'failed', error, null, false, false);
    this.schedulePromptTurnDrain(turn);
  }

  private schedulePromptTurnDrain(turn: PromptTurnState): void {
    if (turn.drainTimer) {
      clearTimeout(turn.drainTimer);
    }

    turn.drainTimer = setTimeout(() => {
      const nextTurn = this.promptTurns.get(turn.turnId);
      if (!nextTurn || !nextTurn.awaitingDownstreamResponse) {
        return;
      }

      logger.warn(
        { sessionId: nextTurn.sessionId, turnId: nextTurn.turnId, timeoutMs: ACP_SESSION_TIMEOUT_MS },
        'ACP prompt turn drain window expired; releasing session binding locally'
      );
      nextTurn.awaitingDownstreamResponse = false;
      this.releaseTurnSessionBinding(nextTurn, true);
    }, ACP_SESSION_TIMEOUT_MS);
  }

  private handleSettledPromptResponseAfterLocalFinish(turn: PromptTurnState): void {
    if (!turn.awaitingDownstreamResponse) {
      return;
    }

    turn.awaitingDownstreamResponse = false;
    if (turn.drainTimer) {
      clearTimeout(turn.drainTimer);
      turn.drainTimer = undefined;
    }
    this.releaseTurnSessionBinding(turn, true);
  }

  private releaseTurnSessionBinding(turn: PromptTurnState, advanceQueue: boolean): void {
    if (this.activeTurnIdsBySession.get(turn.sessionId) === turn.turnId) {
      this.activeTurnIdsBySession.delete(turn.sessionId);
      if (advanceQueue) {
        this.launchNextPromptTurn(turn.sessionId);
      }
      return;
    }

    this.dequeuePromptTurn(turn.sessionId, turn.turnId);
  }

  private resolvePromptTurnForPermission(sessionId: string): PromptTurnState | undefined {
    const activeTurnId = this.activeTurnIdsBySession.get(sessionId);
    if (!activeTurnId) {
      return undefined;
    }

    return this.promptTurns.get(activeTurnId);
  }

  private resolvePromptTurnForUpdate(
    sessionId: string,
    updateMessageId?: string
  ): PromptTurnState | undefined {
    if (updateMessageId) {
      const trackedTurnId = this.trackedTurnIdsBySessionAndMessage.get(
        buildSessionMessageKey(sessionId, updateMessageId)
      );
      if (trackedTurnId) {
        return this.promptTurns.get(trackedTurnId);
      }
    }

    const activeTurnId = this.activeTurnIdsBySession.get(sessionId);
    if (!activeTurnId) {
      return undefined;
    }

    return this.promptTurns.get(activeTurnId);
  }

  private bindMessageIdToTurn(
    sessionId: string,
    messageId: string,
    turn: PromptTurnState
  ): void {
    const key = buildSessionMessageKey(sessionId, messageId);
    this.trackedTurnIdsBySessionAndMessage.set(key, turn.turnId);
    turn.trackedMessageIds.add(messageId);
  }

  private unbindTurnMessageIds(turn: PromptTurnState): void {
    for (const messageId of turn.trackedMessageIds) {
      this.trackedTurnIdsBySessionAndMessage.delete(
        buildSessionMessageKey(turn.sessionId, messageId)
      );
    }
    turn.trackedMessageIds.clear();
  }

  private clearPendingPermissionRequest(turn: PromptTurnState, permissionId?: string): void {
    const targetPermissionId = permissionId ?? turn.permissionRequest?.permissionId;
    if (!targetPermissionId) {
      turn.permissionRequest = undefined;
      return;
    }

    this.pendingPermissionRequests.delete(targetPermissionId);
    if (turn.permissionRequest?.permissionId === targetPermissionId) {
      turn.permissionRequest = undefined;
    }
  }

  private async cancelPendingPermissionRequest(turn: PromptTurnState): Promise<void> {
    const permissionId = turn.permissionRequest?.permissionId;
    if (!permissionId) {
      return;
    }

    const pending = this.pendingPermissionRequests.get(permissionId);
    if (!pending) {
      turn.permissionRequest = undefined;
      return;
    }

    await this.sendJsonRpcResult(pending.appId, pending.downstreamRequestId, {
      outcome: { outcome: 'cancelled' },
    });
    this.clearPendingPermissionRequest(turn, permissionId);
  }

  private async sendNotification(
    appId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const state = this.states.get(appId);
    if (!state?.proc.stdin) {
      throw new AaiError('SERVICE_UNAVAILABLE', `ACP agent '${appId}' is not running`);
    }

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });

    logger.info(
      {
        appId,
        method,
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
      },
      'ACP notification sent'
    );

    state.proc.stdin.write(`${payload}\n`);
  }

  private async sendJsonRpcResult(
    appId: string,
    id: number | string,
    result: Record<string, unknown>
  ): Promise<void> {
    const state = this.states.get(appId);
    if (!state?.proc.stdin) {
      throw new AaiError('SERVICE_UNAVAILABLE', `ACP agent '${appId}' is not running`);
    }

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      result,
    });

    logger.info({ appId, responseTo: id }, 'ACP response sent');
    state.proc.stdin.write(`${payload}\n`);
  }

}

function isJsonRpcNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return 'method' in message && !('id' in message);
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return 'method' in message && 'id' in message;
}

function extractSessionId(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return null;
  }

  const sessionId = (params as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

function extractUpdateContent(params: unknown): AcpContentBlock[] {
  if (!params || typeof params !== 'object') {
    return [];
  }

  const update = (params as { update?: unknown }).update;
  if (!update || typeof update !== 'object') {
    return [];
  }

  const sessionUpdate = (update as { sessionUpdate?: unknown }).sessionUpdate;
  if (
    sessionUpdate === 'available_commands_update' ||
    sessionUpdate === 'usage_update' ||
    sessionUpdate === 'session_title_update'
  ) {
    return [];
  }

  const candidates = [
    update,
    (update as { content?: unknown }).content,
    (update as { output?: unknown }).output,
    (update as { delta?: unknown }).delta,
    (update as { response?: unknown }).response,
  ];

  return normalizeContentBlocks(candidates);
}

function extractUpdateMessageId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') {
    return undefined;
  }

  const update = (params as { update?: unknown }).update;
  if (!update || typeof update !== 'object') {
    return undefined;
  }

  const messageId = (update as { messageId?: unknown }).messageId;
  return typeof messageId === 'string' && messageId.length > 0 ? messageId : undefined;
}

function extractTaskStatus(
  params: unknown
): {
  status: 'queued' | 'working' | 'completed' | 'failed' | 'cancelled';
  message?: string;
} | null {
  if (!params || typeof params !== 'object') {
    return null;
  }

  const candidates = [
    params,
    (params as { update?: unknown }).update,
    (params as { session?: unknown }).session,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const rawStatus =
      (candidate as { status?: unknown }).status ??
      (candidate as { state?: unknown }).state ??
      (candidate as { phase?: unknown }).phase;

    const status = normalizeTaskStatusValue(rawStatus);
    if (!status) {
      continue;
    }

    const message =
      extractStringField(candidate, 'message') ??
      extractStringField(candidate, 'title') ??
      extractStringField(candidate, 'detail');

    return message ? { status, message } : { status };
  }

  return null;
}

function normalizeTaskStatusValue(
  value: unknown
): 'queued' | 'working' | 'completed' | 'failed' | 'cancelled' | null {
  if (typeof value !== 'string') {
    return null;
  }

  switch (value.toLowerCase()) {
    case 'queued':
    case 'pending':
      return 'queued';
    case 'working':
    case 'running':
    case 'in_progress':
    case 'streaming':
      return 'working';
    case 'completed':
    case 'complete':
    case 'done':
    case 'finished':
    case 'end_turn':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'cancelled':
    case 'canceled':
    case 'interrupted':
      return 'cancelled';
    default:
      return null;
  }
}

function extractStringField(obj: object, key: 'message' | 'title' | 'detail'): string | undefined {
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeSessionNewArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.cwd !== 'string' || args.cwd.length === 0) {
    throw new AaiError(
      'INVALID_PARAMS',
      'ACP session/new requires args.cwd (absolute working directory string)'
    );
  }

  // mcpServers is required by codex-acp but we default to empty array if not provided
  const mcpServers = Array.isArray(args.mcpServers) ? args.mcpServers : [];

  return {
    cwd: args.cwd,
    mcpServers,
  };
}

function normalizePromptArgs(
  args: Record<string, unknown>,
  sessionId: string
): Record<string, unknown> {
  const rawPrompt = args.prompt;
  const prompt = Array.isArray(rawPrompt) && rawPrompt.length > 0 ? rawPrompt : undefined;

  if (!prompt) {
    throw createMissingPromptError();
  }

  return {
    sessionId,
    messageId:
      typeof args.messageId === 'string' && args.messageId.length > 0
        ? args.messageId
        : randomUUID(),
    prompt,
  };
}

function requireMessageId(params: Record<string, unknown>): string {
  const messageId = params.messageId;
  if (typeof messageId === 'string' && messageId.length > 0) {
    return messageId;
  }

  throw new AaiError('INTERNAL_ERROR', 'ACP prompt turn is missing messageId');
}

function buildSessionMessageKey(sessionId: string, messageId: string): string {
  return `${sessionId}::${messageId}`;
}

function assertPromptInput(args: Record<string, unknown>): void {
  const hasPromptBlocks = Array.isArray(args.prompt) && args.prompt.length > 0;
  if (!hasPromptBlocks) {
    throw createMissingPromptError();
  }
}

function createMissingPromptError(): AaiError {
  return new AaiError(
    'INVALID_PARAMS',
    'ACP turn/start requires args.prompt (ACP content blocks array)'
  );
}

function requireSessionId(
  args: Record<string, unknown>,
  errorMessage = 'ACP polling requires args.sessionId'
): string {
  const sessionId = args.sessionId;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return sessionId;
  }

  throw new AaiError('INVALID_PARAMS', errorMessage);
}

function requireTurnId(args: Record<string, unknown>): string {
  const turnId = args.turnId;
  if (typeof turnId === 'string' && turnId.length > 0) {
    return turnId;
  }

  throw new AaiError('INVALID_PARAMS', 'ACP turn polling requires args.turnId');
}

function requirePermissionId(args: Record<string, unknown>): string {
  const permissionId = args.permissionId;
  if (typeof permissionId === 'string' && permissionId.length > 0) {
    return permissionId;
  }

  throw new AaiError('INVALID_PARAMS', 'ACP turn/respondPermission requires args.permissionId');
}

function normalizePermissionDecision(
  value: unknown,
  pending: PendingPermissionRequest
): { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } {
  if (!value || typeof value !== 'object') {
    throw new AaiError(
      'INVALID_PARAMS',
      'ACP turn/respondPermission requires args.decision with { type: "select" | "cancel" }.'
    );
  }

  const decision = value as { type?: unknown; optionId?: unknown };
  if (decision.type === 'cancel') {
    return { outcome: 'cancelled' };
  }

  if (decision.type !== 'select') {
    throw new AaiError(
      'INVALID_PARAMS',
      'ACP turn/respondPermission args.decision.type must be "select" or "cancel".'
    );
  }

  const optionId = decision.optionId;
  if (typeof optionId !== 'string' || optionId.length === 0) {
    throw new AaiError(
      'INVALID_PARAMS',
      'ACP turn/respondPermission requires args.decision.optionId when decision.type is "select".'
    );
  }

  const valid = pending.options.some((option) => option.id === optionId);
  if (!valid) {
    throw new AaiError(
      'INVALID_PARAMS',
      `Permission option '${optionId}' is not valid for permission '${pending.permissionId}'.`
    );
  }

  return { outcome: 'selected', optionId };
}

function mergePromptText(
  current: string,
  incoming: string
): {
  mergedText: string;
  deltaText: string;
} {
  if (!incoming) {
    return { mergedText: current, deltaText: '' };
  }

  if (!current) {
    return { mergedText: truncatePromptText(incoming), deltaText: incoming };
  }

  if (incoming === current || current.endsWith(incoming)) {
    return { mergedText: current, deltaText: '' };
  }

  if (incoming.startsWith(current)) {
    return {
      mergedText: truncatePromptText(incoming),
      deltaText: incoming.slice(current.length),
    };
  }

  return {
    mergedText: truncatePromptText(current + incoming),
    deltaText: incoming,
  };
}

function appendAccumulatedContentBlock(
  target: AcpContentBlock[],
  block: AcpContentBlock
): boolean {
  const last = target[target.length - 1];

  if (block.type === 'text' && typeof block.text === 'string' && block.text.length === 0) {
    return false;
  }

  if (
    last &&
    last.type === 'text' &&
    block.type === 'text' &&
    typeof last.text === 'string' &&
    typeof block.text === 'string'
  ) {
    last.text += block.text;
    return true;
  }

  const lastSerialized = last ? JSON.stringify(last) : null;
  const nextSerialized = JSON.stringify(block);
  if (lastSerialized === nextSerialized) {
    return false;
  }

  target.push({ ...block });
  return true;
}

function truncatePromptText(text: string): string {
  if (text.length <= ACP_MAX_OUTPUT_CHARS) {
    return text;
  }

  return text.slice(0, ACP_MAX_OUTPUT_CHARS);
}

function truncateLogPreview(text: string, maxChars = 160): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`;
}

function extractResultContent(result: unknown): AcpContentBlock[] {
  return normalizeContentBlocks([result]);
}

function normalizeContentBlocks(candidates: unknown[]): AcpContentBlock[] {
  const blocks = dedupeContentBlocks(
    candidates.flatMap((candidate) => collectContentBlocks(candidate))
  );
  if (blocks.length > 0) {
    return blocks;
  }

  const fragments = Array.from(new Set(candidates.flatMap((candidate) => collectTextFragments(candidate))));
  return fragments.map((text) => ({ type: 'text', text }));
}

function dedupeContentBlocks(blocks: AcpContentBlock[]): AcpContentBlock[] {
  const seen = new Set<string>();
  const deduped: AcpContentBlock[] = [];

  for (const block of blocks) {
    const serialized = JSON.stringify(block);
    if (seen.has(serialized)) {
      continue;
    }
    seen.add(serialized);
    deduped.push(block);
  }

  return deduped;
}

function collectContentBlocks(value: unknown): AcpContentBlock[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectContentBlocks(item));
  }

  if (typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;

  if (isContentBlock(record)) {
    return [record as AcpContentBlock];
  }

  if (record.type === 'content' && record.content) {
    return collectContentBlocks(record.content);
  }

  const nested = [
    record.content,
    record.contents,
    record.output,
    record.outputs,
    record.delta,
    record.response,
    record.responses,
    record.chunk,
    record.chunks,
    record.item,
    record.items,
    record.result,
    record.results,
  ];

  return nested.flatMap((item) => collectContentBlocks(item));
}

function isContentBlock(value: Record<string, unknown>): boolean {
  if (typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'text':
      return typeof value.text === 'string';
    case 'image':
      return true;
    case 'audio':
      return true;
    case 'resource':
      return true;
    case 'resource_link':
      return true;
    default:
      return false;
  }
}

function previewContentBlocks(blocks: AcpContentBlock[]): string | undefined {
  const texts = blocks
    .filter((block): block is AcpContentBlock & { type: 'text'; text: string } => typeof block.text === 'string')
    .map((block) => block.text)
    .join('');

  return texts.length > 0 ? truncateLogPreview(texts) : undefined;
}

function createPendingPermissionRequest(
  message: JsonRpcRequest,
  appId?: string
): PendingPermissionRequest | null {
  const sessionId = extractSessionId(message.params);
  if (!sessionId || !appId) {
    return null;
  }

  const params =
    message.params && typeof message.params === 'object'
      ? (message.params as Record<string, unknown>)
      : null;
  const toolCall =
    params?.toolCall && typeof params.toolCall === 'object'
      ? (params.toolCall as Record<string, unknown>)
      : null;
  const options = normalizePermissionOptions(params?.options);
  if (options.length === 0) {
    return null;
  }

  const title =
    extractStringField(toolCall ?? {}, 'title') ??
    extractStringField(params ?? {}, 'title') ??
    'Permission request';
  const description =
    firstNonEmptyText(
      toolCall ? collectTextFragments(toolCall.content ?? toolCall.rawInput ?? toolCall.rawOutput) : []
    ) ??
    extractStringField(params ?? {}, 'detail') ??
    extractStringField(params ?? {}, 'message');

  return {
    appId,
    turnId: '',
    sessionId,
    downstreamRequestId: message.id,
    permissionId: randomUUID(),
    title,
    ...(description ? { description } : {}),
    options,
  };
}

function normalizePermissionOptions(value: unknown): GatewayPermissionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const option = entry as Record<string, unknown>;
    const id = option.optionId;
    const label = option.name;
    if (typeof id !== 'string' || id.length === 0 || typeof label !== 'string' || label.length === 0) {
      return [];
    }

    return [{ id, label }];
  });
}

function firstNonEmptyText(texts: string[]): string | undefined {
  return texts.find((text) => text.length > 0);
}

function toGatewayPermissionRequest(
  pending: PendingPermissionRequest
): GatewayPermissionRequest {
  return {
    permissionId: pending.permissionId,
    title: pending.title,
    ...(pending.description ? { description: pending.description } : {}),
    options: pending.options.map((option) => ({ ...option })),
  };
}

function extractStopReason(result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const raw = (result as { stopReason?: unknown; stop_reason?: unknown }).stopReason ??
    (result as { stopReason?: unknown; stop_reason?: unknown }).stop_reason;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function mapStopReasonToGatewayTurnState(
  stopReason: string | null
): 'completed' | 'cancelled' {
  if (!stopReason) {
    return 'completed';
  }

  return stopReason === 'cancelled' ? 'cancelled' : 'completed';
}

function extractPromptCapabilities(
  initializeResult: Record<string, unknown> | null
): Record<string, unknown> {
  if (!initializeResult) {
    return {};
  }

  const agentCapabilities = initializeResult.agentCapabilities;
  if (!agentCapabilities || typeof agentCapabilities !== 'object') {
    return {};
  }

  const promptCapabilities = (agentCapabilities as Record<string, unknown>).promptCapabilities;
  return promptCapabilities && typeof promptCapabilities === 'object'
    ? (promptCapabilities as Record<string, unknown>)
    : {};
}

function collectTextFragments(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFragments(item));
  }

  if (typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;

  if (record.type === 'text' && typeof record.text === 'string' && record.text.length > 0) {
    return [record.text];
  }

  const direct = [
    record.outputText,
    record.text,
    record.delta,
    record.content,
    record.contents,
    record.output,
    record.outputs,
    record.response,
    record.responses,
    record.chunk,
    record.chunks,
    record.item,
    record.items,
    record.result,
    record.results,
  ];

  return direct.flatMap((item) => collectTextFragments(item));
}

let singleton: AcpExecutor | undefined;

export function getAcpExecutor(): AcpExecutor {
  if (!singleton) {
    singleton = new AcpExecutor();
  }
  return singleton;
}
