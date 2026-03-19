import type { RuntimeAppRecord } from './aai-json.js';

/**
 * Options for discovery operations
 */
export interface DiscoveryOptions {
  devMode?: boolean;
  forceRefresh?: boolean;
}

/**
 * Interface for a discovery source
 * Each source can discover apps from a specific location or type
 */
export interface DiscoverySource {
  /** Unique name for this discovery source */
  readonly name: string;

  /** Priority for execution order (higher = first) */
  readonly priority: number;

  /** Scan for apps from this source */
  scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]>;

  /** Whether this source should cache results */
  shouldCache(): boolean;

  /** Get cache key for this source */
  getCacheKey(): string;
}

/**
 * Cache entry for discovery results
 */
export interface DiscoveryCacheEntry {
  apps: RuntimeAppRecord[];
  cachedAt: number;
  expiresAt: number;
}
