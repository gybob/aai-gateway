import type { AaiJson, DetailedCapability } from '../types/aai-json.js';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

const ACP_POLL_WAIT_MS = 30_000;

export function generateAcpOperationGuide(
  localId: string,
  descriptor: AaiJson,
  detail: DetailedCapability
): string {
  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const lines: string[] = [];
  const runtime = parseAcpInitialize(detail);

  lines.push(`# ${localizedName}`);
  lines.push('');
  lines.push(
    `Guide tool only. Do not pass \`app:${localId}\` to your platform's Task/subagent API as an agent type.`
  );
  lines.push(`To invoke this ACP agent, call \`aai:exec\` with \`app: "${localId}"\`.`);
  lines.push(`Summary: ${descriptor.exposure.summary}`);
  lines.push('');
  lines.push('## ACP Tools');
  lines.push(
    ...formatAcpToolSection(
      'prompt',
      [
        'Start a new ACP turn using the gateway convenience flow.',
        `The gateway creates or reuses a session, sends \`session/prompt\` downstream, waits up to ${ACP_POLL_WAIT_MS}ms, and returns a turn-scoped polling envelope.`,
        'This tool does not stream upstream. If the turn is still running, the response tells you to call `turn/poll` with the returned `turnId` and `cursor`.',
      ].join(' '),
      buildPromptSchema(false),
      buildPromptResultSchema(),
      {
        app: localId,
        tool: 'prompt',
        args: {
          text: 'Read the repository and explain the main entrypoints.',
        },
      }
    )
  );
  lines.push('');
  lines.push(
    ...formatAcpToolSection(
      'session/new',
      'Create a new ACP session explicitly. Use this when you want to manage `sessionId` yourself before sending prompts.',
      buildSessionNewSchema(),
      buildSessionNewResultSchema(),
      {
        app: localId,
        tool: 'session/new',
        args: {
          title: 'Repository walkthrough',
          cwd: '/absolute/path/to/project',
          mcpServers: [],
        },
      }
    )
  );
  lines.push('');
  lines.push(
    ...formatAcpToolSection(
      'session/prompt',
      [
        'Send a prompt to an ACP session explicitly.',
        `Like \`prompt\`, this waits up to ${ACP_POLL_WAIT_MS}ms and returns a normalized turn result instead of streaming upstream.`,
        'If another turn on the same session is still active, the new turn is queued instead of failing.',
        'If `done` is `false`, keep polling with `turn/poll` until `done` becomes `true`.',
      ].join(' '),
      buildPromptSchema(true),
      buildPromptResultSchema(),
      {
        app: localId,
        tool: 'session/prompt',
        args: {
          sessionId: '<session-id>',
          prompt: [
            {
              type: 'text',
              text: 'Continue the prior analysis and list the remaining risks.',
            },
          ],
        },
      }
    )
  );
  lines.push('');
  lines.push(
    ...formatAcpToolSection(
      'turn/poll',
      [
        'Wait for the next increment from a specific ACP turn using `turnId`.',
        `If the turn is still running when the request arrives, this long-poll waits the full ${ACP_POLL_WAIT_MS}ms window unless the turn finishes earlier.`,
        'The response returns a new `cursor`; pass it back on the next `turn/poll` call to receive only later increments.',
        'For long-running work, after each poll returns, give the user a brief progress summary based on the newly received increment, then issue the next `turn/poll` if more work remains.',
      ].join(' '),
      buildTurnPollSchema(),
      buildPromptResultSchema(),
      {
        app: localId,
        tool: 'turn/poll',
        args: {
          turnId: '<turn-id>',
          cursor: 1,
        },
      }
    )
  );
  lines.push('');
  lines.push(
    ...formatAcpToolSection(
      'turn/cancel',
      'Cancel a queued or running gateway turn. Queued turns are cancelled locally. Running turns forward `session/cancel` downstream.',
      buildTurnCancelSchema(),
      buildTurnCancelResultSchema(),
      {
        app: localId,
        tool: 'turn/cancel',
        args: {
          turnId: '<turn-id>',
        },
      }
    )
  );
  lines.push('');
  lines.push('## Polling Model');
  lines.push(
    `- ` +
      `\`prompt\`, \`session/prompt\`, and \`turn/poll\` each wait at most ${ACP_POLL_WAIT_MS}ms.`
  );
  lines.push(
    `- ` +
      `If a turn is still running, each wait lasts the full ${ACP_POLL_WAIT_MS}ms window unless the turn finishes earlier.`
  );
  lines.push('- They never stream partial output upstream as MCP notifications.');
  lines.push(
    '- `turnId` identifies one gateway turn. `sessionId` remains the reusable ACP conversation id.'
  );
  lines.push('- `cursor` identifies the last increment you have already consumed for that turn.');
  lines.push('- Stop polling only when `done: true`.');
  lines.push(
    '- If `done: false`, use the returned `turnId` and `cursor` with `tool: "turn/poll"`.'
  );
  lines.push(
    '- For long-running turns, turn each poll response into a short user-facing progress summary, then start the next poll if the turn is not done yet.'
  );
  lines.push('');
  lines.push('## Case 1: One-Off Prompt Then Poll');
  lines.push('First request:');
  lines.push('');
  lines.push(
    formatJsonCodeBlock({
      app: localId,
      tool: 'prompt',
      args: {
        text: 'Read the project and explain the main entrypoints.',
      },
    })
  );
  lines.push('');
  lines.push('Possible first response when the turn is still running:');
  lines.push('');
  lines.push(
    formatJsonCodeBlock({
      turnId: '<turn-id>',
      sessionId: '<session-id>',
      cursor: 1,
      done: false,
      status: 'working',
      deltaText: 'I found the main entrypoint in src/index.ts ...',
      outputText:
        'I found the main entrypoint in src/index.ts ...\n\n[AAI Gateway] The downstream ACP agent is still running after waiting 30000ms. Call aai:exec with { app: "' +
        localId +
        '", tool: "turn/poll", args: { turnId: "<turn-id>", cursor: 1 } } to fetch the next increment.',
      pollTool: 'turn/poll',
      pollArgs: { turnId: '<turn-id>', cursor: 1 },
      nextAction: `Call aai:exec with { app: "${localId}", tool: "turn/poll", args: { turnId: "<turn-id>", cursor: 1 } } to fetch the next increment after waiting up to ${ACP_POLL_WAIT_MS}ms.`,
    })
  );
  lines.push('');
  lines.push('Follow-up poll request:');
  lines.push('');
  lines.push(
    formatJsonCodeBlock({
      app: localId,
      tool: 'turn/poll',
      args: {
        turnId: '<turn-id>',
        cursor: 1,
      },
    })
  );
  lines.push('');
  lines.push('Final response when the turn completes:');
  lines.push('');
  lines.push(
    formatJsonCodeBlock({
      turnId: '<turn-id>',
      sessionId: '<session-id>',
      cursor: 2,
      done: true,
      status: 'completed',
      deltaText: 'The remaining important entrypoints are src/mcp/server.ts and src/cli.ts.',
      outputText: 'The remaining important entrypoints are src/mcp/server.ts and src/cli.ts.',
    })
  );
  lines.push('');
  lines.push('## Case 2: Explicit Session Reuse');
  lines.push('Step 1. Create a session:');
  lines.push('');
  lines.push(
    formatJsonCodeBlock({
      app: localId,
      tool: 'session/new',
      args: {
        title: 'Repository walkthrough',
        cwd: '/absolute/path/to/project',
        mcpServers: [],
      },
    })
  );
  lines.push('');
  lines.push('Expected response shape:');
  lines.push('');
  lines.push(
    formatJsonCodeBlock({
      sessionId: '<session-id>',
    })
  );
  lines.push('');
  lines.push('Step 2. Start a turn on that session:');
  lines.push('');
  lines.push(
    formatJsonCodeBlock({
      app: localId,
      tool: 'session/prompt',
      args: {
        sessionId: '<session-id>',
        prompt: [
          {
            type: 'text',
            text: 'Continue the prior discussion and identify the next code changes.',
          },
        ],
      },
    })
  );
  lines.push('');
  lines.push('Step 3. If the response returns `done: false`, keep calling:');
  lines.push('');
  lines.push(
    formatJsonCodeBlock({
      app: localId,
      tool: 'turn/poll',
      args: {
        turnId: '<turn-id>',
        cursor: 1,
      },
    })
  );

  const capabilityLines = summarizeAcpRuntimeCapabilities(runtime);
  if (capabilityLines.length > 0) {
    lines.push('');
    lines.push('## Available Runtime Capabilities');
    lines.push(...capabilityLines.map((line) => `- ${line}`));
  }

  return lines.join('\n');
}

