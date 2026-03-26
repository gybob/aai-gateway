import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { AaiError } from '../errors/errors.js';
import type {
  AcpAgentConfig,
  AcpExecutorConfig,
  DetailedCapability,
  ExecutionResult,
} from '../types/index.js';
import type { AppCapabilities, ToolSchema } from '../types/capabilities.js';
import { logger } from '../utils/logger.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';
import { ACP_TOOL_SCHEMAS } from './acp-tool-schemas.js';
import { validateArgs, formatValidationErrors } from '../utils/schema-validator.js';

import type { ExecutionObserver, ExecutionTaskStatus, TaskCapableExecutor } from './events.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
  timeoutMs?: number;
  method: string;
  sessionId?: string;
}

type AcpContentBlock = Record<string, unknown> & { type: string };

interface PromptTurnState {
  appId: string;
  turnId: string;
  sessionId: string;
  outputText: string;
  content: AcpContentBlock[];
  done: boolean;
  status: ExecutionTaskStatus;
  statusMessage?: string;
  error?: string;
  waiters: Set<() => void>;
  cleanupTimer?: NodeJS.Timeout;
  lastTouchedAt: number;
  params: Record<string, unknown>;
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

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

interface ProcessState {
  proc: ChildProcess;
  buffer: string;
  initialized: boolean;
  initializeResult?: Record<string, unknown>;
}

const ACP_INITIALIZE_TIMEOUT_MS = 60000;
const ACP_SESSION_TIMEOUT_MS = 30000;
const ACP_POLL_WAIT_MS = 30000;
const ACP_TURN_TTL_MS = 5 * 60_000;
const ACP_MAX_OUTPUT_CHARS = 200_000;
const ACP_EMPTY_CONTENT_MESSAGE = '处理中，请继续等待';
const ACP_NON_INTERACTIVE_GUIDANCE =
  'AAI Gateway instruction: operate in non-interactive mode. Do not ask for human confirmation, approval, or additional input. If confirmation would normally be required, choose the safest non-interactive path available or explain the limitation in your final response instead of waiting.';

function toToolSchemaReference(schema: ToolSchema): Record<string, unknown> {
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
        suggestion: `请参考 schema 重试:\n${JSON.stringify(schema.inputSchema, null, 2)}`,
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
  private activeTurnIdsBySession = new Map<string, string>();
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
   * Load app-level capabilities (tool list without parameter definitions)
   * ACP tools are hardcoded
   */
  async loadAppCapabilities(
    _appId: string,
    _config: AcpAgentConfig & AcpExecutorConfig
  ): Promise<AppCapabilities> {
    const tools = ACP_TOOL_SCHEMAS.map((schema) => ({
      name: schema.name,
      description: schema.description ?? '',
    }));

    return { title: 'ACP Agent', tools };
  }

  /**
   * Load schema for a specific tool
   * Returns null if tool not found
   */
  async loadToolSchema(
    _appId: string,
    _config: AcpAgentConfig & AcpExecutorConfig,
    toolName: string
  ): Promise<ToolSchema | null> {
    const schema = ACP_TOOL_SCHEMAS.find((s) => s.name === toolName);
    if (!schema) return null;

    return {
      name: schema.name,
      description: schema.description,
      inputSchema: schema.inputSchema ?? { type: 'object', properties: {} },
      outputSchema: schema.outputSchema,
    };
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
      // Validate arguments against schema if available
      const schema = await this.loadToolSchema(appId, config, operation);
      if (schema) {
        const result = validateArgs(args, schema.inputSchema);
        if (!result.valid) {
          const errorMessage = `参数校验失败 for '${operation}'\n${formatValidationErrors(result)}`;
          return {
            success: false,
            error: errorMessage,
            schema: toToolSchemaReference(schema),
            suggestion: `请参考 schema 重试:\n${JSON.stringify(schema.inputSchema, null, 2)}`,
          };
        }
      }

      await this.ensureInitialized(appId, config);

      if (operation === 'prompt') {
        throw new AaiError(
          'INVALID_PARAMS',
          'ACP tool "prompt" has been removed. Call "session/new" first, then call "session/prompt" with the returned sessionId.'
        );
      }

      if (operation === 'session/new') {
        return { success: true, data: await this.handleSessionNewRequest(appId, args) };
      }

      if (operation === 'session/prompt') {
        return { success: true, data: await this.handleSessionPromptRequest(appId, args) };
      }

      if (operation === 'turn/poll') {
        return { success: true, data: await this.handleTurnPollRequest(appId, args) };
      }

      if (operation === 'turn/cancel') {
        return { success: true, data: await this.handleTurnCancelRequest(appId, args) };
      }

      if (operation === 'session/poll') {
        return { success: true, data: await this.handleSessionPollRequest(appId, args) };
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

  private async handleSessionPromptRequest(
    appId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    validateAcpArgs('session/prompt', args);
    assertPromptInput(args);
    const sessionId = requireSessionId(args, 'ACP session/prompt requires args.sessionId. Call session/new first, then pass the returned sessionId to session/prompt.');
    this.sessionOwners.set(sessionId, appId);
    return this.startPromptTurn(appId, sessionId, normalizePromptArgs(args, sessionId));
  }

  private async handleSessionPollRequest(
    appId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    validateAcpArgs('session/poll', args);
    const sessionId = requireSessionId(args);
    const turnId = this.resolveTurnIdForSessionPoll(sessionId);
    return this.waitForPromptTurn(appId, turnId);
  }

  private async handleTurnPollRequest(
    appId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    validateAcpArgs('turn/poll', args);
    return this.waitForPromptTurn(appId, requireTurnId(args));
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
      this.finishPromptTurn(turn, 'cancelled', 'ACP turn was cancelled before execution started.');
      return this.buildTurnCancelResult(turn, true);
    }

    await this.sendRequest(
      appId,
      'session/cancel',
      { sessionId: turn.sessionId },
      ACP_SESSION_TIMEOUT_MS
    );
    this.finishPromptTurn(turn, 'cancelled', 'ACP turn was cancelled by the caller.');
    return this.buildTurnCancelResult(turn, true);
  }

  private async startPromptTurn(
    appId: string,
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const turnId = randomUUID();
    const turn: PromptTurnState = {
      appId,
      turnId,
      sessionId,
      outputText: '',
      content: [],
      done: false,
      status: 'queued',
      waiters: new Set(),
      lastTouchedAt: Date.now(),
      params,
      statusMessage: 'Waiting to start.',
    };
    this.promptTurns.set(turnId, turn);
    this.sessionOwners.set(sessionId, appId);

    const activeTurnId = this.activeTurnIdsBySession.get(sessionId);
    if (activeTurnId) {
      const queued = this.queuedTurnIdsBySession.get(sessionId) ?? [];
      queued.push(turnId);
      this.queuedTurnIdsBySession.set(sessionId, queued);
      turn.statusMessage = 'Waiting for an earlier turn on the same session to finish.';
    } else {
      this.launchPromptTurn(turn);
    }

    return this.waitForPromptTurn(appId, turnId);
  }

  private launchPromptTurn(turn: PromptTurnState): void {
    turn.status = 'working';
    turn.statusMessage = 'Turn started.';
    turn.lastTouchedAt = Date.now();
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
    turn.lastTouchedAt = Date.now();
    if (turn.done) {
      return Promise.resolve(this.buildPromptTurnResult(turn));
    }

    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        turn.waiters.delete(wake);
        const nextTurn = this.getPromptTurn(turnId);
        nextTurn.lastTouchedAt = Date.now();
        resolve(this.buildPromptTurnResult(nextTurn));
      };

      const timer = setTimeout(() => {
        turn.waiters.delete(wake);
        const nextTurn = this.getPromptTurn(turnId);
        nextTurn.lastTouchedAt = Date.now();
        resolve(this.buildPromptTurnResult(nextTurn));
      }, this.pollWaitMs);

      turn.waiters.add(wake);
    });
  }

  private buildPromptTurnResult(turn: PromptTurnState): Record<string, unknown> {
    const content = this.collectTurnContent(turn);
    return {
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      done: turn.done,
      content: content.length > 0 ? content : [{ type: 'text', text: ACP_EMPTY_CONTENT_MESSAGE }],
    };
  }

  private buildTurnCancelResult(
    turn: PromptTurnState,
    cancelled: boolean
  ): Record<string, unknown> {
    return {
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      cancelled,
      done: turn.done,
      status: turn.status,
      ...(turn.statusMessage ? { statusMessage: turn.statusMessage } : {}),
      ...(turn.error ? { error: turn.error } : {}),
    };
  }

  private completePromptTurn(turnId: string, result: unknown): void {
    const turn = this.promptTurns.get(turnId);
    if (!turn) {
      return;
    }

    const finalContent = extractResultContent(result);
    if (finalContent.length > 0) {
      this.appendPromptTurnContent(turn, finalContent);
    }
    this.finishPromptTurn(turn, 'completed');
  }

  private failPromptTurn(turnId: string, error: unknown): void {
    const turn = this.promptTurns.get(turnId);
    if (!turn) {
      return;
    }

    this.finishPromptTurn(turn, 'failed', error instanceof Error ? error.message : String(error));
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
        `No ACP prompt turn found for turn '${turnId}'. Start a prompt first, or use a valid turnId returned by the gateway.`
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
          `ACP agent '${appId}' stopped before the turn completed.`,
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

  private capturePromptUpdate(sessionId: string, params: unknown): void {
    const content = extractUpdateContent(params);
    const taskStatus = extractTaskStatus(params);
    if (content.length === 0) {
      if (!taskStatus) {
        return;
      }
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

    const turnId = this.activeTurnIdsBySession.get(sessionId);
    if (!turnId) {
      return;
    }

    const turn = this.promptTurns.get(turnId);
    if (!turn) {
      return;
    }

    let changed = false;
    if (content.length > 0) {
      changed = this.appendPromptTurnContent(turn, content) || changed;
    }

    if (taskStatus) {
      turn.status = taskStatus.status;
      turn.statusMessage = taskStatus.message;
      turn.lastTouchedAt = Date.now();
      changed = true;
    }

    if (changed && turn.done) {
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
        changed = true;
        continue;
      }

      changed = appendAccumulatedContentBlock(turn.content, block) || changed;
    }

    if (!changed) {
      return false;
    }

    turn.lastTouchedAt = Date.now();
    return true;
  }

  private finishPromptTurn(
    turn: PromptTurnState,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string,
    advanceQueue = true
  ): void {
    if (turn.done) {
      return;
    }

    turn.done = true;
    turn.status = status;
    turn.error = error;
    turn.lastTouchedAt = Date.now();

    if (this.activeTurnIdsBySession.get(turn.sessionId) === turn.turnId) {
      this.activeTurnIdsBySession.delete(turn.sessionId);
      if (advanceQueue) {
        this.launchNextPromptTurn(turn.sessionId);
      }
    } else {
      this.dequeuePromptTurn(turn.sessionId, turn.turnId);
    }

    this.schedulePromptTurnCleanup(turn);
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

    if (this.activeTurnIdsBySession.get(turn.sessionId) === turn.turnId) {
      this.activeTurnIdsBySession.delete(turn.sessionId);
    } else {
      this.dequeuePromptTurn(turn.sessionId, turn.turnId);
    }

    this.promptTurns.delete(turnId);
  }

  private collectTurnContent(turn: PromptTurnState): AcpContentBlock[] {
    return turn.content.map((block) => ({ ...block }));
  }

  private resolveTurnIdForSessionPoll(sessionId: string): string {
    const activeTurnId = this.activeTurnIdsBySession.get(sessionId);
    if (activeTurnId) {
      return activeTurnId;
    }

    const completedTurns = Array.from(this.promptTurns.values()).filter(
      (turn) => turn.sessionId === sessionId
    );
    if (completedTurns.length === 1) {
      return completedTurns[0].turnId;
    }

    throw new AaiError(
      'INVALID_PARAMS',
      `ACP session '${sessionId}' no longer maps cleanly to a single turn. Use turn/poll with the turnId returned by session/prompt.`
    );
  }
}

function isJsonRpcNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return 'method' in message;
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
    prompt: applyNonInteractivePromptGuidance(prompt),
  };
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
    'ACP session/prompt requires args.prompt (ACP content blocks array)'
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

function applyNonInteractivePromptGuidance(prompt: unknown[]): unknown[] {
  const [first, ...rest] = prompt;

  if (
    first &&
    typeof first === 'object' &&
    (first as { type?: unknown }).type === 'text' &&
    typeof (first as { text?: unknown }).text === 'string'
  ) {
    const firstText = (first as { text: string }).text;
    if (firstText.startsWith(ACP_NON_INTERACTIVE_GUIDANCE)) {
      return prompt;
    }

    return [
      {
        ...(first as Record<string, unknown>),
        text: `${ACP_NON_INTERACTIVE_GUIDANCE}\n\n${firstText}`,
      },
      ...rest,
    ];
  }

  return [{ type: 'text', text: ACP_NON_INTERACTIVE_GUIDANCE }, ...prompt];
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
  const blocks = candidates.flatMap((candidate) => collectContentBlocks(candidate));
  if (blocks.length > 0) {
    return blocks;
  }

  const fragments = Array.from(new Set(candidates.flatMap((candidate) => collectTextFragments(candidate))));
  return fragments.map((text) => ({ type: 'text', text }));
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
