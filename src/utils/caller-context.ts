import type { CallerContext } from '../types/caller.js';

import { deriveCallerId } from '../storage/agent-state.js';

export function createMcpCallerContext(
  clientVersion: { name?: string; version?: string } | undefined
): CallerContext {
  const name = clientVersion?.name?.trim() || 'Unknown Client';
  return {
    id: deriveCallerId({ callerName: name }),
    name,
    version: clientVersion?.version,
    transport: 'mcp',
    type: 'unknown',
  };
}

export function createCliCallerContextFromEnv(): CallerContext {
  const name = process.env.AAI_GATEWAY_CALLER_NAME?.trim() || 'AAI Gateway Skill';
  const type = normalizeCallerType(process.env.AAI_GATEWAY_CALLER_TYPE);
  return {
    id: deriveCallerId({
      callerId: process.env.AAI_GATEWAY_CALLER_ID,
      callerName: name,
    }),
    name,
    transport: 'skill-cli',
    type,
    skillDir: process.env.AAI_GATEWAY_SKILL_DIR?.trim() || undefined,
  };
}

function normalizeCallerType(value: string | undefined): CallerContext['type'] {
  switch (value) {
    case 'codex':
    case 'claude-code':
    case 'opencode':
      return value;
    default:
      return 'unknown';
  }
}
