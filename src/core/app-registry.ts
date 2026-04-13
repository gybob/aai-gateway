/**
 * App Registry
 *
 * Manages the registry of discovered and imported apps.
 */

import type { RuntimeAppRecord } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';

export class AppRegistry {
  private registry = new Map<string, RuntimeAppRecord>();

  set(appId: string, record: RuntimeAppRecord): void {
    this.registry.set(appId, record);
  }

  get(appId: string): RuntimeAppRecord | undefined {
    return this.registry.get(appId);
  }

  has(appId: string): boolean {
    return this.registry.has(appId);
  }

  delete(appId: string): boolean {
    return this.registry.delete(appId);
  }

  getAll(): RuntimeAppRecord[] {
    return Array.from(this.registry.values());
  }

  values(): IterableIterator<RuntimeAppRecord> {
    return this.registry.values();
  }

  filter(predicate: (record: RuntimeAppRecord) => boolean): RuntimeAppRecord[] {
    return this.getAll().filter(predicate);
  }

  getByProtocol(protocol: string): RuntimeAppRecord[] {
    return this.filter((app) => app.descriptor.access.protocol === protocol);
  }

  get size(): number {
    return this.registry.size;
  }

  async loadFromDiscovery(discoveryFn: () => Promise<RuntimeAppRecord[]>): Promise<number> {
    try {
      const discoveredApps = await discoveryFn();
      // Clear existing entries so removed apps don't linger in memory
      this.registry.clear();
      for (const app of discoveredApps) {
        this.registry.set(app.appId, app);
      }
      logger.info({ count: discoveredApps.length }, 'App registry loaded from discovery');
      return discoveredApps.length;
    } catch (err) {
      logger.error({ err }, 'Failed to load app registry from discovery');
      throw err;
    }
  }
}
