import type { AgentDescriptor } from '../../agent-registry.js';

/**
 * Gemini CLI Agent Descriptor
 *
 * Google's Gemini CLI coding agent.
 * https://github.com/google-gemini/gemini-cli
 */
export const geminiCliDescriptor: AgentDescriptor = {
  id: 'com.google.gemini-cli',
  name: {
    en: 'Gemini CLI',
    'zh-CN': 'Gemini CLI',
  },
  defaultLang: 'en',
  description: "Google's Gemini CLI coding agent",
  aliases: ['gemini', 'gemini-cli', 'google'],
  start: {
    command: 'gemini',
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
        },
      },
    },
    {
      name: 'session/prompt',
      description: 'Send a prompt to Gemini in an active session',
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
      description: 'Cancel ongoing operation',
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
