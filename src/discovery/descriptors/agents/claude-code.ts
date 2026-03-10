import type { AgentDescriptor } from '../../agent-registry.js';

/**
 * Claude Code Agent Descriptor
 *
 * Anthropic's official coding agent.
 * https://www.anthropic.com/claude-code
 */
export const claudeCodeDescriptor: AgentDescriptor = {
  id: 'com.anthropic.claude-code',
  name: {
    en: 'Claude Code',
    'zh-CN': 'Claude Code',
  },
  defaultLang: 'en',
  description: "Anthropic's official AI coding agent",
  aliases: ['claude', 'claude-code', 'anthropic'],
  start: {
    command: 'claude',
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
      description: 'Send a prompt to Claude in an active session',
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
