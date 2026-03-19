/**
 * Base interface for all registry items
 */
export interface RegistryItem {
  id: string;
  updatedAt: string;
}

/**
 * Generic registry interface
 * Provides CRUD operations for registry items
 */
export interface Registry<T extends RegistryItem> {
  /** List all items in the registry */
  list(): Promise<T[]>;

  /** Get a single item by ID */
  get(id: string): Promise<T | null>;

  /** Insert or update an item */
  upsert(item: T): Promise<T>;

  /** Delete an item by ID */
  delete(id: string): Promise<boolean>;
}

/**
 * Cache entry with expiration
 */
export interface CacheEntry<T> {
  key: string;
  value: T;
  expiresAt: number;
}
