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
  lines.push(descriptor.exposure.summary);
  lines.push('');
  lines.push('## Execution');
  lines.push('- One-off prompt: `tool: "prompt"` with `args.text` or `args.message`.');
  lines.push(
    '- Explicit session control: `tool: "session/new"` first, then `tool: "session/prompt"` with `args.sessionId`.'
  );
  lines.push(
    '- If `sessionId` is omitted when using `prompt`, the gateway may create or reuse a session automatically.'
  );
  lines.push('- Treat `sessionId` as the ACP conversation handle.');
  lines.push(
    '- Final answer text may arrive through `session/update`; the gateway collects it and returns merged text.'
  );
  lines.push(
    '- During a synchronous `aai:exec` prompt, the gateway forwards `session/update` text upstream as streaming `notifications/message` events.'
  );
  lines.push(
    '- Recommended ACP prompt call shape: `app`, `tool`, and `args`, then consume the streamed `notifications/message` updates plus the final tool response.'
  );
  lines.push('');
  lines.push('## Recommended Calls');
  lines.push(
    `- Use \`aai:exec\` with \`{ app: "${localId}", tool: "prompt", args: { text: "..." } }\` for a one-off prompt.`
  );
  lines.push(
    `- Use \`aai:exec\` with \`{ app: "${localId}", tool: "session/prompt", args: { sessionId: "<session-id>", prompt: [{ type: "text", text: "Continue" }] } }\` to continue an existing ACP session.`
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
