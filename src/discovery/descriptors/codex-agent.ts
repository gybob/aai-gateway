import type { AaiJson } from '../../types/aai-json.js';

export const appId = 'acp-codex';

export const descriptor: AaiJson = {
  schemaVersion: '2.0',
  version: '1.0.0',
  app: {
    name: {
      default: 'Codex',
      en: 'Codex',
      'zh-CN': 'Codex',
    },
  },
  discovery: {
    checks: [
      { kind: 'command', command: 'npx' },
      { kind: 'command', command: 'codex' },
    ],
  },
  access: {
    protocol: 'acp-agent',
    config: {
      command: 'npx',
      args: ['-y', '@zed-industries/codex-acp'],
    },
  },
  exposure: {
    keywords: ['code', 'openai', 'agent'],
    summary: 'Codex agent connected through the ACP adapter.',
  },
};
