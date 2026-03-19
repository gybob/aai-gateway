import type { CacheEntry } from '../types/index.js';

/**
 * Simple in-memory cache with expiration
 *
 * @template T - Type of values stored in cache
 */
export class SimpleCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private defaultTtl: number;

  /**
   * Create a new cache
   * @param defaultTtl - Default time-to-live in milliseconds
   */
  constructor(defaultTtl: number = 5 * 60 * 1000) {
    // Default: 5 minutes
    this.defaultTtl = defaultTtl;
  }

  /**
   * Get a value from the cache
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time-to-live in milliseconds (uses default if not provided)
   */
  set(key: string, value: T, ttl?: number): void {
    const entry: CacheEntry<T> = {
      key,
      value,
      expiresAt: Date.now() + (ttl ?? this.defaultTtl),
    };
    this.cache.set(key, entry);
  }

  /**
   * Check if a key exists and is not expired
   * @param key - Cache key
   * @returns true if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   * @param key - Cache key
   * @returns true if key was deleted, false if not found
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove all expired entries
   * @returns Number of entries removed
   */
  cleanup(): number {
    let removed = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get the number of entries in the cache
   * @returns Cache size
   */
  size(): number {
    return this.cache.size;
  }
}
