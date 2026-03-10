import type { AgentDescriptor } from '../../agent-registry.js';

/**
 * OpenCode Agent Descriptor
 *
 * Open-source AI coding agent with terminal UI.
 * https://github.com/sst/opencode
 */
export const opencodeDescriptor: AgentDescriptor = {
  id: 'dev.sst.opencode',
  name: {
    en: 'OpenCode',
    'zh-CN': 'OpenCode',
  },
  defaultLang: 'en',
  description: 'Open-source AI coding agent with terminal UI, multi-session support',
  aliases: ['opencode', 'sst', 'code-agent'],
  start: {
    command: 'opencode',
    args: [],
  },
  tools: [
    {
      name: 'session/new',
      description: 'Create a new coding session',
      parameters: {
        type: 'object',
        properties: {
          workingDirectory: {
            type: 'string',
            description: 'Working directory for the session',
          },
          title: {
            type: 'string',
            description: 'Optional session title',
          },
        },
      },
    },
    {
      name: 'session/prompt',
      description: 'Send a prompt to the agent in an active session',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID from session/new',
          },
          message: {
            type: 'string',
            description: 'The prompt message to send',
          },
        },
        required: ['sessionId', 'message'],
      },
    },
    {
      name: 'session/load',
      description: 'Load an existing session',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to load',
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'session/cancel',
      description: 'Cancel ongoing operation in a session',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
        },
        required: ['sessionId'],
      },
    },
  ],
};
