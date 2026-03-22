import { describe, expect, it } from 'vitest';

import type { AaiJson, DetailedCapability } from '../types/aai-json.js';

import { generateOperationGuide } from './app-guide-generator.js';

describe('generateOperationGuide', () => {
  it('keeps ACP guides concise and runtime-driven', () => {
    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: { default: 'Codex' },
      },
      access: {
        protocol: 'acp-agent',
        config: {
          command: 'npx',
          args: ['-y', '@zed-industries/codex-acp'],
        },
      },
      exposure: {
        keywords: ['code', 'agent'],
        summary: '通过 ACP adapter 接入的代码 agent。',
      },
    };

    const detail: DetailedCapability = {
      title: 'ACP Agent Details',
      body: JSON.stringify({
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: true,
            embeddedContext: true,
          },
          sessionCapabilities: {
            list: {},
            close: {},
          },
        },
        authMethods: [{ id: 'chatgpt' }],
        agentInfo: {
          name: 'codex-acp',
          title: 'Codex',
          version: '0.10.0',
        },
      }),
    };

    const guide = generateOperationGuide('acp-codex', descriptor, detail);

    expect(guide).toContain(
      "Guide tool only. Do not pass `app:acp-codex` to your platform's Task/subagent API as an agent type."
    );
    expect(guide).toContain('To invoke this ACP agent, call `aai:exec` with `app: "acp-codex"`.');
    expect(guide).toContain('One-off prompt: `tool: "prompt"`');
    expect(guide).toContain('Explicit session control: `tool: "session/new"`');
    expect(guide).toContain('Treat `sessionId` as the ACP conversation handle.');
    expect(guide).toContain('prefer MCP progress-enabled `aai:exec`');
    expect(guide).toContain('always set `task: {}`');
    expect(guide).toContain(
      'Wrong: call `aai:exec` with only `app`, `tool`, and `args` for a prompt'
    );
    expect(guide).toContain('and `task: {}`');
    expect(guide).toContain(
      'If `task: {}` is not supported by your client, include `progressToken`'
    );
    expect(guide).toContain('image input: supported');
    expect(guide).toContain('embedded context: supported');
    expect(guide).toContain('load existing session: supported');
    expect(guide).toContain('additional session methods: list, close');

    expect(guide).not.toContain('Auth Methods');
    expect(guide).not.toContain('agentInfo');
    expect(guide).not.toContain('0.10.0');
    expect(guide).not.toContain('Protocol: acp-agent');
    expect(guide).not.toContain('Keywords:');
  });

  it('omits runtime capability lines when ACP inspection is unavailable', () => {
    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: { default: 'OpenCode' },
      },
      access: {
        protocol: 'acp-agent',
        config: {
          command: 'opencode',
          args: ['acp'],
        },
      },
      exposure: {
        keywords: ['code'],
        summary: '用于代码任务的 ACP agent。',
      },
    };

    const detail: DetailedCapability = {
      title: 'ACP Agent Details',
      body: 'Live ACP inspection is currently unavailable.',
    };

    const guide = generateOperationGuide('acp-opencode', descriptor, detail);

    expect(guide).toContain(
      "Guide tool only. Do not pass `app:acp-opencode` to your platform's Task/subagent API as an agent type."
    );
    expect(guide).toContain('If `sessionId` is omitted when using `prompt`');
    expect(guide).not.toContain('## Available Runtime Capabilities');
    expect(guide).not.toContain('Live ACP inspection is currently unavailable.');
  });
});
