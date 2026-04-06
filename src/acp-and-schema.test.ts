import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  generateAppGuideMarkdown,
  generateGuideToolSummary,
} from './guides/app-guide-generator.js';
import { AcpExecutor } from './executors/acp.js';
import { appId, descriptor } from './discovery/descriptors/codex-agent.js';
import { AaiGatewayServer } from './mcp/server.js';
import { buildGatewayToolDefinitions } from './core/tool-definitions.js';
import { Gateway } from './core/gateway.js';
import { importMcpServer } from './core/importer.js';

describe('ACP guide metadata', () => {
  it('renders ACP app guides with exec instructions and examples but without schemas', async () => {
    const executor = new AcpExecutor();
    const capabilities = await executor.loadAppCapabilities(appId, descriptor.access.config);
    const guide = generateAppGuideMarkdown(appId, descriptor, capabilities);

    expect(guide).toContain(
      'To execute tools in this app, you must call the `aai:exec` tool (another tool in this same MCP server).'
    );
    expect(guide).toContain(
      'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.'
    );
    expect(guide).toContain(`set \`app\` to "${appId}"`);
    expect(guide).not.toContain('No description provided.');
    expect(guide).toContain('### session/new');
    expect(guide).toContain('### turn/start');
    expect(guide).toContain('### turn/respondPermission');
    expect(guide).toContain('Create a new persistent session');
    expect(guide).toContain('### turn/cancel');
    expect(guide).not.toContain('"inputSchema"');
    expect(guide).not.toContain('## Schema Lookup');
    expect(guide).not.toContain('## Examples');
    expect(guide).toContain('args：');
    expect(guide).toContain('"tool": "session/new"');
    expect(guide).toContain('"tool": "turn/start"');
    expect(guide).not.toContain('Protocol:');
  });

  it('uses concise guide tool summaries focused on app purpose', () => {
    expect(generateGuideToolSummary(appId, descriptor)).toBe(
      `Codex — ${descriptor.exposure.summary} Call this to see available tools and usage.`
    );
  });

  it('renders MCP app guides with execution instructions before schemas', () => {
    const guide = generateAppGuideMarkdown(
      'brave-search',
      {
        app: {
          name: {
            default: 'Brave Search',
          },
        },
        access: {
          protocol: 'mcp',
        },
        exposure: {
          summary: 'Use this MCP for Brave web search.',
        },
      } as any,
      {
        title: 'MCP Tools',
        tools: [
          {
            name: 'search',
            description: 'Run a web search using Brave Search.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                },
              },
              required: ['query'],
            },
          },
        ],
      }
    );

    expect(guide).toContain(
      'To execute tools in this app, you must call the `aai:exec` tool (another tool in this same MCP server).'
    );
    expect(guide).toContain(
      'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.'
    );
    expect(guide).toContain('set `app` to "brave-search"');
    expect(guide).toContain('set `tool` to one of the tool names below');
    expect(guide).not.toContain('- App ID:');
    expect(guide).not.toContain('- Summary:');
    expect(guide).not.toContain('## Examples');
    expect(guide).toContain('### search');
    expect(guide).toContain('"inputSchema"');
  });
});

describe('Gateway guide formatting', () => {
  it('renders mcp:import with exec instructions and complete examples', async () => {
    const gateway = new Gateway();
    const result = gateway.handleGatewayToolGuide('mcp:import');
    const guide = result.text;

    expect(guide).toContain(
      'To perform the actual import, you must call the `aai:exec` tool (another tool in this same MCP server).'
    );
    expect(guide).toContain(
      'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.'
    );
    expect(guide).toContain('leave `app` empty, set `tool` to `"mcp:import"`');
    expect(guide).toContain('Phase 1 — inspect:');
    expect(guide).toContain('"tool": "aai:exec"');
    expect(guide).not.toContain('## Schema');
    expect(guide).toContain('## Parameters');
    expect(guide).toContain('## Environment variables & API keys');
    expect(guide).toContain('${VAR_NAME} placeholders');
    expect(guide).toContain('Open the env file for the user');
    expect(guide).toContain('Never ask the user to send API keys, tokens, or secrets in chat.');
  });

  it('renders skill:import with the same exec guidance format', async () => {
    const gateway = new Gateway();
    const result = gateway.handleGatewayToolGuide('skill:import');
    const guide = result.text;

    expect(guide).toContain(
      'To perform the actual operation, you must call the `aai:exec` tool (another tool in this same MCP server).'
    );
    expect(guide).toContain(
      'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.'
    );
    expect(guide).toContain('leave `app` empty, set `tool` to "skill:import"');
    expect(guide).toContain('## Examples');
    expect(guide).toContain('"tool": "aai:exec"');
    expect(guide).not.toContain('## Schema');
  });
});

