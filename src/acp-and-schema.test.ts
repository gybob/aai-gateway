import { describe, expect, it } from 'vitest';

import { generateAppGuide } from './guides/app-guide-generator.js';
import { AcpExecutor } from './executors/acp.js';
import { appId, descriptor } from './discovery/descriptors/codex-agent.js';
import { buildGatewayToolDefinitions } from './mcp/server.js';

describe('ACP guide metadata', () => {
  it('includes ACP tool descriptions in the generated app guide', async () => {
    const executor = new AcpExecutor();
    const capabilities = await executor.loadAppCapabilities(appId, descriptor.access.config);
    const guide = generateAppGuide(appId, descriptor, capabilities);

    expect(guide).not.toContain('No description provided.');
    expect(guide).toContain('### session/new');
    expect(guide).toContain('Create a new ACP session');
    expect(guide).toContain('### turn/cancel');
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
  it('returns accumulated content instead of incremental fragments', () => {
    const executor = new AcpExecutor() as any;
    const turn = {
      appId,
      turnId: 'turn-1',
      sessionId: 'session-1',
      outputText: '',
      content: [],
      done: false,
      status: 'working',
      waiters: new Set(),
      lastTouchedAt: Date.now(),
      params: {},
    } as any;

    executor.appendPromptTurnContent(turn, [{ type: 'text', text: '1' }]);
    executor.appendPromptTurnContent(turn, [{ type: 'text', text: '1+' }]);
    executor.appendPromptTurnContent(turn, [{ type: 'text', text: '1+1 等于 2。' }]);

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-1',
      sessionId: 'session-1',
      done: false,
      content: [{ type: 'text', text: '1+1 等于 2。' }],
    });
  });

  it('fills empty ACP prompt responses with a waiting placeholder', () => {
    const executor = new AcpExecutor() as any;
    const turn = {
      appId,
      turnId: 'turn-2',
      sessionId: 'session-2',
      outputText: '',
      content: [],
      done: false,
      status: 'working',
      waiters: new Set(),
      lastTouchedAt: Date.now(),
      params: {},
    } as any;

    expect(executor.buildPromptTurnResult(turn)).toEqual({
      turnId: 'turn-2',
      sessionId: 'session-2',
      done: false,
      content: [{ type: 'text', text: '处理中，请继续等待' }],
    });
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
        'Call this tool without arguments'
      );
      expect(tool?.listInputSchema).toMatchObject({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
    }
  });
});
