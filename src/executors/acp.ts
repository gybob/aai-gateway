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

import type { ExecutionObserver, TaskCapableExecutor } from './events.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  timeoutMs: number;
  method: string;
  sessionId?: string;
  updates: string[];
  observer?: ExecutionObserver;
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
const ACP_REQUEST_TIMEOUT_MS = 600000;
const ACP_SESSION_TIMEOUT_MS = 30000;

/**
 * ACP Executor implementation
 *
 * Implements unified Executor interface for ACP agents.
 */
export class AcpExecutor
  implements TaskCapableExecutor<AcpAgentConfig & AcpExecutorConfig, AcpExecutorDetail>
{
  readonly protocol = 'acp-agent';
  private states = new Map<string, ProcessState>();
  private pendingRequests = new Map<string, PendingRequest>();
  private requestId = 0;
  private sessionIds = new Map<string, string>();

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
    observer: ExecutionObserver
  ): Promise<ExecutionResult> {
    return this.executeInternal(localId, config, operation, args, observer);
  }

  private async executeInternal(
    localId: string,
    config: AcpAgentConfig & AcpExecutorConfig,
    operation: string,
    args: Record<string, unknown>,
    observer?: ExecutionObserver
  ): Promise<ExecutionResult> {
    try {
      await this.ensureInitialized(localId, config);
      const normalized = await this.normalizeOperation(localId, operation, args);
      const data = await this.sendRequest(
        localId,
        normalized.method,
        normalized.params,
        normalized.timeoutMs,
        observer
      );
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

  async inspect(localId: string, config: AcpAgentConfig & AcpExecutorConfig): Promise<DetailedCapability> {
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
    return this.sendRequest(localId, method, params, ACP_REQUEST_TIMEOUT_MS);
  }

  stop(localId: string): void {
    const state = this.states.get(localId);
    if (!state) return;
    state.proc.kill();
    this.states.delete(localId);
    this.sessionIds.delete(localId);
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
          name: 'aai-gateway',
          title: 'AAI Gateway',
          version: '0.4.0',
        },
      },
      ACP_INITIALIZE_TIMEOUT_MS
    );

    nextState.initialized = true;
    nextState.initializeResult = initializeResult as Record<string, unknown>;
    return initializeResult;
  }

  private async normalizeOperation(
    localId: string,
    operation: string,
    args: Record<string, unknown>
  ): Promise<{ method: string; params: Record<string, unknown>; timeoutMs: number }> {
    if (operation === 'prompt') {
      assertPromptInput(args);
      const sessionId = await this.ensureSession(localId, args);
      return {
        method: 'session/prompt',
        params: normalizePromptArgs(args, sessionId),
        timeoutMs: ACP_REQUEST_TIMEOUT_MS,
      };
    }

    if (operation === 'session/new') {
      return {
        method: operation,
        params: normalizeSessionNewArgs(args),
        timeoutMs: ACP_SESSION_TIMEOUT_MS,
      };
    }

    if (operation === 'session/prompt') {
      assertPromptInput(args);
      const sessionId =
        typeof args.sessionId === 'string' && args.sessionId.length > 0
          ? args.sessionId
          : await this.ensureSession(localId, args);
      return {
        method: operation,
        params: normalizePromptArgs(args, sessionId),
        timeoutMs: ACP_REQUEST_TIMEOUT_MS,
      };
    }

    return {
      method: operation,
      params: args,
      timeoutMs: ACP_REQUEST_TIMEOUT_MS,
    };
  }

  private async ensureSession(localId: string, args: Record<string, unknown>): Promise<string> {
    const existing = this.sessionIds.get(localId);
    if (existing) {
      return existing;
    }

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
    return sessionId;
  }

  private sendRequest(
    localId: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    observer?: ExecutionObserver
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

    return new Promise((resolve, reject) => {
      const createTimer = () =>
        setTimeout(() => {
          this.pendingRequests.delete(String(id));
          reject(new AaiError('TIMEOUT', `${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

      const timer = createTimer();
      this.pendingRequests.set(String(id), {
        resolve,
        reject,
        timer,
        timeoutMs,
        method,
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
        updates: [],
        observer,
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

      clearTimeout(pending.timer);
      this.pendingRequests.delete(String(message.id));

      if (message.error) {
        pending.reject(new AaiError('INTERNAL_ERROR', message.error.message, message.error.data as object));
      } else {
        pending.resolve(mergePromptUpdates(message.result, pending));
      }
      return;
    }

    if (isJsonRpcNotification(message) && message.method === 'session/update') {
      const sessionId = extractSessionId(message.params);
      if (sessionId) {
        this.capturePromptUpdate(sessionId, message.params);
        this.refreshPendingPromptTimeouts(sessionId);
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

    for (const pending of this.pendingRequests.values()) {
      if (pending.method !== 'session/prompt' || pending.sessionId !== sessionId) {
        continue;
      }

      if (text) {
        pending.updates.push(text);
        void pending.observer?.onMessage?.({ message: text });
        void pending.observer?.onProgress?.({ message: text });
      }

      if (taskStatus) {
        void pending.observer?.onTaskStatus?.({
          status: taskStatus.status,
          ...(taskStatus.message ? { message: taskStatus.message } : {}),
        });
      }
    }
  }

  private refreshPendingPromptTimeouts(sessionId: string): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.method !== 'session/prompt') {
        continue;
      }

      if (pending.sessionId !== sessionId) {
        continue;
      }

      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => {
        this.pendingRequests.forEach((value, key) => {
          if (value === pending) {
            this.pendingRequests.delete(key);
          }
        });
        pending.reject(
          new AaiError('TIMEOUT', `${pending.method} timed out after ${pending.timeoutMs}ms`)
        );
      }, pending.timeoutMs);
    }
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

  const content = (update as { content?: unknown }).content;
  if (!content || typeof content !== 'object') {
    return null;
  }

  const type = (content as { type?: unknown }).type;
  const text = (content as { text?: unknown }).text;
  return type === 'text' && typeof text === 'string' && text.length > 0 ? text : null;
}

function extractTaskStatus(
  params: unknown
): { status: 'queued' | 'working' | 'completed' | 'failed' | 'cancelled'; message?: string } | null {
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

function mergePromptUpdates(result: unknown, pending: PendingRequest): unknown {
  if (pending.method !== 'session/prompt' || pending.updates.length === 0) {
    return result;
  }

  const outputText = pending.updates.join('');
  if (result && typeof result === 'object') {
    return {
      ...result,
      outputText,
    };
  }

  return {
    result,
    outputText,
  };
}

function normalizeSessionNewArgs(args: Record<string, unknown>): Record<string, unknown> {
  return {
    cwd:
      typeof args.cwd === 'string' && args.cwd.length > 0 ? args.cwd : process.cwd(),
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
    prompt,
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

let singleton: AcpExecutor | undefined;

export function getAcpExecutor(): AcpExecutor {
  if (!singleton) {
    singleton = new AcpExecutor();
  }
  return singleton;
}
