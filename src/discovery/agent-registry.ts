import type { RuntimeAppRecord } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';

import { evaluateDescriptorAvailability, type DiscoveryCheckResult } from './checks.js';

export interface DiscoveredAgent extends RuntimeAppRecord {
  commandPath: string;
}

interface DescriptorModule {
  appId: string;
  descriptor: RuntimeAppRecord['descriptor'];
}

/**
 * Scan descriptors directory and load all builtin agents dynamically.
 * Files should export `appId` and `descriptor`.
 */
async function loadBuiltinAgents(): Promise<DescriptorModule[]> {
  // Dynamic import all files in descriptors directory
  const modules = import.meta.glob('./descriptors/*-agent.ts', { eager: true });
  
  const agents: DescriptorModule[] = [];
  
  for (const [path, mod] of Object.entries(modules)) {
    const module = mod as DescriptorModule;
    if (module.appId && module.descriptor) {
      agents.push({
        appId: module.appId,
        descriptor: module.descriptor,
      });
      logger.debug({ path, appId: module.appId }, 'Loaded builtin agent descriptor');
    } else {
      logger.warn({ path }, 'Descriptor module missing appId or descriptor export');
    }
  }
  
  return agents;
}

export async function scanInstalledAgents(): Promise<DiscoveredAgent[]> {
  const builtinAgents = await loadBuiltinAgents();
  const discovered: DiscoveredAgent[] = [];

  for (const candidate of builtinAgents) {
    const result: DiscoveryCheckResult = await evaluateDescriptorAvailability(candidate.descriptor);
    if (!result.available) {
      continue;
    }

    discovered.push({
      appId: candidate.appId,
      descriptor: candidate.descriptor,
      source: 'acp-agent',
      commandPath: result.location ?? '',
      location: result.location ?? undefined,
    });

    logger.info({ appId: candidate.appId, commandPath: result.location }, 'ACP agent discovered');
  }

  return discovered;
}
