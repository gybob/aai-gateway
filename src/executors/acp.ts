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
  timer?: NodeJS.Timeout;
  timeoutMs?: number;
  method: string;
  sessionId?: string;
  outputText: string;
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
const ACP_SESSION_TIMEOUT_MS = 30000;
const ACP_MAX_OUTPUT_CHARS = 200_000;
const ACP_NON_INTERACTIVE_GUIDANCE =
  'AAI Gateway instruction: operate in non-interactive mode. Do not ask for human confirmation, approval, or additional input. If confirmation would normally be required, choose the safest non-interactive path available or explain the limitation in your final response instead of waiting.';

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
    return this.sendRequest(localId, method, params, 0);
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
          version: '0.4.1',
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
        timeoutMs: 0,
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
        timeoutMs: 0,
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
    logger.info({ localId, sessionId }, 'ACP session/new completed');
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
        outputText: '',
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

      if (pending.timer) {
        clearTimeout(pending.timer);
      }
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

    for (const pending of this.pendingRequests.values()) {
      if (pending.method !== 'session/prompt' || pending.sessionId !== sessionId) {
        continue;
      }

      if (text) {
        pending.outputText = mergePromptText(pending.outputText, text);
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

      if (!pending.timeoutMs) {
        continue;
      }

      if (pending.timer) {
        clearTimeout(pending.timer);
      }
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

  const fragments = Array.from(new Set(candidates.flatMap((candidate) => collectTextFragments(candidate))));
  return fragments.length > 0 ? fragments.join('') : null;
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
  if (pending.method !== 'session/prompt') {
    return result;
  }

  const finalText = extractResultText(result);
  const outputText = finalText ? mergePromptText(pending.outputText, finalText) : pending.outputText;
  if (!outputText) {
    return result;
  }

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

function extractResultText(result: unknown): string | null {
  const fragments = Array.from(new Set(collectTextFragments(result)));
  return fragments.length > 0 ? fragments.join('') : null;
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

function mergePromptText(current: string, incoming: string): string {
  if (!incoming) {
    return current;
  }

  if (!current) {
    return truncatePromptText(incoming);
  }

  if (incoming === current || current.endsWith(incoming)) {
    return current;
  }

  if (incoming.startsWith(current)) {
    return truncatePromptText(incoming);
  }

  return truncatePromptText(current + incoming);
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
