import type { RuntimeAppRecord } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';

import { evaluateDescriptorAvailability } from './checks.js';
import { claudeAcpDescriptor } from './descriptors/claude-code-agent.js';
import { codexAcpDescriptor } from './descriptors/codex-agent.js';
import { opencodeDescriptor } from './descriptors/opencode-agent.js';

interface BuiltinAgent {
  localId: string;
  descriptor: RuntimeAppRecord['descriptor'];
}

export interface DiscoveredAgent extends RuntimeAppRecord {
  commandPath: string;
}

const BUILTIN_AGENTS: BuiltinAgent[] = [
  {
    localId: 'acp-opencode',
    descriptor: opencodeDescriptor,
  },
  {
    localId: 'acp-claude',
    descriptor: claudeAcpDescriptor,
  },
  {
    localId: 'acp-codex',
    descriptor: codexAcpDescriptor,
  },
];

export async function scanInstalledAgents(): Promise<DiscoveredAgent[]> {
  const discovered: DiscoveredAgent[] = [];

  for (const candidate of BUILTIN_AGENTS) {
    const availability = await resolveDiscoveryLocation(candidate.descriptor);
    if (!availability) {
      continue;
    }

    discovered.push({
      localId: candidate.localId,
      descriptor: candidate.descriptor,
      source: 'acp-agent',
      commandPath: availability,
      location: availability,
    });

    logger.info({ localId: candidate.localId, commandPath: availability }, 'ACP agent discovered');
  }

  return discovered;
}

export async function resolveDiscoveryLocation(
  descriptor: RuntimeAppRecord['descriptor']
): Promise<string | null> {
  const availability = await evaluateDescriptorAvailability(descriptor);
  return availability.available ? availability.location : null;
}
