import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateAppGuideMarkdown, generateGuideToolSummary } from './guides/app-guide-generator.js';
import { AcpExecutor } from './executors/acp.js';
import { appId, descriptor } from './discovery/descriptors/codex-agent.js';
import { buildGatewayToolDefinitions } from './mcp/server.js';
import { importMcpServer } from './mcp/importer.js';

describe('ACP guide metadata', () => {
  it('includes ACP tool descriptions in the generated app guide', async () => {
    const executor = new AcpExecutor();
    const capabilities = await executor.loadAppCapabilities(appId, descriptor.access.config);
    const guide = generateAppGuideMarkdown(appId, descriptor, capabilities);

    expect(guide).not.toContain('No description provided.');
    expect(guide).toContain('- session/new:');
    expect(guide).toContain('- turn/start:');
    expect(guide).toContain('- turn/respondPermission:');
    expect(guide).toContain('Create a new ACP session');
    expect(guide).toContain('- turn/cancel:');
    expect(guide).not.toContain('session/prompt');
    expect(guide).not.toContain('## Schema Lookup');
    expect(guide).toContain('## Examples');
    expect(guide).toContain('aai:exec');
    expect(guide).not.toContain('Protocol:');
  });

  it('uses concise guide tool summaries focused on app purpose', () => {
    expect(generateGuideToolSummary(appId, descriptor)).toBe(
      `Codex. ${descriptor.exposure.summary} Guide tool, no arguments.`
    );
  });
});

