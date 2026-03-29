import type { AaiJson } from '../../types/aai-json.js';

export const appId = 'acp-opencode';

export const descriptor: AaiJson = {
  schemaVersion: '2.0',
  version: '1.0.0',
  app: {
    name: {
      default: 'OpenCode',
      en: 'OpenCode',
      'zh-CN': 'OpenCode',
    },
  },
  discovery: {
    checks: [{ kind: 'command', command: 'opencode' }],
  },
  access: {
    protocol: 'acp-agent',
    config: {
      command: 'opencode',
      args: ['acp'],
    },
  },
  exposure: {
    keywords: ['code', 'agent', 'development'],
    summary: 'ACP agent for code editing, analysis, and development tasks.',
  },
};
