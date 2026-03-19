import { loadManagedDescriptors } from '../../storage/managed-registry.js';
import type { RuntimeAppRecord } from '../../types/aai-json.js';
import type { DiscoveryOptions, DiscoverySource } from '../../types/discovery.js';

/**
 * Managed Discovery Source
 *
 * Discovers apps from gateway-managed directories (imported MCP servers, skills, etc.).
 */
export class ManagedDiscoverySource implements DiscoverySource {
  readonly name = 'managed';
  readonly priority = 80; // Medium priority

  async scan(_options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    // Managed descriptors don't use options, but we accept it for consistency
    return loadManagedDescriptors();
  }

  shouldCache(): boolean {
    return true; // Managed descriptors don't change frequently
  }

  getCacheKey(): string {
    return `discovery:managed`;
  }
}
