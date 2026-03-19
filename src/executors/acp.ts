import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { AaiError } from '../errors/errors.js';
import type { AcpAgentConfig, DetailedCapability } from '../types/aai-json.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
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

export class AcpExecutor {
  private states = new Map<string, ProcessState>();
  private pendingRequests = new Map<string, PendingRequest>();
  private requestId = 0;

  async inspect(localId: string, config: AcpAgentConfig): Promise<DetailedCapability> {
    const initialize = (await this.ensureInitialized(localId, config)) as Record<string, unknown>;
    return {
      title: 'ACP Agent Details',
      body: JSON.stringify(initialize, null, 2),
    };
  }

  async execute(
    localId: string,
    config: AcpAgentConfig,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    await this.ensureInitialized(localId, config);
    return this.sendRequest(localId, method, params, 120000);
  }

  stop(localId: string): void {
    const state = this.states.get(localId);
    if (!state) return;
    state.proc.kill();
    this.states.delete(localId);
  }

  private async ensureInitialized(localId: string, config: AcpAgentConfig): Promise<unknown> {
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
      15000
    );

    nextState.initialized = true;
    nextState.initializeResult = initializeResult as Record<string, unknown>;
    return initializeResult;
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

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        reject(new AaiError('TIMEOUT', `${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(String(id), { resolve, reject, timer });
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
        pending.resolve(message.result);
      }
    }
  }
}

let singleton: AcpExecutor | undefined;

export function getAcpExecutor(): AcpExecutor {
  if (!singleton) {
    singleton = new AcpExecutor();
  }
  return singleton;
}
