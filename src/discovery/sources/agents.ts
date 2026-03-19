import type { RuntimeAppRecord } from '../../types/aai-json.js';
import type { DiscoveryOptions, DiscoverySource } from '../../types/discovery.js';
import { scanInstalledAgents } from '../agent-registry.js';

/**
 * Agent Discovery Source
 *
 * Discovers ACP agents by checking which ones are installed on the system.
 */
export class AgentDiscoverySource implements DiscoverySource {
  readonly name = 'agents';
  readonly priority = 90; // Medium-high priority

  async scan(_options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    // Agent discovery doesn't use options, but we accept it for consistency
    return scanInstalledAgents();
  }

  shouldCache(): boolean {
    return true; // Agent installation doesn't change frequently
  }

  getCacheKey(): string {
    return `discovery:agents`;
  }
}
