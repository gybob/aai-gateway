import type { ToolSchema } from '../types/capabilities.js';

export const ACP_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'session/new',
    description:
      'Create a new ACP session and return a reusable sessionId plus downstream promptCapabilities. Sessions are generally tied to the working directory; if you switch to a different directory, create a new sessionId.',
    inputSchema: {
      type: 'object',
      required: ['cwd'],
      properties: {
        cwd: {
          type: 'string',
          description: 'Absolute working directory for the ACP session.',
        },
      },
    },
  },
  {
    name: 'session/prompt',
    description:
      'Start a turn on an explicit sessionId. This waits up to 30 seconds and returns the current accumulated content plus turn status.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'prompt'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID returned by session/new.',
        },
        prompt: {
          type: 'array',
          description: 'Array of content blocks (e.g., [{"type": "text", "text": "..."}])',
        },
      },
    },
  },
  {
    name: 'session/poll',
    description:
      'Poll the active turn for a sessionId. Prefer turn/poll when you already have the turnId returned by session/prompt.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to poll for completion.',
        },
      },
    },
  },
  {
    name: 'turn/poll',
    description:
      'Poll a running turn by turnId. This waits up to 30 seconds and returns the current accumulated content plus turn status.',
    inputSchema: {
      type: 'object',
      required: ['turnId'],
      properties: {
        turnId: {
          type: 'string',
          description: 'The turn ID returned by session/prompt.',
        },
      },
    },
  },
  {
    name: 'turn/cancel',
    description:
      'Cancel a queued or running turn. Queued turns are cancelled locally; running turns are cancelled downstream via session/cancel.',
    inputSchema: {
      type: 'object',
      required: ['turnId'],
      properties: {
        turnId: {
          type: 'string',
          description: 'The turn ID returned by session/prompt.',
        },
      },
    },
  },
];
