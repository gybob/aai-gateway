import type { AaiJson } from '../../types/aai-json.js';

export const codexAcpDescriptor: AaiJson = {
  schemaVersion: '2.0',
  version: '1.0.0',
  app: {
    name: {
      default: 'Codex',
      en: 'Codex',
      'zh-CN': 'Codex',
    },
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
    summary: '通过 ACP adapter 接入的 Codex agent。',
  },
};
