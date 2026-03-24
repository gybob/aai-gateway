import type { AaiJson, DetailedCapability } from '../types/aai-json.js';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

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
  lines.push(...formatAcpToolSection('prompt', getPromptToolDescription(), buildPromptSchema(false), {
    app: localId,
    tool: 'prompt',
    args: {
      text: 'Summarize the current repository structure in 5 bullet points.',
    },
  }));
  lines.push('');
  lines.push(
    ...formatAcpToolSection(
      'session/new',
      'Create a new ACP session explicitly and return a `sessionId` you can reuse in later `session/prompt` calls.',
      buildSessionNewSchema(),
      {
        app: localId,
        tool: 'session/new',
        args: {
          title: 'Repository analysis',
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
      getSessionPromptToolDescription(),
      buildPromptSchema(true),
      {
        app: localId,
        tool: 'session/prompt',
        args: {
          sessionId: '<session-id>',
          prompt: [
            {
              type: 'text',
              text: 'Continue the previous task and include the unresolved risks.',
            },
          ],
        },
      }
    )
  );
  lines.push('');
  lines.push('## Execution Notes');
  lines.push('- `tool: "prompt"` is the convenience wrapper for one-off calls.');
  lines.push(
    '- `tool: "session/new"` then `tool: "session/prompt"` is the explicit reusable-session flow.'
  );
  lines.push(
    '- If `sessionId` is omitted on `prompt`, the gateway may create or reuse a session automatically.'
  );
  lines.push('- Treat `sessionId` as the ACP conversation handle.');
  lines.push(
    '- Final answer text may arrive through `session/update`; the gateway merges that text into the final tool response.'
  );
  lines.push(
    '- During a synchronous `aai:exec` prompt, the gateway also forwards `session/update` text upstream as streaming `notifications/message` events.'
  );
  lines.push('');
  lines.push('## Case 1: One-Off Conversation');
  lines.push('Use the simplified `prompt` tool when you want one request/response turn without managing a session id yourself.');
  lines.push('');
  lines.push(formatJsonCodeBlock({
    app: localId,
    tool: 'prompt',
    args: {
      text: 'Read the project and explain the main entrypoints.',
    },
  }));
  lines.push('');
  lines.push('## Case 2: Reuse A Session');
  lines.push('Step 1. Create a session and keep the returned `sessionId`.');
  lines.push('');
  lines.push(formatJsonCodeBlock({
    app: localId,
    tool: 'session/new',
    args: {
      title: 'Repository walkthrough',
      cwd: '/absolute/path/to/project',
      mcpServers: [],
    },
  }));
  lines.push('');
  lines.push('Step 2. Reuse that `sessionId` in `session/prompt` to continue the same conversation.');
  lines.push('');
  lines.push(formatJsonCodeBlock({
    app: localId,
    tool: 'session/prompt',
    args: {
      sessionId: '<session-id-from-session/new>',
      prompt: [
        {
          type: 'text',
          text: 'Continue from the prior session and propose the next code changes.',
        },
      ],
    },
  }));

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
  schema: Record<string, unknown>,
  example: Record<string, unknown>
): string[] {
  return [
    `### ${toolName}`,
    description,
    '',
    'Arguments:',
    formatJsonCodeBlock(schema),
    '',
    '`aai:exec` example:',
    formatJsonCodeBlock(example),
  ];
}

function getPromptToolDescription(): string {
  return [
    'Start a prompt without managing `sessionId` directly.',
    'The gateway converts `args.text` or `args.message` into ACP prompt blocks, creates or reuses a session behind the scenes, and then sends `session/prompt` upstream.',
  ].join(' ');
}

function getSessionPromptToolDescription(): string {
  return [
    'Send a prompt to an ACP session explicitly.',
    'Use this when you already have a `sessionId` from `session/new` and want to continue the same conversation deterministically.',
  ].join(' ');
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

function buildPromptSchema(includeSessionId: boolean): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      ...(includeSessionId
        ? {
            sessionId: {
              type: 'string',
              description:
                'ACP session id. Recommended for explicit session reuse. If omitted, the gateway may create or reuse a local session.',
            },
          }
        : {}),
      text: {
        type: 'string',
        description: 'Simple text shortcut. The gateway converts it into `prompt` blocks.',
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
    anyOf: [
      { required: ['text'] },
      { required: ['message'] },
      { required: ['prompt'] },
    ],
  };
}

function formatJsonCodeBlock(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}
