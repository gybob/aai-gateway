import { SimpleCache } from '../storage/cache.js';
import type { RuntimeAppRecord } from '../types/aai-json.js';
import type { DiscoveryCacheEntry, DiscoveryOptions, DiscoverySource } from '../types/discovery.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Discovery Manager
 *
 * Manages multiple discovery sources and provides a unified interface for
 * discovering apps from various sources (desktop, agents, managed, etc.).
 *
 * Features:
 * - Multiple discovery sources with priority ordering
 * - Automatic result caching
 * - Forced refresh support
 * - Error handling and logging
 */
export class DiscoveryManager {
  private sources: DiscoverySource[] = [];
  private cache: SimpleCache<DiscoveryCacheEntry>;

  constructor() {
    this.cache = new SimpleCache<DiscoveryCacheEntry>();
  }

  /**
   * Register a discovery source
   * @param source - Discovery source to register
   */
  register(source: DiscoverySource): void {
    this.sources.push(source);
    // Sort by priority (highest first)
    this.sources.sort((a, b) => b.priority - a.priority);
    logger.info({ name: source.name, priority: source.priority }, 'Discovery source registered');
  }

  /**
   * Unregister a discovery source by name
   * @param name - Name of the source to unregister
   */
  unregister(name: string): boolean {
    const index = this.sources.findIndex((s) => s.name === name);
    if (index >= 0) {
      const source = this.sources[index];
      this.sources.splice(index, 1);
      logger.info({ name: source.name }, 'Discovery source unregistered');
      return true;
    }
    return false;
  }

  /**
   * Scan all registered discovery sources
   * @param options - Discovery options
   * @returns Combined list of discovered apps
   */
  async scanAll(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    const allApps: RuntimeAppRecord[] = [];

    for (const source of this.sources) {
      try {
        const apps = await this.scanSource(source, options);
        allApps.push(...apps);
      } catch (err) {
        logger.error({ source: source.name, err }, 'Discovery source scan failed');
      }
    }

    return allApps;
  }

  /**
   * Scan a specific discovery source
   * @param source - Discovery source to scan
   * @param options - Discovery options
   * @returns List of discovered apps
   */
  async scanSource(source: DiscoverySource, options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    const shouldUseCache = !options?.forceRefresh && source.shouldCache();

    // Try to get from cache
    if (shouldUseCache) {
      const cached = this.cache.get(source.getCacheKey());
      if (cached && cached.expiresAt > Date.now()) {
        logger.debug({ source: source.name, count: cached.apps.length }, 'Using cached discovery results');
        return cached.apps;
      }
    }

    // Perform actual scan
    const apps = await source.scan(options);

    // Cache results if needed
    if (shouldUseCache) {
      const cacheEntry: DiscoveryCacheEntry = {
        apps,
        cachedAt: Date.now(),
        expiresAt: Date.now() + DEFAULT_CACHE_TTL,
      };
      this.cache.set(source.getCacheKey(), cacheEntry);
      logger.debug({ source: source.name, count: apps.length }, 'Discovery results cached');
    }

    return apps;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('All discovery caches cleared');
  }

  /**
   * Clear cache for a specific source
   * @param name - Name of the source to clear cache for
   */
  clearSourceCache(name: string): boolean {
    const source = this.sources.find((s) => s.name === name);
    if (source) {
      this.cache.delete(source.getCacheKey());
      logger.info({ source: name }, 'Discovery source cache cleared');
      return true;
    }
    return false;
  }

  /**
   * Get all registered discovery sources
   * @returns Array of registered discovery sources
   */
  getSources(): DiscoverySource[] {
    return [...this.sources];
  }

  /**
   * Force refresh all sources
   * @returns Combined list of discovered apps
   */
  async refreshAll(): Promise<RuntimeAppRecord[]> {
    this.clearCache();
    return this.scanAll({ forceRefresh: true });
  }
}
