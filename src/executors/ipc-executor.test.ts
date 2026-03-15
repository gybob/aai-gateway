import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Runtime, ToolDef } from '../aai/types.js';

class MockSocket extends EventEmitter {
  setTimeout = vi.fn((_timeout: number, handler?: () => void) => {
    if (handler) {
      this.once('__timeout__', handler);
    }
    return this;
  });

  write = vi.fn((payload: string) => {
    const request = JSON.parse(payload.trim()) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };

    queueMicrotask(() => {
      this.emit(
        'data',
        Buffer.from(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              ok: true,
              method: request.method,
              params: request.params,
            },
          })}\n`,
        ),
      );
    });

    return true;
  });

  destroy = vi.fn();
}

const createConnection = vi.fn(() => {
  const socket = new MockSocket();
  queueMicrotask(() => socket.emit('connect'));
  return socket;
});

vi.mock('node:net', () => ({
  createConnection,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('IpcExecutor', () => {
  it('executes JSON-RPC over socket-style IPC transports', async () => {
    const { IpcExecutor } = await import('./ipc-executor.js');
    const executor = new IpcExecutor();
    const runtime: Runtime = {
      id: 'ipc-runtime',
      kind: 'ipc',
      protocol: 'jsonrpc',
      transport:
        process.platform === 'win32'
          ? { type: 'named-pipe', path: '\\\\.\\pipe\\demo-ipc' }
          : { type: 'unix-socket', path: '/tmp/demo-ipc.sock' },
    };
    const tool: ToolDef = {
      name: 'openDocument',
      inputSchema: { type: 'object', properties: {} },
      binding: {
        type: 'ipc',
        operation: 'documents/open',
      },
    };

    const result = await executor.executeTool(runtime, tool, { path: '/tmp/demo.txt' });

    expect(createConnection).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      method: 'documents/open',
      params: {
        path: '/tmp/demo.txt',
      },
    });
  });
});
