import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AcpExecutor', () => {
  let executor: AcpExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new AcpExecutor();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('normalizes prompt shorthand by auto-creating a session', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const executionPromise = executor.execute(
      'acp-codex',
      {
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      },
      'prompt',
      {
        text: 'Reply with ACP_OK',
      }
    );

    expect(proc.stdin.write).toHaveBeenCalledTimes(1);

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: 1, agentInfo: { name: 'Codex' } },
        })}\n`
      )
    );

    await flushMicrotasks();
    expect(proc.stdin.write).toHaveBeenCalledTimes(2);
    const sessionNewPayload = JSON.parse(proc.stdin.write.mock.calls[1][0].trim());
    expect(sessionNewPayload.method).toBe('session/new');
    expect(sessionNewPayload.params.cwd).toBe(process.cwd());
    expect(sessionNewPayload.params.mcpServers).toEqual([]);

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { sessionId: 'session-123' },
        })}\n`
      )
    );

    await flushMicrotasks();
    expect(proc.stdin.write).toHaveBeenCalledTimes(3);
    const promptPayload = JSON.parse(proc.stdin.write.mock.calls[2][0].trim());
    expect(promptPayload.method).toBe('session/prompt');
    expect(promptPayload.params.sessionId).toBe('session-123');
    expect(promptPayload.params.prompt).toEqual([{ type: 'text', text: 'Reply with ACP_OK' }]);
    expect(typeof promptPayload.params.messageId).toBe('string');

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          result: { stopReason: 'end_turn' },
        })}\n`
      )
    );

    await expect(executionPromise).resolves.toEqual({
      success: true,
      data: { stopReason: 'end_turn' },
    });
  });

  it('returns an invalid params error when prompt input is missing', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const executionPromise = executor.execute(
      'acp-codex',
      {
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      },
      'prompt',
      {}
    );

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: 1, agentInfo: { name: 'Codex' } },
        })}\n`
      )
    );

    await expect(executionPromise).resolves.toEqual({
      success: false,
      error: 'ACP prompt requires args.prompt (content blocks) or args.text / args.message',
    });
  });

  it('extends session/prompt timeout when session updates arrive', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const requestPromise = executor.executeLegacy(
      'acp-codex',
      {
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      },
      'session/prompt',
      {
        sessionId: 'session-123',
        prompt: [{ type: 'text', text: 'Investigate the repository' }],
      }
    );

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: 1, agentInfo: { name: 'Codex' } },
        })}\n`
      )
    );

    await flushMicrotasks();
    expect(proc.stdin.write).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(590000);
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'session-123',
            update: { content: { type: 'text', text: 'Working...' } },
          },
        })}\n`
      )
    );

    await vi.advanceTimersByTimeAsync(590000);
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { stopReason: 'end_turn' },
        })}\n`
      )
    );

    await expect(requestPromise).resolves.toEqual({
      stopReason: 'end_turn',
      outputText: 'Working...',
    });
  });

  it('does not create a timeout timer for session/prompt requests', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const executionPromise = executor.execute(
      'acp-codex',
      {
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      },
      'session/prompt',
      {
        sessionId: 'session-123',
        prompt: [{ type: 'text', text: 'Long running task' }],
      }
    );

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: 1, agentInfo: { name: 'Codex' } },
        })}\n`
      )
    );

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { stopReason: 'end_turn' },
        })}\n`
      )
    );

    await expect(executionPromise).resolves.toEqual({
      success: true,
      data: { stopReason: 'end_turn' },
    });
  });

  it('forwards session updates to an execution observer', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const observer = {
      onMessage: vi.fn(),
      onProgress: vi.fn(),
      onTaskStatus: vi.fn(),
    };

    const executionPromise = executor.executeWithObserver!(
      'acp-codex',
      {
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      },
      'session/prompt',
      {
        sessionId: 'session-123',
        prompt: [{ type: 'text', text: 'Investigate the repository' }],
      },
      observer
    );

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: 1, agentInfo: { name: 'Codex' } },
        })}\n`
      )
    );

    await flushMicrotasks();
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'session-123',
            update: {
              state: 'running',
              message: 'Agent is working',
              content: { type: 'text', text: 'Working...' },
            },
          },
        })}\n`
      )
    );

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { stopReason: 'end_turn' },
        })}\n`
      )
    );

    await expect(executionPromise).resolves.toEqual({
      success: true,
      data: { stopReason: 'end_turn', outputText: 'Working...' },
    });
    expect(observer.onMessage).toHaveBeenCalledWith({ message: 'Working...' });
    expect(observer.onProgress).toHaveBeenCalledWith({ message: 'Working...' });
    expect(observer.onTaskStatus).toHaveBeenCalledWith({
      status: 'working',
      message: 'Agent is working',
    });
  });

  it('promotes final prompt text into outputText when no text updates were captured', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const executionPromise = executor.execute(
      'acp-codex',
      {
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      },
      'session/prompt',
      {
        sessionId: 'session-123',
        prompt: [{ type: 'text', text: '1+1等于几？' }],
      }
    );

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: 1, agentInfo: { name: 'Codex' } },
        })}\n`
      )
    );

    await flushMicrotasks();
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            stopReason: 'end_turn',
            output: [{ type: 'text', text: '2' }],
          },
        })}\n`
      )
    );

    await expect(executionPromise).resolves.toEqual({
      success: true,
      data: { stopReason: 'end_turn', output: [{ type: 'text', text: '2' }], outputText: '2' },
    });
  });

  it('treats cumulative prompt updates as replacements instead of unbounded appends', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const executionPromise = executor.execute(
      'acp-codex',
      {
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      },
      'session/prompt',
      {
        sessionId: 'session-123',
        prompt: [{ type: 'text', text: 'Explain the issue' }],
      }
    );

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: 1, agentInfo: { name: 'Codex' } },
        })}\n`
      )
    );

    await flushMicrotasks();
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'session-123',
            update: { content: { type: 'text', text: 'A' } },
          },
        })}\n`
      )
    );
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'session-123',
            update: { content: { type: 'text', text: 'AB' } },
          },
        })}\n`
      )
    );
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { stopReason: 'end_turn' },
        })}\n`
      )
    );

    await expect(executionPromise).resolves.toEqual({
      success: true,
      data: { stopReason: 'end_turn', outputText: 'AB' },
    });
  });

  it('still forwards alternating ACP task statuses to the observer in order', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const observer = {
      onMessage: vi.fn(),
      onProgress: vi.fn(),
      onTaskStatus: vi.fn(),
    };

    const executionPromise = executor.executeWithObserver(
      'acp-codex',
      {
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      },
      'session/prompt',
      {
        sessionId: 'session-123',
        prompt: [{ type: 'text', text: 'hello' }],
      },
      observer
    );

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: 1, agentInfo: { name: 'Codex' } },
        })}\n`
      )
    );

    await flushMicrotasks();
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'session-123',
            update: { status: 'completed' },
          },
        })}\n`
      )
    );
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'session-123',
            update: { status: 'working' },
          },
        })}\n`
      )
    );
    proc.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { stopReason: 'end_turn' },
        })}\n`
      )
    );

    await expect(executionPromise).resolves.toEqual({
      success: true,
      data: { stopReason: 'end_turn' },
    });
    expect(observer.onTaskStatus.mock.calls).toEqual([
      [{ status: 'completed' }],
      [{ status: 'working' }],
    ]);
  });
});
