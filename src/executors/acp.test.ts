import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { AcpExecutor, getAcpExecutor } from './acp.js';

const mockSpawn = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };

  proc.stdin = { write: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe('AcpExecutor', () => {
  let executor: AcpExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new AcpExecutor();
  });

  it('returns a singleton from getAcpExecutor', () => {
    expect(getAcpExecutor()).toBe(getAcpExecutor());
  });

  it('starts a process and resolves initialize during inspect', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const inspectPromise = executor.inspect('acp-test', {
      command: 'opencode',
      args: ['acp'],
    });

    expect(proc.stdin.write).toHaveBeenCalledTimes(1);
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: 1,
            agentInfo: { name: 'OpenCode' },
          },
        })}\n`
      )
    );

    const detail = await inspectPromise;
    expect(detail.title).toBe('ACP Agent Details');
    expect(detail.body).toContain('OpenCode');
  });

  it('stops a running process by local id', () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = executor.inspect('acp-test', {
      command: 'opencode',
      args: ['acp'],
    });
    proc.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } })}\n`)
    );

    return promise.then(() => {
      executor.stop('acp-test');
      expect(proc.kill).toHaveBeenCalled();
    });
  });
});
