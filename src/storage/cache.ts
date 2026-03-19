/**
 * Simple In-Memory Cache
 *
 * A basic cache implementation that stores items in memory with optional expiration.
 *
 * @template T - Type of cached items
 */
export class SimpleCache<T> {
  private cache = new Map<string, { value: T; expiresAt?: number }>();
  private defaultTTL?: number;

  /**
   * Create a new simple cache
   * @param defaultTTL - Default time-to-live in milliseconds for all entries
   */
  constructor(defaultTTL?: number) {
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get an item from the cache
   * @param key - Cache key
   * @returns Cached value or null if not found or expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set an item in the cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Optional time-to-live in milliseconds (overrides default TTL)
   */
  set(key: string, value: T, ttl?: number): void {
    const expiresAt = ttl ? Date.now() + ttl : this.defaultTTL ? Date.now() + this.defaultTTL : undefined;
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Check if a key exists in the cache (and is not expired)
   * @param key - Cache key
   * @returns true if key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete an item from the cache
   * @param key - Cache key
   * @returns true if item was deleted, false if not found
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all items from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries from the cache
   * @returns Number of expired entries removed
   */
  cleanup(): number {
    let removed = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get the number of items in the cache
   * @returns Cache size
   */
  size(): number {
    return this.cache.size;
  }
}
