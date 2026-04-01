import type { ToolSchema } from '../types/capabilities.js';

export const ACP_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'session/new',
    description:
      'Create a new persistent session with the agent and get its capabilities. Sessions are tied to the working directory; if you switch directories, create a new session.',
    inputSchema: {
      type: 'object',
      required: ['cwd'],
      properties: {
        cwd: {
          type: 'string',
          description: 'Absolute working directory for the session.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['sessionId', 'promptCapabilities'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'Persistent session ID for subsequent operations.',
        },
        promptCapabilities: {
          type: 'object',
          description: 'Declares what content block types this agent accepts in subsequent turns.',
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'turn/start',
    description:
      'Start a new turn on an existing session. Send a prompt and get a turnId for polling results. Use turn/poll to read the response.',
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
          description:
            'Content blocks for this turn, e.g. [{"type":"text","text":"..."}]. Types must match the session capabilities.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['turnId', 'sessionId', 'state'],
      properties: {
        turnId: {
          type: 'string',
          description: 'Gateway-managed turn ID for polling and cancellation.',
        },
        sessionId: {
          type: 'string',
          description: 'The session this turn belongs to.',
        },
        state: {
          type: 'string',
          enum: ['running'],
          description: 'Initial state indicating the turn was accepted.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'turn/poll',
    description:
      'Poll a turn for incremental output. Waits up to 30 seconds for new content. Returns done=true when the turn finishes.',
    inputSchema: {
      type: 'object',
      required: ['turnId'],
      properties: {
        turnId: {
          type: 'string',
          description: 'The turn ID returned by turn/start.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['turnId', 'sessionId', 'done', 'state', 'content'],
      properties: {
        turnId: {
          type: 'string',
          description: 'Gateway-managed turn ID.',
        },
        sessionId: {
          type: 'string',
          description: 'Session ID that owns this turn.',
        },
        done: {
          type: 'boolean',
          description: 'When true, the turn has finished. Stop polling.',
        },
        state: {
          type: 'string',
          enum: ['running', 'waiting_permission', 'completed', 'failed', 'cancelled'],
          description: 'Turn lifecycle state managed by the gateway.',
        },
        message: {
          type: 'string',
          description: 'Human-readable explanation of the current state.',
        },
        content: {
          type: 'array',
          description:
            'New incremental content blocks produced since the last poll. Empty if no new content yet.',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
        permissionRequests: {
          type: 'array',
          description:
            'Present only when state=waiting_permission. Permission requests from the agent. Respond to each via turn/respondPermission.',
          items: {
            type: 'object',
            required: ['permissionId', 'title', 'options'],
            properties: {
              permissionId: {
                type: 'string',
                description: 'Opaque permission request ID.',
              },
              title: {
                type: 'string',
                description: 'Short title describing what the agent wants to do.',
              },
              description: {
                type: 'string',
                description: 'Optional user-facing detail for the permission request.',
              },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'label'],
                  properties: {
                    id: {
                      type: 'string',
                      description: 'Option ID to pass in turn/respondPermission.decision.optionId.',
                    },
                    label: {
                      type: 'string',
                      description: 'User-facing permission option label.',
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        stopReason: {
          type: ['string', 'null'],
          description: 'Why the turn stopped. Present when done=true.',
        },
        error: {
          type: ['object', 'null'],
          description: 'Present only when state=failed.',
          required: ['code', 'message'],
          properties: {
            code: {
              type: 'string',
            },
            message: {
              type: 'string',
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'turn/respondPermission',
    description:
      'Respond to a permission request that was surfaced during polling. Use the permissionId and one of the listed option IDs.',
    inputSchema: {
      type: 'object',
      required: ['turnId', 'permissionId', 'decision'],
      properties: {
        turnId: {
          type: 'string',
          description: 'The turn ID returned by turn/start.',
        },
        permissionId: {
          type: 'string',
          description: 'The permission request ID returned by turn/poll.',
        },
        decision: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: ['select', 'cancel'],
              description: 'Use select to choose an option, or cancel to reject the request.',
            },
            optionId: {
              type: 'string',
              description:
                'Required when type=select. Must match one of the permissionRequest.options[].id.',
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      required: ['turnId', 'accepted'],
      properties: {
        turnId: {
          type: 'string',
        },
        accepted: {
          type: 'boolean',
          description:
            'True when the response was accepted and forwarded. False if the permission expired or the turn finished.',
        },
        reason: {
          type: 'string',
          enum: ['expired', 'turn_finished'],
          description: 'Present when accepted=false. Why the response was not forwarded.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'turn/cancel',
    description:
      'Cancel a queued or running turn. Queued turns are cancelled immediately; running turns are cancelled by the agent.',
    inputSchema: {
      type: 'object',
      required: ['turnId'],
      properties: {
        turnId: {
          type: 'string',
          description: 'The turn ID returned by turn/start.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['turnId', 'accepted'],
      properties: {
        turnId: {
          type: 'string',
        },
        accepted: {
          type: 'boolean',
          description: 'True when the cancellation was accepted.',
        },
      },
      additionalProperties: false,
    },
  },
];
