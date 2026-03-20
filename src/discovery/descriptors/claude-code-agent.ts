import type { AaiJson } from '../../types/aai-json.js';

export const claudeAcpDescriptor: AaiJson = {
  schemaVersion: '2.0',
  version: '1.0.0',
  app: {
    name: {
      default: 'Claude Code',
      en: 'Claude Code',
      'zh-CN': 'Claude Code',
    },
  },
  discovery: {
    checks: [
      { kind: 'command', command: 'npx' },
      { kind: 'command', command: 'claude' },
    ],
  },
  access: {
    protocol: 'acp-agent',
    config: {
      command: 'npx',
      args: ['-y', '@zed-industries/claude-agent-acp'],
    },
  },
  exposure: {
    keywords: ['code', 'anthropic', 'agent'],
    summary: '通过 ACP adapter 接入的 Claude Code agent。',
  },
};
