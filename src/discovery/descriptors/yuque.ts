import type { AaiJson } from '../../types/aai-json.js';

/**
 * Yuque (语雀) app descriptor
 *
 * Auth: API Key (X-Auth-Token header)
 * - Get your token from: https://www.yuque.com/settings/tokens
 * - Token never expires
 */
export const yuqueDescriptor: AaiJson = {
  schemaVersion: '1.0',
  version: '1.0.0',
  platform: 'web',
  app: {
    id: 'com.yuque.api',
    name: {
      en: 'Yuque',
      'zh-CN': '语雀',
    },
    defaultLang: 'en',
    description: 'Knowledge management and collaboration platform',
    aliases: ['语雀', 'yuque', 'knowledge', 'doc', '文档', '知识库'],
  },
  execution: {
    type: 'http',
    baseUrl: 'https://www.yuque.com/api/v2',
    defaultHeaders: {
      'Content-Type': 'application/json',
    },
  },
  auth: {
    type: 'apiKey',
    apiKey: {
      location: 'header',
      name: 'X-Auth-Token',
      obtainUrl: 'https://www.yuque.com/settings/tokens',
      instructions: {
        short: 'Get your API token from Yuque Settings > Tokens',
        detailed: `1. Go to https://www.yuque.com/settings/tokens
2. Click "新建令牌" (New Token)
3. Give it a name and select scopes
4. Copy the token (it won't be shown again)
5. Paste it here`,
        helpUrl: 'https://www.yuque.com/settings/tokens',
      },
    },
  },
  tools: [
    {
      name: 'getUser',
      description: 'Get current user information',
      parameters: {
        type: 'object',
        properties: {},
      },
      execution: {
        path: '/user',
        method: 'GET',
      },
    },
    {
      name: 'listRepos',
      description: 'List all knowledge bases (repos) for the authenticated user',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Filter by repo type: all, Book, Design, Sheet, Thread',
            enum: ['all', 'Book', 'Design', 'Sheet', 'Thread'],
          },
          offset: {
            type: 'number',
            description: 'Pagination offset',
          },
          limit: {
            type: 'number',
            description: 'Number of results (max 100)',
          },
        },
      },
      execution: {
        path: '/repos',
        method: 'GET',
      },
    },
    {
      name: 'getRepo',
      description: 'Get a specific knowledge base (repo) by ID',
      parameters: {
        type: 'object',
        properties: {
          repoId: {
            type: 'number',
            description: 'The knowledge base ID',
          },
        },
        required: ['repoId'],
      },
      execution: {
        path: '/repos/{repoId}',
        method: 'GET',
      },
    },
    {
      name: 'listDocs',
      description: 'List documents in a knowledge base',
      parameters: {
        type: 'object',
        properties: {
          repoId: {
            type: 'number',
            description: 'The knowledge base ID',
          },
          offset: {
            type: 'number',
            description: 'Pagination offset',
          },
          limit: {
            type: 'number',
            description: 'Number of results (max 100)',
          },
        },
        required: ['repoId'],
      },
      execution: {
        path: '/repos/{repoId}/docs',
        method: 'GET',
      },
    },
    {
      name: 'getDoc',
      description: 'Get a specific document by ID',
      parameters: {
        type: 'object',
        properties: {
          repoId: {
            type: 'number',
            description: 'The knowledge base ID',
          },
          docId: {
            type: 'number',
            description: 'The document ID',
          },
        },
        required: ['repoId', 'docId'],
      },
      execution: {
        path: '/repos/{repoId}/docs/{docId}',
        method: 'GET',
      },
    },
    {
      name: 'getDocDetail',
      description: 'Get document content (full detail including body)',
      parameters: {
        type: 'object',
        properties: {
          namespace: {
            type: 'string',
            description: 'User/group namespace',
          },
          slug: {
            type: 'string',
            description: 'Document slug (URL path)',
          },
          raw: {
            type: 'number',
            description: 'Return raw markdown (1) or rendered HTML (0)',
          },
        },
        required: ['namespace', 'slug'],
      },
      execution: {
        path: '/repos/{namespace}/docs/{slug}',
        method: 'GET',
      },
    },
    {
      name: 'search',
      description: 'Search across all accessible content',
      parameters: {
        type: 'object',
        properties: {
          q: {
            type: 'string',
            description: 'Search query',
          },
          type: {
            type: 'string',
            description: 'Filter by type: all, Doc, Repo, Group, User, Topic',
            enum: ['all', 'Doc', 'Repo', 'Group', 'User', 'Topic'],
          },
          offset: {
            type: 'number',
            description: 'Pagination offset',
          },
          limit: {
            type: 'number',
            description: 'Number of results (max 100)',
          },
        },
        required: ['q'],
      },
      execution: {
        path: '/search',
        method: 'GET',
      },
    },
  ],
};
