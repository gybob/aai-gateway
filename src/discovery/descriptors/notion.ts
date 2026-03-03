import type { AaiJson } from '../../types/aai-json.js';

/**
 * Notion app descriptor
 *
 * Auth: API Key (Bearer token in Authorization header)
 * - Get your integration token from: https://www.notion.so/my-integrations
 * - Token never expires unless revoked
 * - Requires: Notion-Version header
 */
export const notionDescriptor: AaiJson = {
  schemaVersion: '1.0',
  version: '1.0.0',
  platform: 'web',
  app: {
    id: 'com.notion.api',
    name: {
      en: 'Notion',
      'zh-CN': 'Notion笔记',
    },
    defaultLang: 'en',
    description: 'All-in-one workspace for notes, docs, wikis, and project management',
    aliases: ['notion', '诺馨', '笔记', 'notes', 'docs', '文档', '知识库'],
  },
  execution: {
    type: 'http',
    baseUrl: 'https://api.notion.com/v1',
    defaultHeaders: {
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
  },
  auth: {
    type: 'apiKey',
    apiKey: {
      location: 'header',
      name: 'Authorization',
      prefix: 'Bearer',
      obtainUrl: 'https://www.notion.so/my-integrations',
      instructions: {
        short: "Get your Integration Secret from Notion's My Integrations page",
        detailed: `1. Go to https://www.notion.so/my-integrations
2. Click "+ New integration"
3. Give it a name and select workspace
4. Copy the "Internal Integration Secret"
5. Share pages with your integration in Notion
6. Paste the secret here`,
        helpUrl: 'https://www.notion.so/my-integrations',
      },
    },
  },
  tools: [
    {
      name: 'listDatabases',
      description: 'List all databases shared with the integration',
      parameters: {
        type: 'object',
        properties: {
          startCursor: {
            type: 'string',
            description: 'Pagination cursor for next page',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results (max 100)',
          },
        },
      },
      execution: {
        path: '/databases',
        method: 'GET',
      },
    },
    {
      name: 'queryDatabase',
      description: 'Query a database for pages matching filter criteria',
      parameters: {
        type: 'object',
        properties: {
          databaseId: {
            type: 'string',
            description: 'The database ID',
          },
          filter: {
            type: 'object',
            description: 'Filter conditions',
          },
          sorts: {
            type: 'array',
            description: 'Sort conditions',
            items: { type: 'object' },
          },
          startCursor: {
            type: 'string',
            description: 'Pagination cursor',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results (max 100)',
          },
        },
        required: ['databaseId'],
      },
      execution: {
        path: '/databases/{databaseId}/query',
        method: 'POST',
      },
    },
    {
      name: 'getDatabase',
      description: 'Get database metadata and schema',
      parameters: {
        type: 'object',
        properties: {
          databaseId: {
            type: 'string',
            description: 'The database ID',
          },
        },
        required: ['databaseId'],
      },
      execution: {
        path: '/databases/{databaseId}',
        method: 'GET',
      },
    },
    {
      name: 'getPage',
      description: 'Get page properties and metadata',
      parameters: {
        type: 'object',
        properties: {
          pageId: {
            type: 'string',
            description: 'The page ID',
          },
        },
        required: ['pageId'],
      },
      execution: {
        path: '/pages/{pageId}',
        method: 'GET',
      },
    },
    {
      name: 'createPage',
      description: 'Create a new page in a database or as a child page',
      parameters: {
        type: 'object',
        properties: {
          parent: {
            type: 'object',
            description: 'Parent database or page reference',
          },
          properties: {
            type: 'object',
            description: 'Page property values',
          },
          children: {
            type: 'array',
            description: 'Page content blocks',
            items: { type: 'object' },
          },
        },
        required: ['parent', 'properties'],
      },
      execution: {
        path: '/pages',
        method: 'POST',
      },
    },
    {
      name: 'updatePage',
      description: 'Update page properties',
      parameters: {
        type: 'object',
        properties: {
          pageId: {
            type: 'string',
            description: 'The page ID',
          },
          properties: {
            type: 'object',
            description: 'Properties to update',
          },
          archived: {
            type: 'boolean',
            description: 'Archive or restore the page',
          },
        },
        required: ['pageId'],
      },
      execution: {
        path: '/pages/{pageId}',
        method: 'PATCH',
      },
    },
    {
      name: 'getBlockChildren',
      description: 'Get the content blocks of a page or block',
      parameters: {
        type: 'object',
        properties: {
          blockId: {
            type: 'string',
            description: 'The block ID (or page ID for page content)',
          },
          startCursor: {
            type: 'string',
            description: 'Pagination cursor',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results (max 100)',
          },
        },
        required: ['blockId'],
      },
      execution: {
        path: '/blocks/{blockId}/children',
        method: 'GET',
      },
    },
    {
      name: 'appendBlockChildren',
      description: 'Append content blocks to a page or block',
      parameters: {
        type: 'object',
        properties: {
          blockId: {
            type: 'string',
            description: 'The parent block ID',
          },
          children: {
            type: 'array',
            description: 'Content blocks to append',
            items: { type: 'object' },
          },
        },
        required: ['blockId', 'children'],
      },
      execution: {
        path: '/blocks/{blockId}/children',
        method: 'PATCH',
      },
    },
    {
      name: 'search',
      description: 'Search for pages and databases by title',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          filter: {
            type: 'object',
            description: 'Filter by object type (page, database)',
            properties: {
              property: { type: 'string' },
              value: { type: 'string', enum: ['page', 'database'] },
            },
          },
          sort: {
            type: 'object',
            description: 'Sort results',
          },
          startCursor: {
            type: 'string',
            description: 'Pagination cursor',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results (max 100)',
          },
        },
      },
      execution: {
        path: '/search',
        method: 'POST',
      },
    },
    {
      name: 'getUser',
      description: 'Get a specific user by ID',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: 'The user ID',
          },
        },
        required: ['userId'],
      },
      execution: {
        path: '/users/{userId}',
        method: 'GET',
      },
    },
    {
      name: 'listUsers',
      description: 'List all users in the workspace',
      parameters: {
        type: 'object',
        properties: {
          startCursor: {
            type: 'string',
            description: 'Pagination cursor',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results (max 100)',
          },
        },
      },
      execution: {
        path: '/users',
        method: 'GET',
      },
    },
  ],
};
