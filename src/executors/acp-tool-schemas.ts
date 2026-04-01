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
    outputSchema: {
      type: 'object',
      required: ['sessionId', 'promptCapabilities'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'Reusable ACP session ID returned by the downstream agent.',
        },
        promptCapabilities: {
          type: 'object',
          description:
            'Downstream prompt capability declaration. Use this to decide which content block types turn/start.prompt may contain.',
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'turn/start',
    description:
      'Start a new turn on an explicit sessionId. The prompt content must match the promptCapabilities returned by session/new. This returns immediately with a turnId; call turn/poll to read output or permission requests.',
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
            'ACP content blocks for this turn, for example [{"type":"text","text":"..."}]. Allowed block types are determined by session/new.promptCapabilities.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['turnId', 'sessionId', 'state'],
      properties: {
        turnId: {
          type: 'string',
          description: 'Gateway-managed turn ID used for turn/poll, turn/respondPermission, and turn/cancel.',
        },
        sessionId: {
          type: 'string',
          description: 'The ACP session ID this turn belongs to.',
        },
        state: {
          type: 'string',
          enum: ['running'],
          description: 'Initial gateway turn state after the turn has been accepted.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'turn/poll',
    description:
      'Poll a turn by turnId. This waits up to 30 seconds and returns unread incremental content plus the gateway-defined turn state. If done=true, stop polling.',
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
          description: 'ACP session ID that owns this turn.',
        },
        done: {
          type: 'boolean',
          description: 'When true, the turn has finished and polling should stop.',
        },
        state: {
          type: 'string',
          enum: ['running', 'waiting_permission', 'completed', 'failed', 'cancelled'],
          description:
            'Gateway-defined turn lifecycle state. This is not the downstream tool/task status reported in session/update.',
        },
        message: {
          type: 'string',
          description: 'Optional human-readable explanation of the current gateway turn state.',
        },
        content: {
          type: 'array',
          description:
            'Unread incremental ACP content blocks produced since the last turn/poll call. Empty means there is no new content yet.',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
        permissionRequests: {
          type: 'array',
          description:
            'Present only when state=waiting_permission. Each entry is a separate permission request from the downstream agent. Respond to each via turn/respondPermission.',
          items: {
            type: 'object',
            required: ['permissionId', 'title', 'options'],
            properties: {
              permissionId: {
                type: 'string',
                description: 'Opaque gateway permission request ID.',
              },
              title: {
                type: 'string',
                description: 'Short title describing what the downstream agent wants to do.',
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
                      description: 'Option ID to pass back in turn/respondPermission.decision.optionId.',
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
          description:
            'Downstream ACP stopReason returned by session/prompt when the turn has completed.',
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
      'Respond to a downstream ACP session/request_permission request that was surfaced by turn/poll. Use the permissionId and one of the listed option IDs, or cancel the request.',
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
          description: 'The opaque permission request ID returned by turn/poll.',
        },
        decision: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: ['select', 'cancel'],
              description:
                'Use select to choose one of the supplied permission options, or cancel to reject the request and stop waiting.',
            },
            optionId: {
              type: 'string',
              description:
                'Required when decision.type=select. Must match one of permissionRequest.options[].id from turn/poll.',
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
            'True when the permission response was accepted by the gateway and forwarded downstream. False if the permission expired or the turn already finished.',
        },
        reason: {
          type: 'string',
          enum: ['expired', 'turn_finished'],
          description: 'Present when accepted=false. Indicates why the permission response was not forwarded.',
        },
      },
      additionalProperties: false,
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
          description: 'True when the cancellation request was accepted by the gateway.',
        },
      },
      additionalProperties: false,
    },
  },
];