function parseAcpInitialize(detail: DetailedCapability): Record<string, unknown> | null {
  if (detail.title !== 'ACP Agent Details') {
    return null;
  }

  try {
    const parsed = JSON.parse(detail.body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function summarizeAcpRuntimeCapabilities(runtime: Record<string, unknown> | null): string[] {
  if (!runtime) {
    return [];
  }

  const lines: string[] = [];
  const agentCapabilities = asRecord(runtime.agentCapabilities);
  const promptCapabilities = asRecord(agentCapabilities?.promptCapabilities);
  const sessionCapabilities = asRecord(agentCapabilities?.sessionCapabilities);

  const image = asBoolean(promptCapabilities?.image);
  if (image !== null) {
    lines.push(`image input: ${image ? 'supported' : 'not supported'}`);
  }

  const embeddedContext = asBoolean(promptCapabilities?.embeddedContext);
  if (embeddedContext !== null) {
    lines.push(`embedded context: ${embeddedContext ? 'supported' : 'not supported'}`);
  }

  const loadSession = asBoolean(agentCapabilities?.loadSession);
  if (loadSession !== null) {
    lines.push(`load existing session: ${loadSession ? 'supported' : 'not supported'}`);
  }

  const sessionMethods = Object.keys(sessionCapabilities ?? {});
  if (sessionMethods.length > 0) {
    lines.push(`additional session methods: ${sessionMethods.join(', ')}`);
  }

  return lines;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function formatAcpToolSection(
  toolName: string,
  description: string,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>,
  example: Record<string, unknown>
): string[] {
  return [
    `### ${toolName}`,
    description,
    '',
    'Input schema:',
    formatJsonCodeBlock(inputSchema),
    '',
    'Output schema:',
    formatJsonCodeBlock(outputSchema),
    '',
    '`aai:exec` example:',
    formatJsonCodeBlock(example),
  ];
}

function buildSessionNewSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      cwd: {
        type: 'string',
        description: 'Working directory for the ACP session. Defaults to the gateway process cwd.',
      },
      title: {
        type: 'string',
        description: 'Optional human-readable session title.',
      },
      mcpServers: {
        type: 'array',
        description: 'Optional ACP-native mcpServers payload forwarded during session creation.',
        items: {},
      },
    },
  };
}

function buildSessionNewResultSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['sessionId'],
    properties: {
      sessionId: {
        type: 'string',
        description: 'ACP session id. Reuse it with `session/prompt` for conversation continuity.',
      },
    },
  };
}

