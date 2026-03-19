import type { AaiJson } from '../../types/aai-json.js';

export const opencodeDescriptor: AaiJson = {
  schemaVersion: '2.0',
  version: '1.0.0',
  app: {
    name: {
      default: 'OpenCode',
      en: 'OpenCode',
      'zh-CN': 'OpenCode',
    },
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
    summary: '用于代码编辑、分析和开发任务的 ACP agent。',
  },
};