describe('ACP executor validation', () => {
  it('returns a clear schema reference when session/new params are invalid', async () => {
    const executor = new AcpExecutor();
    const result = await executor.execute(
      appId,
      descriptor.access.config,
      'session/new',
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("参数校验失败 for 'session/new'");
    expect(result.error).toContain("缺少必需参数 'cwd'");
    expect(result.schema).toEqual({
      name: 'session/new',
      inputSchema: {
        type: 'object',
        required: ['cwd'],
        properties: {
          cwd: {
            type: 'string',
            description: 'Absolute working directory for the ACP session.',
          },
        },
      },
    });
  });
});

describe('ACP prompt polling aggregation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function createTurn(overrides: Record<string, unknown> = {}) {
    return {
      appId,
      turnId: 'turn',
      sessionId: 'session',
      promptMessageId: 'msg-user',
      trackedMessageIds: new Set<string>(['msg-user']),
      outputText: '',
      content: [],
      pendingContent: [],
      done: false,
      state: 'running',
      waiters: new Set(),
      lastTouchedAt: Date.now(),
      lastUpdateAt: Date.now(),
      params: { messageId: 'msg-user' },
      ...overrides,
    } as any;
  }

  it('returns unread incremental content instead of repeating prior fragments', () => {
    const executor = new AcpExecutor() as any;
    const turn = {
      appId,
      turnId: 'turn-1',
      sessionId: 'session-1',
      outputText: '',
      content: [],
      pendingContent: [],
      done: false,
      state: 'running',
      waiters: new Set(),
      lastTouchedAt: Date.now(),
      lastUpdateAt: Date.now(),
      params: {},
    } as any;

    executor.appendPromptTurnContent(turn, [{ type: 'text', text: '1' }]);
    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-1',
      sessionId: 'session-1',
      done: false,
      state: 'running',
      content: [{ type: 'text', text: '1' }],
    });

    executor.appendPromptTurnContent(turn, [{ type: 'text', text: '1+' }]);
    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-1',
      sessionId: 'session-1',
      done: false,
      state: 'running',
      content: [{ type: 'text', text: '+' }],
    });

    executor.appendPromptTurnContent(turn, [{ type: 'text', text: '1+1 等于 2。' }]);
    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-1',
      sessionId: 'session-1',
      done: false,
      state: 'running',
      content: [{ type: 'text', text: '1 等于 2。' }],
    });
  });

  it('returns empty content when there is no unread delta', () => {
    const executor = new AcpExecutor() as any;
    const turn = {
      appId,
      turnId: 'turn-2',
      sessionId: 'session-2',
      outputText: '',
      content: [],
      pendingContent: [],
      done: false,
      state: 'running',
      waiters: new Set(),
      lastTouchedAt: Date.now(),
      lastUpdateAt: Date.now(),
      params: {},
    } as any;

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-2',
      sessionId: 'session-2',
      done: false,
      state: 'running',
      content: [],
    });
  });

  it('deduplicates repeated content blocks from a single session/update payload', () => {
    const executor = new AcpExecutor() as any;
    const turn = createTurn({ turnId: 'turn-3', sessionId: 'session-3' });

    executor.promptTurns.set(turn.turnId, turn);
    executor.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);

    executor.capturePromptUpdate(turn.sessionId, {
      sessionId: turn.sessionId,
      update: {
        content: [{ type: 'text', text: '和' }],
        delta: [{ type: 'text', text: '和' }],
      },
    });

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-3',
      sessionId: 'session-3',
      done: false,
      state: 'running',
      content: [{ type: 'text', text: '和' }],
    });
  });

  it('does not mark a turn done when session/update reports a terminal status', () => {
    const executor = new AcpExecutor() as any;
    const turn = createTurn({ turnId: 'turn-4', sessionId: 'session-4' });

    executor.promptTurns.set(turn.turnId, turn);
    executor.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);

    executor.capturePromptUpdate(turn.sessionId, {
      sessionId: turn.sessionId,
      update: {
        status: 'done',
        message: 'Completed downstream.',
      },
    });

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-4',
      sessionId: 'session-4',
      done: false,
      state: 'running',
      content: [],
    });
  });

  it('ignores downstream failed then working status flips for turn completion', () => {
    const executor = new AcpExecutor() as any;
    const turn = createTurn({
      turnId: 'turn-status-flip',
      sessionId: 'session-status-flip',
    });

    executor.promptTurns.set(turn.turnId, turn);
    executor.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);

    executor.capturePromptUpdate(turn.sessionId, {
      sessionId: turn.sessionId,
      update: { status: 'failed', message: 'tool failed' },
    });
    executor.capturePromptUpdate(turn.sessionId, {
      sessionId: turn.sessionId,
      update: { status: 'working', message: 'tool retried' },
    });
    executor.capturePromptUpdate(turn.sessionId, {
      sessionId: turn.sessionId,
      update: {
        content: [{ type: 'text', text: 'still streaming' }],
      },
    });

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-status-flip',
      sessionId: 'session-status-flip',
      done: false,
      state: 'running',
      content: [{ type: 'text', text: 'still streaming' }],
    });
  });

  it('completes a turn when session/prompt returns without final content', () => {
    const executor = new AcpExecutor() as any;
    const turn = createTurn({
      turnId: 'turn-ack',
      sessionId: 'session-ack',
      message: 'Turn started.',
    });

    executor.promptTurns.set(turn.turnId, turn);
    executor.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);

    executor.completePromptTurn(turn.turnId, {});

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-ack',
      sessionId: 'session-ack',
      done: true,
      state: 'completed',
      stopReason: null,
      content: [],
    });
  });

  it('completes a turn when session/prompt returns final content directly', () => {
    const executor = new AcpExecutor() as any;
    const turn = createTurn({
      turnId: 'turn-final',
      sessionId: 'session-final',
      message: 'Turn started.',
    });

    executor.promptTurns.set(turn.turnId, turn);
    executor.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);

    executor.completePromptTurn(turn.turnId, {
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'ACP_OK' }],
    });

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-final',
      sessionId: 'session-final',
      done: true,
      state: 'completed',
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'ACP_OK' }],
    });
  });

  it('surfaces downstream permission requests through waiting_permission', async () => {
    const executor = new AcpExecutor() as any;
    const turn = createTurn({
      turnId: 'turn-perm',
      sessionId: 'session-perm',
      appId,
    });

    executor.promptTurns.set(turn.turnId, turn);
    executor.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);
    executor.sessionOwners.set(turn.sessionId, appId);

    await executor.handlePermissionRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'session/request_permission',
      params: {
        sessionId: turn.sessionId,
        toolCall: {
          title: 'Delete file',
          content: [{ type: 'text', text: 'Delete /repo/tmp.txt' }],
        },
        options: [
          { optionId: 'allow_once', name: 'Allow once' },
          { optionId: 'reject_once', name: 'Reject' },
        ],
      },
    });

    const result = executor.buildPromptTurnResult(turn);
    expect(result).toMatchObject({
      turnId: 'turn-perm',
      sessionId: 'session-perm',
      done: false,
      state: 'waiting_permission',
      message: 'Waiting for user permission.',
      content: [],
      permissionRequest: {
        title: 'Delete file',
        description: 'Delete /repo/tmp.txt',
        options: [
          { id: 'allow_once', label: 'Allow once' },
          { id: 'reject_once', label: 'Reject' },
        ],
      },
    });
    expect((result.permissionRequest as { permissionId: string }).permissionId).toBeTruthy();
  });

  it('forwards turn/respondPermission to the downstream request and resumes the turn', async () => {
    const executor = new AcpExecutor() as any;
    executor.sendJsonRpcResult = vi.fn().mockResolvedValue(undefined);
    const turn = createTurn({
      turnId: 'turn-respond',
      sessionId: 'session-respond',
      appId,
    });
    const permissionId = 'perm-1';

    turn.state = 'waiting_permission';
    turn.permissionRequest = {
      permissionId,
      title: 'Delete file',
      options: [{ id: 'allow_once', label: 'Allow once' }],
    };

    executor.promptTurns.set(turn.turnId, turn);
    executor.pendingPermissionRequests.set(permissionId, {
      appId,
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      downstreamRequestId: 9,
      permissionId,
      title: 'Delete file',
      options: [{ id: 'allow_once', label: 'Allow once' }],
    });

    const result = await executor.handleTurnRespondPermissionRequest(appId, {
      turnId: turn.turnId,
      permissionId,
      decision: {
        type: 'select',
        optionId: 'allow_once',
      },
    });

    expect(result).toEqual({
      turnId: turn.turnId,
      accepted: true,
    });
    expect(executor.sendJsonRpcResult).toHaveBeenCalledWith(appId, 9, {
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
    expect(turn.state).toBe('running');
    expect(turn.permissionRequest).toBeUndefined();
  });

  it('fails a turn after prolonged downstream inactivity', async () => {
    vi.useFakeTimers();

    const executor = new AcpExecutor() as any;
    executor.sendNotification = vi.fn().mockResolvedValue(undefined);
    const now = Date.now();
    const turn = createTurn({
      turnId: 'turn-5',
      sessionId: 'session-5',
      lastTouchedAt: now,
      lastUpdateAt: now,
    });

    executor.promptTurns.set(turn.turnId, turn);
    executor.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);
    executor.recordPromptTurnActivity(turn);

    vi.advanceTimersByTime(3 * 60_000);
    await Promise.resolve();

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-5',
      sessionId: 'session-5',
      done: true,
      state: 'failed',
      stopReason: null,
      error: {
        code: 'downstream_timeout',
        message: 'ACP turn timed out after 180000ms without any session/update activity.',
      },
      content: [],
    });
    expect(executor.sendNotification).toHaveBeenCalledWith(
      appId,
      'session/cancel',
      { sessionId: 'session-5' }
    );
  });

  it('keeps late updates isolated from the next queued turn after local inactivity failure', async () => {
    vi.useFakeTimers();

    const executor = new AcpExecutor() as any;
    executor.sendNotification = vi.fn().mockResolvedValue(undefined);
    executor.launchPromptTurn = vi.fn((turn: any) => {
      turn.state = 'running';
      turn.message = 'Turn started.';
      executor.activeTurnIdsBySession.set(turn.sessionId, turn.turnId);
    });

    const activeTurn = createTurn({
      turnId: 'turn-active',
      sessionId: 'session-shared',
      promptMessageId: 'msg-active',
      trackedMessageIds: new Set<string>(['msg-active']),
      params: { messageId: 'msg-active' },
    });
    const queuedTurn = createTurn({
      turnId: 'turn-next',
      sessionId: 'session-shared',
      promptMessageId: 'msg-next',
      trackedMessageIds: new Set<string>(['msg-next']),
      params: { messageId: 'msg-next' },
      state: 'running',
      message: 'Waiting to start.',
    });

    executor.promptTurns.set(activeTurn.turnId, activeTurn);
    executor.promptTurns.set(queuedTurn.turnId, queuedTurn);
    executor.activeTurnIdsBySession.set(activeTurn.sessionId, activeTurn.turnId);
    executor.queuedTurnIdsBySession.set(activeTurn.sessionId, [queuedTurn.turnId]);
    executor.recordPromptTurnActivity(activeTurn);

    vi.advanceTimersByTime(3 * 60_000);
    await Promise.resolve();

    expect(activeTurn.done).toBe(true);
    expect(executor.activeTurnIdsBySession.get(activeTurn.sessionId)).toBe(activeTurn.turnId);
    expect(queuedTurn.state).toBe('running');

    executor.capturePromptUpdate(activeTurn.sessionId, {
      sessionId: activeTurn.sessionId,
      update: {
        messageId: 'msg-old-agent',
        content: [{ type: 'text', text: 'late old update' }],
      },
    });

    expect(executor.buildPromptTurnResult(queuedTurn)).toEqual({
      turnId: 'turn-next',
      sessionId: 'session-shared',
      done: false,
      state: 'running',
      message: 'Waiting to start.',
      content: [],
    });

    executor.completePromptTurn(activeTurn.turnId, { stopReason: 'cancelled' });

    expect(executor.activeTurnIdsBySession.get(activeTurn.sessionId)).toBe(queuedTurn.turnId);
    expect(queuedTurn.state).toBe('running');
  });
});