function buildPromptSchema(includeSessionId: boolean): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      ...(includeSessionId
        ? {
            sessionId: {
              type: 'string',
              description: 'ACP session id. Required for explicit session control.',
            },
          }
        : {}),
      text: {
        type: 'string',
        description: 'Simple text shortcut. The gateway converts it into ACP prompt blocks.',
      },
      message: {
        type: 'string',
        description: 'Alias of `text`.',
      },
      prompt: {
        type: 'array',
        description: 'Explicit ACP prompt content blocks.',
        items: {
          type: 'object',
          additionalProperties: true,
        },
      },
      messageId: {
        type: 'string',
        description: 'Optional client-provided message id. The gateway generates one if omitted.',
      },
      cwd: {
        type: 'string',
        description:
          'Optional working directory used only if the gateway must create a new session first.',
      },
      title: {
        type: 'string',
        description:
          'Optional session title used only if the gateway must create a new session first.',
      },
      mcpServers: {
        type: 'array',
        description:
          'Optional ACP-native mcpServers payload used only if the gateway must create a new session first.',
        items: {},
      },
    },
    anyOf: [{ required: ['text'] }, { required: ['message'] }, { required: ['prompt'] }],
  };
}

function buildTurnPollSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['turnId'],
    properties: {
      turnId: {
        type: 'string',
        description: 'Gateway turn id returned by `prompt` or `session/prompt`.',
      },
      cursor: {
        type: 'integer',
        minimum: 0,
        description: 'Last consumed turn cursor. Omit or use 0 on the first poll.',
      },
    },
  };
}

function buildTurnCancelSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['turnId'],
    properties: {
      turnId: {
        type: 'string',
        description: 'Gateway turn id returned by `prompt` or `session/prompt`.',
      },
    },
  };
}

function buildTurnCancelResultSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['turnId', 'sessionId', 'cancelled', 'done', 'status'],
    properties: {
      turnId: {
        type: 'string',
      },
      sessionId: {
        type: 'string',
      },
      cancelled: {
        type: 'boolean',
      },
      done: {
        type: 'boolean',
      },
      status: {
        type: 'string',
        enum: ['queued', 'working', 'completed', 'failed', 'cancelled'],
      },
      statusMessage: {
        type: 'string',
      },
      error: {
        type: 'string',
      },
    },
  };
}

function buildPromptResultSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['turnId', 'sessionId', 'cursor', 'done', 'status', 'deltaText', 'outputText'],
    properties: {
      turnId: {
        type: 'string',
        description: 'Gateway turn id. Use it with `turn/poll` or `turn/cancel`.',
      },
      sessionId: {
        type: 'string',
        description:
          'ACP session id. Reuse it with `session/prompt` when you want another turn in the same conversation.',
      },
      cursor: {
        type: 'integer',
        minimum: 0,
        description: 'Latest increment cursor included in this response.',
      },
      done: {
        type: 'boolean',
        description: 'Stop polling only when this becomes true.',
      },
      status: {
        type: 'string',
        enum: ['queued', 'working', 'completed', 'failed', 'cancelled'],
        description: 'Latest downstream status currently known to AAI Gateway.',
      },
      statusMessage: {
        type: 'string',
        description: 'Optional latest downstream status message.',
      },
      deltaText: {
        type: 'string',
        description: 'Only the newly available text after the cursor you supplied for this turn.',
      },
      outputText: {
        type: 'string',
        description:
          'Primary human-readable text returned to the caller. When `done` is false, this field ends with the polling instruction.',
      },
      error: {
        type: 'string',
        description: 'Present when the turn failed or was cancelled.',
      },
      pollTool: {
        type: 'string',
        enum: ['turn/poll'],
        description: 'Present when `done` is false.',
      },
      pollArgs: {
        type: 'object',
        description: 'Arguments to reuse on the next poll when `done` is false.',
        properties: {
          turnId: {
            type: 'string',
          },
          cursor: {
            type: 'integer',
            minimum: 0,
          },
        },
      },
      nextAction: {
        type: 'string',
        description: 'Human-readable instruction for the next poll when `done` is false.',
      },
    },
  };
}

function formatJsonCodeBlock(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}