describe('App policy and agent overrides', () => {
  function createCaller(id: string) {
    return {
      id,
      name: id,
      transport: 'mcp',
      type: 'codex',
    } as const;
  }

  function createApp(appId: string, source: 'mcp-import' | 'skill-import' = 'mcp-import') {
    return {
      appId,
      source,
      descriptor: {
        schemaVersion: '2.0',
        version: '1.0.0',
        app: {
          name: {
            default: appId,
          },
        },
        access: {
          protocol: 'mcp',
        },
        exposure: {
          summary: `Summary for ${appId}`,
        },
      },
    } as any;
  }

  it('lists importer-only apps for every agent and allows other agents to enable them', async () => {
    const previousHome = process.env.AAI_HOME;
    process.env.AAI_HOME = join(tmpdir(), `aai-gateway-policy-${Date.now()}`);

    try {
      const gateway = new Gateway();
      (gateway as any).appRegistry.set('brave-search', createApp('brave-search'));

      const importer = createCaller('agent-importer');
      const otherAgent = createCaller('agent-other');

      const { saveAppPolicyState } = await import('./storage/agent-state.js');
      await saveAppPolicyState('brave-search', {
        defaultEnabled: 'importer-only',
        importerAgentId: importer.id,
        updatedAt: new Date().toISOString(),
      });

      const importerTools = await gateway.listTools(importer);
      expect(importerTools.map((tool) => tool.name)).toContain('app:brave-search');

      const otherToolsBefore = await gateway.listTools(otherAgent);
      expect(otherToolsBefore.map((tool) => tool.name)).not.toContain('app:brave-search');

      const otherListBefore = await gateway.handleListAllApps(otherAgent);
      expect(otherListBefore.structuredContent).toEqual({
        apps: [
          expect.objectContaining({
            app: 'brave-search',
            enabled: false,
            removable: true,
          }),
        ],
      });

      await gateway.handleEnableApp({ app: 'brave-search' }, otherAgent);

      const otherToolsAfter = await gateway.listTools(otherAgent);
      expect(otherToolsAfter.map((tool) => tool.name)).toContain('app:brave-search');

      const otherListAfter = await gateway.handleListAllApps(otherAgent);
      expect(otherListAfter.structuredContent).toEqual({
        apps: [
          expect.objectContaining({
            app: 'brave-search',
            enabled: true,
            removable: true,
          }),
        ],
      });
    } finally {
      if (previousHome === undefined) {
        delete process.env.AAI_HOME;
      } else {
        process.env.AAI_HOME = previousHome;
      }
    }
  });
});

describe('ACP executor validation', () => {
  it('returns a clear schema reference when session/new params are invalid', async () => {
    const executor = new AcpExecutor();
    const result = await executor.execute(appId, descriptor.access.config, 'session/new', {});

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
            description: 'Absolute working directory for the session.',
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
      permissionRequests: [],
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
      message: 'Waiting for 1 permission(s).',
      content: [],
      permissionRequests: [
        {
          title: 'Delete file',
          description: 'Delete /repo/tmp.txt',
          options: [
            { id: 'allow_once', label: 'Allow once' },
            { id: 'reject_once', label: 'Reject' },
          ],
        },
      ],
    });
    expect((result.permissionRequests as { permissionId: string }[])[0].permissionId).toBeTruthy();
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
    turn.permissionRequests = [
      {
        permissionId,
        title: 'Delete file',
        options: [{ id: 'allow_once', label: 'Allow once' }],
      },
    ];

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
    expect(turn.permissionRequests).toEqual([]);
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

    vi.advanceTimersByTime(10 * 60_000);
    await Promise.resolve();

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-5',
      sessionId: 'session-5',
      done: true,
      state: 'failed',
      stopReason: null,
      error: {
        code: 'downstream_timeout',
        message: 'ACP turn timed out after 600000ms without any session/update activity.',
      },
      content: [],
    });
    expect(executor.sendNotification).toHaveBeenCalledWith(appId, 'session/cancel', {
      sessionId: 'session-5',
    });
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

    vi.advanceTimersByTime(10 * 60_000);
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

    // After cancel/timeout, there's a 2s cooldown delay before launching the next turn
    vi.advanceTimersByTime(2_000);

    expect(executor.activeTurnIdsBySession.get(activeTurn.sessionId)).toBe(queuedTurn.turnId);
    expect(queuedTurn.state).toBe('running');
  });
});

describe('Gateway progressive disclosure schemas', () => {
  it('uses lightweight tools/list schemas for large gateway tools', () => {
    const tools = buildGatewayToolDefinitions();

    for (const name of ['mcp:import', 'skill:import']) {
      const tool = tools.find((entry) => entry.name === name);

      expect(tool).toBeDefined();
      expect(tool?.listInputSchema).toBeDefined();
      expect(tool?.listInputSchema).not.toEqual(tool?.inputSchema);
      expect(tool?.listInputSchema).toMatchObject({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
    }

    // search:discover has no args — inputSchema and listInputSchema are identical
    const searchTool = tools.find((entry) => entry.name === 'search:discover');
    expect(searchTool).toBeDefined();
    expect(searchTool?.listInputSchema).toBeDefined();
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
      'Execute any AAI tool action. Read the guide first (call app:*, mcp:import, skill:import, or search:discover) — it contains the required schema and parameters.'
    );
    expect(byName.get('mcp:import')?.description).toBe(
      'Import an MCP server as a new app. Call this first to get the import guide, then use aai:exec to perform the import. Never ask the user for API keys or secrets in chat.'
    );
    expect(byName.get('skill:import')?.description).toBe(
      'Import a local skill as a new app. Call this first to get the import guide, then use aai:exec to perform the import.'
    );
    expect(byName.get('search:discover')?.description).toBe(
      'Find and install new tools. Call this when the user wants to search for, discover, or add MCP servers or skills.'
    );
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
