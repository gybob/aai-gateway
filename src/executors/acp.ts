import { spawn, ChildProcess } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { AaiError } from '../errors/errors.js';
import type { AaiJson, AcpExecution } from '../types/aai-json.js';

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

/**
 * ACP Executor
 *
 * Executes ACP protocol methods via stdio-based JSON-RPC.
 * Manages agent process lifecycle and message routing.
 */
export class AcpExecutor {
  private processes = new Map<string, ChildProcess>();
  private messageBuffers = new Map<string, string>();
  private pendingRequests = new Map<string, PendingRequest>();
  private requestId = 0;
  private initializedAgents = new Set<string>();

  private getAcpExecution(descriptor: AaiJson): AcpExecution {
    if (descriptor.execution.type !== 'acp') {
      throw new AaiError('INTERNAL_ERROR', 'Descriptor is not an ACP agent');
    }
    return descriptor.execution;
  }

  /**
   * Execute an ACP method on an agent
   */
  async execute(
    descriptor: AaiJson,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const appId = descriptor.app.id;

    // Ensure process is running and initialized
    await this.ensureProcess(descriptor);

    // Send JSON-RPC request
    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0' as const,
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const proc = this.processes.get(appId);
      if (!proc || !proc.stdin) {
        reject(new AaiError('SERVICE_UNAVAILABLE', `Agent ${appId} process not running`));
        return;
      }

      // Set up timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        reject(new AaiError('TIMEOUT', `Request ${method} timed out after 120s`));
      }, 120000);

      this.pendingRequests.set(String(id), { resolve, reject, timer });

      const message = JSON.stringify(request) + '\n';
      logger.debug({ appId, method, id }, 'Sending ACP request');
      proc.stdin.write(message);
    });
  }

  /**
   * Ensure agent process is running and initialized
   */
  private async ensureProcess(descriptor: AaiJson): Promise<void> {
    const appId = descriptor.app.id;
    const execution = this.getAcpExecution(descriptor);

    if (this.processes.has(appId) && this.initializedAgents.has(appId)) {
      return;
    }

    // Kill existing process if any
    if (this.processes.has(appId)) {
      const proc = this.processes.get(appId);
      proc?.kill();
      this.processes.delete(appId);
      this.messageBuffers.delete(appId);
      this.initializedAgents.delete(appId);
    }

    return new Promise((resolve, reject) => {
      logger.info({ appId, command: execution.start.command }, 'Starting ACP agent');

      const proc = spawn(execution.start.command, execution.start.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...execution.start.env },
      });

      this.processes.set(appId, proc);
      this.messageBuffers.set(appId, '');

      // Handle stdout (JSON-RPC responses)
      proc.stdout?.on('data', (data: Buffer) => {
        this.handleMessage(appId, data.toString());
      });

      // Handle stderr (logs)
      proc.stderr?.on('data', (data: Buffer) => {
        logger.debug({ appId, stderr: data.toString().trim() }, 'Agent stderr');
      });

      // Handle process exit
      proc.on('exit', (code, signal) => {
        logger.info({ appId, code, signal }, 'ACP agent exited');
        this.processes.delete(appId);
        this.messageBuffers.delete(appId);
        this.initializedAgents.delete(appId);
      });

      proc.on('error', (err) => {
        logger.error({ appId, err }, 'ACP agent error');
        this.processes.delete(appId);
        this.messageBuffers.delete(appId);
        this.initializedAgents.delete(appId);
        reject(new AaiError('SERVICE_UNAVAILABLE', `Failed to start agent: ${err.message}`));
      });

      // Send initialize request
      this.sendInitialize(appId, proc)
        .then(() => {
          this.initializedAgents.add(appId);
          resolve();
        })
        .catch(reject);
    });
  }

  /**
   * Send initialize handshake
   */
  private sendInitialize(appId: string, proc: ChildProcess): Promise<void> {
    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0' as const,
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2026-03-09',
        capabilities: {},
        clientInfo: {
          name: 'aai-gateway',
          version: '0.4.0',
        },
      },
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        reject(new AaiError('TIMEOUT', `Agent ${appId} initialization timed out`));
      }, 10000);

      this.pendingRequests.set(String(id), {
        resolve: () => resolve(),
        reject,
        timer,
      });

      proc.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Handle incoming JSON-RPC messages
   */
  private handleMessage(appId: string, data: string): void {
    const buffer = this.messageBuffers.get(appId) ?? '';
    const newBuffer = buffer + data;

    // Split by newlines - each line is a complete JSON-RPC message
    const lines = newBuffer.split('\n');
    // Keep the last incomplete line in buffer
    this.messageBuffers.set(appId, lines.pop() ?? '');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message: JsonRpcMessage = JSON.parse(line);
        this.dispatchMessage(appId, message);
      } catch (err) {
        logger.warn({ appId, line, err }, 'Failed to parse ACP message');
      }
    }
  }

  /**
   * Dispatch message to appropriate handler
   */
  private dispatchMessage(appId: string, message: JsonRpcMessage): void {
    // Response to a request
    if ('id' in message && !('method' in message)) {
      const pending = this.pendingRequests.get(String(message.id));
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(String(message.id));

        if ('error' in message && message.error) {
          pending.reject(
            new AaiError('INTERNAL_ERROR', message.error.message, { errorData: message.error.data })
          );
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Notification (no id, or id but also has method)
    if ('method' in message && !('id' in message)) {
      logger.debug({ appId, method: message.method, params: message.params }, 'ACP notification');
      // TODO: Handle session/update notifications for streaming responses
    }
  }

  /**
   * Stop a specific agent process
   */
  stop(appId: string): void {
    const proc = this.processes.get(appId);
    if (proc) {
      logger.info({ appId }, 'Stopping ACP agent');
      proc.kill();
      this.processes.delete(appId);
      this.messageBuffers.delete(appId);
      this.initializedAgents.delete(appId);
    }
  }

  /**
   * Stop all agent processes
   */
  stopAll(): void {
    for (const appId of this.processes.keys()) {
      this.stop(appId);
    }
  }
}

// Singleton instance
let executorInstance: AcpExecutor | null = null;

/**
 * Get the ACP executor singleton
 */
export function getAcpExecutor(): AcpExecutor {
  if (!executorInstance) {
    executorInstance = new AcpExecutor();
  }
  return executorInstance;
}
