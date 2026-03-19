import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { RegistryItem, Registry } from '../types/index.js';

/**
 * File-based Registry Implementation
 *
 * A generic registry implementation that stores items in a JSON file.
 * All items must extend RegistryItem which requires an id and updatedAt field.
 *
 * @template T - Registry item type (must extend RegistryItem)
 */
export class FileRegistry<T extends RegistryItem> implements Registry<T> {
  private items: T[] = [];
  private filePath: string;

  /**
   * Create a new file registry
   * @param filePath - Path to the registry JSON file
   * @param serializer - Function to serialize items to JSON (optional)
   * @param deserializer - Function to deserialize items from JSON (optional)
   */
  constructor(
    filePath: string,
    private serializer?: (item: T) => Record<string, unknown>,
    private deserializer?: (raw: Record<string, unknown>) => T
  ) {
    this.filePath = filePath;
  }

  /**
   * Load the registry from file
   */
  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as { items?: T[] };

      this.items = [];
      if (Array.isArray(parsed.items)) {
        for (const item of parsed.items) {
          if (this.deserializer) {
            this.items.push(this.deserializer(item as unknown as Record<string, unknown>));
          } else {
            this.items.push(item);
          }
        }
      }
    } catch (err) {
      // File doesn't exist or is invalid, start fresh
      this.items = [];
    }
  }

  /**
   * Save the registry to file
   */
  private async save(): Promise<void> {
    const items = this.items.map((item) =>
      this.serializer ? this.serializer(item) : (item as unknown as Record<string, unknown>)
    );

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify({ items }, null, 2),
      'utf-8'
    );
  }

  /**
   * List all items in the registry
   * @returns Array of all items
   */
  async list(): Promise<T[]> {
    await this.load();
    return [...this.items];
  }

  /**
   * Get a single item by ID
   * @param id - Item ID
   * @returns Item or null if not found
   */
  async get(id: string): Promise<T | null> {
    await this.load();
    return this.items.find((item) => item.id === id) ?? null;
  }

  /**
   * Insert or update an item
   * @param item - Item to insert or update
   * @returns The inserted/updated item
   */
  async upsert(item: T): Promise<T> {
    await this.load();
    const index = this.items.findIndex((existing) => existing.id === item.id);

    if (index >= 0) {
      // Update existing item
      this.items[index] = item;
    } else {
      // Insert new item
      this.items.push(item);
    }

    await this.save();
    return item;
  }

  /**
   * Delete an item by ID
   * @param id - Item ID
   * @returns true if item was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    await this.load();
    const index = this.items.findIndex((item) => item.id === id);

    if (index >= 0) {
      this.items.splice(index, 1);
      await this.save();
      return true;
    }

    return false;
  }
}
