import type { AaiJson } from '../../types/aai-json.js';

export const appId = 'claude';

export const descriptor: AaiJson = {
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
      args: ['-y', '@agentclientprotocol/claude-agent-acp'],
    },
  },
  exposure: {
    summary: 'AI assistant for code editing, analysis, and development tasks.',
  },
};