describe('Gateway progressive disclosure schemas', () => {
  it('uses lightweight tools/list schemas for large gateway tools', () => {
    const tools = buildGatewayToolDefinitions();

    for (const name of ['mcp:import', 'skill:import', 'search:discover']) {
      const tool = tools.find((entry) => entry.name === name);

      expect(tool).toBeDefined();
      expect(tool?.listInputSchema).toBeDefined();
      expect(tool?.listInputSchema).not.toEqual(tool?.inputSchema);
      expect((tool?.listInputSchema as Record<string, unknown>).description).toContain(
        'No arguments.'
      );
      expect(tool?.listInputSchema).toMatchObject({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
    }
  });

  it('exposes enable/disable built-ins and removes remote discover', () => {
    const tools = buildGatewayToolDefinitions();
    const names = tools.map((tool) => tool.name);

    expect(names).not.toContain('remote:discover');
    expect(names).not.toContain('aai:schema');
    expect(names).toContain('listAllAaiApps');
    expect(names).toContain('disableApp');
    expect(names).toContain('enableApp');
    expect(names).toContain('removeApp');
  });

  it('uses concise gateway tool descriptions without cross-tool guidance', () => {
    const tools = buildGatewayToolDefinitions();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get('aai:exec')?.description).toBe(
      'Execute a tool. Only call this after reading the guide returned by the corresponding guide tool (e.g. app:*, mcp:import).'
    );
    expect(byName.get('mcp:import')?.description).toBe(
      'Import an MCP server into AAI Gateway. Guide tool, no arguments.'
    );
    expect(byName.get('skill:import')?.description).toBe(
      'Import a skill into AAI Gateway. Guide tool, no arguments.'
    );
    expect(byName.get('search:discover')?.description).toBe(
      'Search for MCP servers or skills when the user needs a new capability. Guide tool, no arguments.'
    );
    expect(byName.get('mcp:import')?.listInputSchema).toMatchObject({
      description: 'No arguments.',
    });
  });

  it('returns a short warning when MCP import includes plaintext sensitive values', async () => {
    const previousAppsDir = process.env.AAI_GATEWAY_APPS_DIR;
    process.env.AAI_GATEWAY_APPS_DIR = join(tmpdir(), `aai-gateway-test-${Date.now()}`);
    try {
      const result = await importMcpServer(
        {
          listTools: vi.fn().mockResolvedValue([]),
          getServerInfo: vi.fn().mockResolvedValue({ name: 'Example MCP' }),
        } as any,
        {
          get: vi.fn().mockResolvedValue(null),
          set: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
        } as any,
        {
          config: {
            transport: 'stdio',
            command: 'npx',
            args: ['example-mcp'],
            env: {
              EXAMPLE_API_KEY: 'secret-value',
            },
          },
          summary: 'Use this MCP for examples.',
        }
      );

      expect(result.warnings).toEqual([
        expect.stringContaining('Sensitive values were provided directly in this chat.'),
      ]);
    } finally {
      if (previousAppsDir === undefined) {
        delete process.env.AAI_GATEWAY_APPS_DIR;
      } else {
        process.env.AAI_GATEWAY_APPS_DIR = previousAppsDir;
      }
    }
  });
});
