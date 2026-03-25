import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { AaiError } from '../errors/errors.js';
import type {
  AcpAgentConfig,
  AcpExecutorConfig,
  AcpExecutorDetail,
  DetailedCapability,
  ExecutionResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';

import type { ExecutionObserver, ExecutionTaskStatus, TaskCapableExecutor } from './events.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
  timeoutMs?: number;
  method: string;
  sessionId?: string;
}

interface PromptTurnChunk {
  cursor: number;
  text: string;
}

interface PromptTurnState {
  localId: string;
  turnId: string;
  sessionId: string;
  outputText: string;
  chunks: PromptTurnChunk[];
  nextCursor: number;
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
const ACP_NON_INTERACTIVE_GUIDANCE =
  'AAI Gateway instruction: operate in non-interactive mode. Do not ask for human confirmation, approval, or additional input. If confirmation would normally be required, choose the safest non-interactive path available or explain the limitation in your final response instead of waiting.';

/**
 * ACP Executor implementation
 *
 * Implements unified Executor interface for ACP agents.
 */
export class AcpExecutor implements TaskCapableExecutor<
  AcpAgentConfig & AcpExecutorConfig,
  AcpExecutorDetail
> {
  readonly protocol = 'acp-agent';
  private states = new Map<string, ProcessState>();
  private pendingRequests = new Map<string, PendingRequest>();
  private promptTurns = new Map<string, PromptTurnState>();
  private activeTurnIdsBySession = new Map<string, string>();
  private queuedTurnIdsBySession = new Map<string, string[]>();
  private sessionOwners = new Map<string, string>();
  private requestId = 0;
  private sessionIds = new Map<string, string>();

  constructor(private readonly pollWaitMs = ACP_POLL_WAIT_MS) {}

  async connect(localId: string, config: AcpAgentConfig & AcpExecutorConfig): Promise<void> {
    await this.ensureInitialized(localId, config);
  }

  async disconnect(localId: string): Promise<void> {
    this.stop(localId);
  }

  async loadDetail(config: AcpAgentConfig & AcpExecutorConfig): Promise<AcpExecutorDetail> {
    const tempId = `temp-${Date.now()}`;
    const initialize = (await this.ensureInitialized(tempId, config)) as Record<string, unknown>;
    await this.disconnect(tempId);

    return {
      sessionId: undefined,
      capabilities: initialize,
    };
  }

  async execute(
    localId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    return this.executeInternal(localId, config, operation, args);
  }

  async executeWithObserver(
    localId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    operation: string,
    args: Record<string, unknown>,
    _observer: ExecutionObserver
  ): Promise<ExecutionResult> {
    return this.executeInternal(localId, config, operation, args);
  }

  private async executeInternal(
    localId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    try {
      await this.ensureInitialized(localId, config);

      if (operation === 'prompt') {
        return { success: true, data: await this.handlePromptRequest(localId, args) };
      }

      if (operation === 'session/prompt') {
        return { success: true, data: await this.handleSessionPromptRequest(localId, args) };
      }

      if (operation === 'turn/poll') {
        return { success: true, data: await this.handleTurnPollRequest(localId, args) };
      }

      if (operation === 'turn/cancel') {
        return { success: true, data: await this.handleTurnCancelRequest(localId, args) };
      }

      if (operation === 'session/poll') {
        return { success: true, data: await this.handleSessionPollRequest(localId, args) };
      }

      const normalized = await this.normalizeOperation(localId, operation, args);
      const data = await this.sendRequest(
        localId,
        normalized.method,
        normalized.params,
        normalized.timeoutMs
      );
      if (normalized.method === 'session/new') {
        this.captureSessionId(localId, data);
      }
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async health(localId: string): Promise<boolean> {
    const state = this.states.get(localId);
    return !!state?.initialized;
  }

  // Legacy methods for backward compatibility

  async inspect(
    localId: string,
    config: AcpAgentConfig & AcpExecutorConfig
  ): Promise<DetailedCapability> {
    const initialize = (await this.ensureInitialized(localId, config)) as Record<string, unknown>;
    return {
      title: 'ACP Agent Details',
      body: JSON.stringify(initialize, null, 2),
    };
  }

  async executeLegacy(
    localId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    await this.ensureInitialized(localId, config);
    return this.sendRequest(localId, method, params, 0);
  }

  stop(localId: string): void {
    const state = this.states.get(localId);
    if (!state) return;
    state.proc.kill();
    this.states.delete(localId);
    this.sessionIds.delete(localId);
    this.clearPromptTurnsForLocal(localId);
  }

  private async ensureInitialized(
    localId: string,
    config: AcpAgentConfig & AcpExecutorConfig
  ): Promise<unknown> {
    const state = this.states.get(localId);
    if (state?.initialized && state.initializeResult) {
      return state.initializeResult;
    }

    if (state) {
      state.proc.kill();
      this.states.delete(localId);
    }

    logger.info({ localId, command: config.command, args: config.args }, 'ACP initialize started');

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
    this.states.set(localId, nextState);

    proc.stdout?.on('data', (data: Buffer) => {
      this.handleMessage(localId, data.toString());
    });

    proc.stderr?.on('data', (data: Buffer) => {
      logger.debug({ localId, stderr: data.toString().trim() }, 'ACP agent stderr');
    });

    proc.on('exit', () => {
      this.states.delete(localId);
      this.sessionIds.delete(localId);
      this.clearPromptTurnsForLocal(localId);
    });

    const initializeResult = await this.sendRequest(
      localId,
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
    logger.info({ localId }, 'ACP initialize completed');
    return initializeResult;
  }

  private async normalizeOperation(
    _localId: string,
    operation: string,
    args: Record<string, unknown>
  ): Promise<{ method: string; params: Record<string, unknown>; timeoutMs: number }> {
    if (operation === 'session/new') {
      return {
        method: operation,
        params: normalizeSessionNewArgs(args),
        timeoutMs: ACP_SESSION_TIMEOUT_MS,
      };
    }

    return {
      method: operation,
      params: args,
      timeoutMs: 0,
    };
  }

  private async ensureSession(localId: string, args: Record<string, unknown>): Promise<string> {
    const existing = this.sessionIds.get(localId);
    if (existing) {
      logger.debug({ localId, sessionId: existing }, 'ACP session reused');
      return existing;
    }

    logger.info({ localId }, 'ACP session/new started');
    const created = (await this.sendRequest(
      localId,
      'session/new',
      normalizeSessionNewArgs(args),
      ACP_SESSION_TIMEOUT_MS
    )) as { sessionId?: unknown };

    const sessionId =
      typeof created?.sessionId === 'string' && created.sessionId.length > 0
        ? created.sessionId
        : null;

    if (!sessionId) {
      throw new AaiError('INTERNAL_ERROR', 'ACP session/new did not return a sessionId');
    }

    this.sessionIds.set(localId, sessionId);
    this.sessionOwners.set(sessionId, localId);
    logger.info({ localId, sessionId }, 'ACP session/new completed');
    return sessionId;
  }

  private async handlePromptRequest(
    localId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    assertPromptInput(args);
    const sessionId = await this.ensureSession(localId, args);
    return this.startPromptTurn(localId, sessionId, normalizePromptArgs(args, sessionId));
  }

  private async handleSessionPromptRequest(
    localId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    assertPromptInput(args);
    const sessionId =
      typeof args.sessionId === 'string' && args.sessionId.length > 0
        ? args.sessionId
        : await this.ensureSession(localId, args);
    this.sessionIds.set(localId, sessionId);
    this.sessionOwners.set(sessionId, localId);
    return this.startPromptTurn(localId, sessionId, normalizePromptArgs(args, sessionId));
  }

  private async handleSessionPollRequest(
    localId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const sessionId = requireSessionId(args);
    const turnId = this.resolveTurnIdForSessionPoll(sessionId);
    return this.waitForPromptTurn(localId, turnId, extractTurnCursor(args));
  }

  private async handleTurnPollRequest(
    localId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return this.waitForPromptTurn(localId, requireTurnId(args), extractTurnCursor(args));
  }

  private async handleTurnCancelRequest(
    localId: string,
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
      localId,
      'session/cancel',
      { sessionId: turn.sessionId },
      ACP_SESSION_TIMEOUT_MS
    );
    this.finishPromptTurn(turn, 'cancelled', 'ACP turn was cancelled by the caller.');
    return this.buildTurnCancelResult(turn, true);
  }

  private async startPromptTurn(
    localId: string,
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const turnId = randomUUID();
    const turn: PromptTurnState = {
      localId,
      turnId,
      sessionId,
      outputText: '',
      chunks: [],
      nextCursor: 1,
      done: false,
      status: 'queued',
      waiters: new Set(),
      lastTouchedAt: Date.now(),
      params,
      statusMessage: 'Waiting to start.',
    };
    this.promptTurns.set(turnId, turn);
    this.sessionOwners.set(sessionId, localId);

    const activeTurnId = this.activeTurnIdsBySession.get(sessionId);
    if (activeTurnId) {
      const queued = this.queuedTurnIdsBySession.get(sessionId) ?? [];
      queued.push(turnId);
      this.queuedTurnIdsBySession.set(sessionId, queued);
      turn.statusMessage = 'Waiting for an earlier turn on the same session to finish.';
    } else {
      this.launchPromptTurn(turn);
    }

    return this.waitForPromptTurn(localId, turnId);
  }

  private launchPromptTurn(turn: PromptTurnState): void {
    turn.status = 'working';
    turn.statusMessage = 'Turn started.';
    turn.lastTouchedAt = Date.now();
    this.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);

    try {
      const request = this.sendRequest(turn.localId, 'session/prompt', turn.params, 0);
      void request.then(
        (result) => this.completePromptTurn(turn.turnId, result),
        (error) => this.failPromptTurn(turn.turnId, error)
      );
    } catch (error) {
      this.failPromptTurn(turn.turnId, error);
    }
  }

  private waitForPromptTurn(localId: string, turnId: string, cursor = 0): Promise<unknown> {
    const turn = this.getPromptTurn(turnId);
    turn.lastTouchedAt = Date.now();
    if (turn.done) {
      return Promise.resolve(this.buildPromptTurnResult(localId, turn, cursor, false));
    }

    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        turn.waiters.delete(wake);
        const nextTurn = this.getPromptTurn(turnId);
        nextTurn.lastTouchedAt = Date.now();
        resolve(this.buildPromptTurnResult(localId, nextTurn, cursor, false));
      };

      const timer = setTimeout(() => {
        turn.waiters.delete(wake);
        const nextTurn = this.getPromptTurn(turnId);
        nextTurn.lastTouchedAt = Date.now();
        resolve(this.buildPromptTurnResult(localId, nextTurn, cursor, true));
      }, this.pollWaitMs);

      turn.waiters.add(wake);
    });
  }

  private buildPromptTurnResult(
    localId: string,
    turn: PromptTurnState,
    cursor: number,
    timedOut: boolean
  ): Record<string, unknown> {
    const { deltaText, cursor: nextCursor } = this.collectTurnDelta(turn, cursor);

    const nextAction = turn.done
      ? undefined
      : `Call aai:exec with { app: "${localId}", tool: "turn/poll", args: { turnId: "${turn.turnId}", cursor: ${nextCursor} } } to fetch the next increment after waiting up to ${this.pollWaitMs}ms.`;

    return {
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      cursor: nextCursor,
      done: turn.done,
      status: turn.status,
      ...(turn.statusMessage ? { statusMessage: turn.statusMessage } : {}),
      deltaText,
      outputText: buildPromptOutputText(
        localId,
        turn.turnId,
        deltaText,
        turn.status,
        turn.done,
        timedOut,
        turn.error,
        nextCursor,
        this.pollWaitMs
      ),
      ...(turn.error ? { error: turn.error } : {}),
      ...(nextAction
        ? {
            pollTool: 'turn/poll',
            pollArgs: { turnId: turn.turnId, cursor: nextCursor },
            nextAction,
          }
        : {}),
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

    const finalText = extractResultText(result);
    if (finalText) {
      this.appendPromptTurnText(turn, finalText);
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

  private clearPromptTurnsForLocal(localId: string): void {
    for (const turn of Array.from(this.promptTurns.values())) {
      if (turn.localId !== localId) {
        continue;
      }

      if (!turn.done) {
        this.finishPromptTurn(
          turn,
          'cancelled',
          `ACP agent '${localId}' stopped before the turn completed.`,
          false
        );
      }

      this.removePromptTurn(turn.turnId);
    }

    for (const [sessionId, owner] of Array.from(this.sessionOwners.entries())) {
      if (owner === localId) {
        this.sessionOwners.delete(sessionId);
      }
    }
  }

  private captureSessionId(localId: string, data: unknown): void {
    if (!data || typeof data !== 'object') {
      return;
    }

    const sessionId = (data as { sessionId?: unknown }).sessionId;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      this.sessionIds.set(localId, sessionId);
      this.sessionOwners.set(sessionId, localId);
    }
  }

  private sendRequest(
    localId: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    const state = this.states.get(localId);
    if (!state?.proc.stdin) {
      throw new AaiError('SERVICE_UNAVAILABLE', `ACP agent '${localId}' is not running`);
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
        localId,
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
              logger.error({ localId, method, timeoutMs }, 'ACP request timed out');
              reject(new AaiError('TIMEOUT', `${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs)
          : undefined;
      this.pendingRequests.set(String(id), {
        resolve: (value) => {
          logger.info({ localId, method }, 'ACP request completed');
          resolve(value);
        },
        reject: (error) => {
          logger.error({ localId, method, error }, 'ACP request failed');
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

  private handleMessage(localId: string, data: string): void {
    const state = this.states.get(localId);
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
        logger.warn({ localId, line: trimmed, err }, 'Failed to parse ACP message');
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
    const text = extractUpdateText(params);
    const taskStatus = extractTaskStatus(params);
    if (!text) {
      if (!taskStatus) {
        return;
      }
    }

    logger.debug(
      {
        sessionId,
        hasText: Boolean(text),
        textLength: text?.length,
        textPreview: text ? truncateLogPreview(text) : undefined,
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
    if (text) {
      changed = this.appendPromptTurnText(turn, text) || changed;
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

  private appendPromptTurnText(turn: PromptTurnState, incoming: string): boolean {
    const merged = mergePromptText(turn.outputText, incoming);
    if (merged.mergedText === turn.outputText || merged.deltaText.length === 0) {
      return false;
    }

    turn.outputText = merged.mergedText;
    turn.chunks.push({ cursor: turn.nextCursor, text: merged.deltaText });
    turn.nextCursor += 1;
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

  private collectTurnDelta(
    turn: PromptTurnState,
    cursor: number
  ): { deltaText: string; cursor: number } {
    const nextChunks = turn.chunks.filter((chunk) => chunk.cursor > cursor);
    const nextCursor = nextChunks.length > 0 ? nextChunks[nextChunks.length - 1].cursor : cursor;
    return {
      deltaText: nextChunks.map((chunk) => chunk.text).join(''),
      cursor: nextCursor,
    };
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
      `ACP session '${sessionId}' no longer maps cleanly to a single turn. Use turn/poll with the turnId returned by prompt or session/prompt.`
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

function extractUpdateText(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return null;
  }

  const update = (params as { update?: unknown }).update;
  if (!update || typeof update !== 'object') {
    return null;
  }

  const sessionUpdate = (update as { sessionUpdate?: unknown }).sessionUpdate;
  if (
    sessionUpdate === 'available_commands_update' ||
    sessionUpdate === 'usage_update' ||
    sessionUpdate === 'session_title_update'
  ) {
    return null;
  }

  const candidates = [
    update,
    (update as { content?: unknown }).content,
    (update as { output?: unknown }).output,
    (update as { delta?: unknown }).delta,
    (update as { response?: unknown }).response,
  ];

  const fragments = Array.from(
    new Set(candidates.flatMap((candidate) => collectTextFragments(candidate)))
  );
  return fragments.length > 0 ? fragments.join('') : null;
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
  return {
    cwd: typeof args.cwd === 'string' && args.cwd.length > 0 ? args.cwd : process.cwd(),
    mcpServers: Array.isArray(args.mcpServers) ? args.mcpServers : [],
    ...(typeof args.title === 'string' ? { title: args.title } : {}),
  };
}

function normalizePromptArgs(
  args: Record<string, unknown>,
  sessionId: string
): Record<string, unknown> {
  const rawPrompt = args.prompt;
  const text =
    typeof args.text === 'string'
      ? args.text
      : typeof args.message === 'string'
        ? args.message
        : undefined;

  const prompt =
    Array.isArray(rawPrompt) && rawPrompt.length > 0
      ? rawPrompt
      : text
        ? [{ type: 'text', text }]
        : undefined;

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
  const hasText = typeof args.text === 'string' && args.text.length > 0;
  const hasMessage = typeof args.message === 'string' && args.message.length > 0;

  if (!hasPromptBlocks && !hasText && !hasMessage) {
    throw createMissingPromptError();
  }
}

function createMissingPromptError(): AaiError {
  return new AaiError(
    'INVALID_PARAMS',
    'ACP prompt requires args.prompt (content blocks) or args.text / args.message'
  );
}

function requireSessionId(args: Record<string, unknown>): string {
  const sessionId = args.sessionId;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return sessionId;
  }

  throw new AaiError('INVALID_PARAMS', 'ACP polling requires args.sessionId');
}

function requireTurnId(args: Record<string, unknown>): string {
  const turnId = args.turnId;
  if (typeof turnId === 'string' && turnId.length > 0) {
    return turnId;
  }

  throw new AaiError('INVALID_PARAMS', 'ACP turn polling requires args.turnId');
}

function extractTurnCursor(args: Record<string, unknown>): number {
  const cursor = args.cursor;
  if (cursor === undefined) {
    return 0;
  }

  if (typeof cursor === 'number' && Number.isInteger(cursor) && cursor >= 0) {
    return cursor;
  }

  throw new AaiError(
    'INVALID_PARAMS',
    'ACP turn polling requires args.cursor to be a non-negative integer when provided'
  );
}

function extractResultText(result: unknown): string | null {
  const fragments = Array.from(new Set(collectTextFragments(result)));
  return fragments.length > 0 ? fragments.join('') : null;
}

function buildPromptOutputText(
  localId: string,
  turnId: string,
  deltaText: string,
  status: ExecutionTaskStatus,
  done: boolean,
  timedOut: boolean,
  error: string | undefined,
  cursor: number,
  pollWaitMs: number
): string {
  if (error) {
    return deltaText.length > 0
      ? `${deltaText}\n\n[AAI Gateway] ACP turn failed: ${error}`
      : `[AAI Gateway] ACP turn failed: ${error}`;
  }

  if (done) {
    return deltaText.length > 0 ? deltaText : 'ACP turn completed. No additional text.';
  }

  const pollInstruction = `Call aai:exec with { app: "${localId}", tool: "turn/poll", args: { turnId: "${turnId}", cursor: ${cursor} } } to fetch the next increment.`;
  const statusText =
    status === 'queued'
      ? `The downstream ACP turn is still queued. Wait up to ${pollWaitMs}ms before polling again.`
      : timedOut
        ? `The downstream ACP agent is still running after waiting ${pollWaitMs}ms.`
        : 'The downstream ACP agent has more output pending.';

  return deltaText.length > 0
    ? `${deltaText}\n\n[AAI Gateway] ${statusText} ${pollInstruction}`
    : `[AAI Gateway] ${statusText} ${pollInstruction}`;
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

function truncatePromptText(text: string): string {
  if (text.length <= ACP_MAX_OUTPUT_CHARS) {
    return text;
  }

  return text.slice(0, ACP_MAX_OUTPUT_CHARS);
}

function truncateLogPreview(text: string, maxChars = 160): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`;
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
