import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';

import { AaiError } from '../errors/errors.js';
import type { Runtime, ToolDef } from '../aai/types.js';

export class IpcExecutor {
  async executeTool(runtime: Runtime, tool: ToolDef, args: Record<string, unknown>): Promise<unknown> {
    if (runtime.kind !== 'ipc') {
      throw new AaiError('INVALID_REQUEST', `IpcExecutor requires ipc runtime, got '${runtime.kind}'`);
    }

    if (!tool.binding || tool.binding.type !== 'ipc') {
      throw new AaiError('INVALID_REQUEST', `Tool '${tool.name}' is not bound to an IPC operation`);
    }

    switch (runtime.transport.type) {
      case 'unix-socket':
      case 'named-pipe':
        return this.executeSocketRequest(runtime, tool.binding.operation, args);
      case 'apple-events':
      case 'dbus':
      case 'com':
        throw new AaiError(
          'NOT_IMPLEMENTED',
          `Transport '${runtime.transport.type}' requires a platform adapter that is not implemented in this build`,
        );
      default:
        throw new AaiError(
          'INVALID_REQUEST',
          `IpcExecutor does not support transport '${runtime.transport.type}'`,
        );
    }
  }

  private async executeSocketRequest(
    runtime: Runtime,
    operation: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const transport = runtime.transport;
    if (transport.type !== 'unix-socket' && transport.type !== 'named-pipe') {
      throw new AaiError('INVALID_REQUEST', `IPC socket execution requires a path-based transport`);
    }

    const path = transport.path;
    const timeoutMs = readTimeout(runtime);
    const requestId = randomUUID();
    const payload = buildPayload(runtime, requestId, operation, args);

    return new Promise<unknown>((resolve, reject) => {
      const socket = createConnection(path);
      let buffer = '';
      let settled = false;

      const settle = (handler: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        handler();
      };

      socket.setTimeout(timeoutMs, () => {
        settle(() => reject(new AaiError('TIMEOUT', `IPC request timed out after ${timeoutMs}ms`)));
      });

      socket.once('connect', () => {
        socket.write(`${JSON.stringify(payload)}\n`);
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');

        while (buffer.includes('\n')) {
          const newlineIndex = buffer.indexOf('\n');
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) {
            continue;
          }

          let message: unknown;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }

          if (!matchesResponse(runtime, requestId, message)) {
            continue;
          }

          settle(() => {
            try {
              resolve(readResponse(runtime, message));
            } catch (error) {
              reject(error);
            }
          });
          return;
        }
      });

      socket.once('error', (error) => {
        settle(() => reject(new AaiError('EXECUTION_ERROR', `IPC transport failure: ${(error as Error).message}`)));
      });

      socket.once('end', () => {
        if (settled) {
          return;
        }

        settle(() =>
          reject(
            new AaiError(
              'EXECUTION_ERROR',
              'IPC connection closed before a complete response was received',
            ),
          ),
        );
      });
    });
  }
}

function buildPayload(
  runtime: Runtime,
  requestId: string,
  operation: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (runtime.protocol === 'jsonrpc') {
    return {
      jsonrpc: '2.0',
      id: requestId,
      method: operation,
      params: args,
    };
  }

  return {
    id: requestId,
    operation,
    arguments: args,
  };
}

function matchesResponse(runtime: Runtime, requestId: string, message: unknown): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  if (runtime.protocol === 'jsonrpc') {
    return candidate.id === requestId;
  }

  return candidate.id === requestId || candidate.id === undefined;
}

function readResponse(runtime: Runtime, message: unknown): unknown {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return message;
  }

  const candidate = message as Record<string, unknown>;
  const error = candidate.error;
  if (error) {
    if (typeof error === 'string') {
      throw new AaiError('EXECUTION_ERROR', error);
    }

    if (typeof error === 'object') {
      const errorObject = error as Record<string, unknown>;
      const messageText =
        typeof errorObject.message === 'string'
          ? errorObject.message
          : `IPC ${runtime.protocol === 'jsonrpc' ? 'JSON-RPC' : 'operation'} failed`;
      throw new AaiError('EXECUTION_ERROR', messageText, errorObject);
    }

    throw new AaiError('EXECUTION_ERROR', 'IPC request failed');
  }

  if ('result' in candidate) {
    return candidate.result;
  }

  if ('data' in candidate) {
    return candidate.data;
  }

  return candidate;
}

function readTimeout(runtime: Runtime): number {
  const timeoutMs = runtime._meta?.ipcTimeoutMs;
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  return 30_000;
}
