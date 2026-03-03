import type { AaiJson } from '../../types/aai-json.js';

/**
 * Feishu (飞书) / Lark app descriptor
 *
 * Auth: App Credential (tenantAccessToken)
 * - Get App ID and App Secret from: https://open.feishu.cn/app
 * - Token expires in 2 hours, auto-refreshed by CredentialManager
 */
export const feishuDescriptor: AaiJson = {
  schemaVersion: '1.0',
  version: '1.0.0',
  platform: 'web',
  app: {
    id: 'com.feishu.api',
    name: {
      en: 'Feishu',
      'zh-CN': '飞书',
    },
    defaultLang: 'en',
    description:
      'Feishu/Lark is an enterprise collaboration platform with docs, wiki, sheets, and more. Aliases: 飞书, feishu, lark, larksuite, 协作, 企业协作.',
    aliases: ['飞书', 'feishu', 'lark', 'larksuite', '协作', '企业协作'],
  },
  execution: {
    type: 'http',
    baseUrl: 'https://open.feishu.cn/open-apis',
    defaultHeaders: {
      'Content-Type': 'application/json',
    },
  },
  auth: {
    type: 'appCredential',
    appCredential: {
      tokenEndpoint: 'https://open.feishu.cn/open-apis/auth/v3/tenantAccessToken/internal',
      tokenType: 'tenantAccessToken',
      expiresIn: 7200, // 2 hours
      instructions: {
        short: 'Get your App ID and App Secret from Feishu Open Platform',
        detailed: `1. Go to https://open.feishu.cn/app
2. Create or select an app
3. Go to "凭证与基础信息" (Credentials & Basic Info)
4. Copy the App ID and App Secret
5. Make sure the app has the required permissions enabled
6. Paste them here`,
        helpUrl: 'https://open.feishu.cn/app',
      },
    },
  },
  tools: [
    {
      name: 'getUserInfo',
      description: 'Get current user information by userId or openId',
      parameters: {
        type: 'object',
        properties: {
          userIdType: {
            type: 'string',
            description: 'User ID type: openId, unionId, userId',
            enum: ['openId', 'unionId', 'userId'],
          },
          userId: {
            type: 'string',
            description: 'The user ID',
          },
        },
        required: ['userId'],
      },
      execution: {
        path: '/contact/v3/users/{userId}',
        method: 'GET',
      },
    },
    {
      name: 'getUserByPhone',
      description: 'Get user by phone number',
      parameters: {
        type: 'object',
        properties: {
          mobiles: {
            type: 'array',
            description: 'Phone numbers to search',
            items: { type: 'string' },
          },
        },
        required: ['mobiles'],
      },
      execution: {
        path: '/user/v1/getByPhone',
        method: 'POST',
      },
    },
    {
      name: 'listDocs',
      description: 'List docs accessible to the app',
      parameters: {
        type: 'object',
        properties: {
          folderToken: {
            type: 'string',
            description: 'Folder token (empty for root)',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results (max 50)',
          },
          pageToken: {
            type: 'string',
            description: 'Pagination token',
          },
        },
      },
      execution: {
        path: '/drive/v1/metas',
        method: 'GET',
      },
    },
    {
      name: 'getDoc',
      description: 'Get doc metadata and content',
      parameters: {
        type: 'object',
        properties: {
          docToken: {
            type: 'string',
            description: 'The document token',
          },
        },
        required: ['docToken'],
      },
      execution: {
        path: '/docx/v1/documents/{docToken}',
        method: 'GET',
      },
    },
    {
      name: 'createDoc',
      description: 'Create a new document',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Document title',
          },
          folderToken: {
            type: 'string',
            description: 'Parent folder token',
          },
        },
        required: ['title'],
      },
      execution: {
        path: '/docx/v1/documents',
        method: 'POST',
      },
    },
    {
      name: 'getWikiSpaceList',
      description: 'List wiki spaces accessible to the app',
      parameters: {
        type: 'object',
        properties: {
          pageSize: {
            type: 'number',
            description: 'Number of results (max 50)',
          },
          pageToken: {
            type: 'string',
            description: 'Pagination token',
          },
        },
      },
      execution: {
        path: '/wiki/v2/spaces',
        method: 'GET',
      },
    },
    {
      name: 'getWikiNode',
      description: 'Get wiki node info',
      parameters: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Wiki node token',
          },
        },
        required: ['token'],
      },
      execution: {
        path: '/wiki/v2/spaces/getNode',
        method: 'GET',
      },
    },
    {
      name: 'getWikiNodeChildren',
      description: 'List child nodes of a wiki node',
      parameters: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Parent node token',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results (max 50)',
          },
          pageToken: {
            type: 'string',
            description: 'Pagination token',
          },
        },
        required: ['token'],
      },
      execution: {
        path: '/wiki/v2/spaces/{token}/children',
        method: 'GET',
      },
    },
    {
      name: 'sendMessage',
      description: 'Send a message to a chat',
      parameters: {
        type: 'object',
        properties: {
          receiveIdType: {
            type: 'string',
            description: 'ID type: openId, userId, unionId, email, chatId',
            enum: ['openId', 'userId', 'unionId', 'email', 'chatId'],
          },
          receiveId: {
            type: 'string',
            description: 'Recipient ID',
          },
          msgType: {
            type: 'string',
            description: 'Message type: text, post, image, etc.',
            enum: ['text', 'post', 'image', 'file', 'audio', 'media', 'sticker', 'interactive'],
          },
          content: {
            type: 'string',
            description: 'Message content (JSON string for complex types)',
          },
        },
        required: ['receiveIdType', 'receiveId', 'msgType', 'content'],
      },
      execution: {
        path: '/im/v1/messages',
        method: 'POST',
      },
    },
    {
      name: 'getChatList',
      description: 'List chats the bot is in',
      parameters: {
        type: 'object',
        properties: {
          pageSize: {
            type: 'number',
            description: 'Number of results (max 50)',
          },
          pageToken: {
            type: 'string',
            description: 'Pagination token',
          },
        },
      },
      execution: {
        path: '/im/v1/chats',
        method: 'GET',
      },
    },
    {
      name: 'getChatInfo',
      description: 'Get chat info',
      parameters: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'Chat ID',
          },
        },
        required: ['chatId'],
      },
      execution: {
        path: '/im/v1/chats/{chatId}',
        method: 'GET',
      },
    },
    {
      name: 'createCalendarEvent',
      description: 'Create a calendar event',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Event title',
          },
          startTime: {
            type: 'object',
            description: 'Start time with date and timezone',
          },
          endTime: {
            type: 'object',
            description: 'End time with date and timezone',
          },
          description: {
            type: 'string',
            description: 'Event description',
          },
          attendees: {
            type: 'array',
            description: 'Attendee list',
            items: { type: 'object' },
          },
        },
        required: ['summary', 'startTime', 'endTime'],
      },
      execution: {
        path: '/calendar/v4/calendars/primary/events',
        method: 'POST',
      },
    },
  ],
};
