import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileRegistry } from '@/storage/registry';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RegistryItem } from '@/types/index';

interface TestItem extends RegistryItem {
  name: string;
  value: number;
}

describe('FileRegistry', () => {
  let registry: FileRegistry<TestItem>;
  let testFilePath: string;

  beforeEach(() => {
    const testDir = join(tmpdir(), `test-registry-${Date.now()}`);
    testFilePath = join(testDir, 'registry.json');
    registry = new FileRegistry<TestItem>(testFilePath);
  });

  afterEach(async () => {
    try {
      await rm(join(testFilePath, '..'), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('list()', () => {
    it('should return empty list for new registry', async () => {
      const items = await registry.list();
      expect(items).toEqual([]);
    });

    it('should return all items', async () => {
      const item1: TestItem = {
        id: '1',
        updatedAt: new Date().toISOString(),
        name: 'Item 1',
        value: 100,
      };
      const item2: TestItem = {
        id: '2',
        updatedAt: new Date().toISOString(),
        name: 'Item 2',
        value: 200,
      };

      await registry.upsert(item1);
      await registry.upsert(item2);

      const items = await registry.list();
      expect(items).toHaveLength(2);
      expect(items).toContainEqual(item1);
      expect(items).toContainEqual(item2);
    });
  });

  describe('get()', () => {
    it('should return null for non-existent item', async () => {
      const item = await registry.get('non-existent');
      expect(item).toBeNull();
    });

    it('should return item by ID', async () => {
      const testItem: TestItem = {
        id: 'test-id',
        updatedAt: new Date().toISOString(),
        name: 'Test Item',
        value: 42,
      };

      await registry.upsert(testItem);
      const item = await registry.get('test-id');
      expect(item).toEqual(testItem);
    });
  });

  describe('upsert()', () => {
    it('should insert new item', async () => {
      const testItem: TestItem = {
        id: 'new-item',
        updatedAt: new Date().toISOString(),
        name: 'New Item',
        value: 100,
      };

      const result = await registry.upsert(testItem);
      expect(result).toEqual(testItem);

      const item = await registry.get('new-item');
      expect(item).toEqual(testItem);
    });

    it('should update existing item', async () => {
      const item1: TestItem = {
        id: 'test-id',
        updatedAt: new Date().toISOString(),
        name: 'Original Name',
        value: 100,
      };

      const item2: TestItem = {
        id: 'test-id',
        updatedAt: new Date().toISOString(),
        name: 'Updated Name',
        value: 200,
      };

      await registry.upsert(item1);
      await registry.upsert(item2);

      const item = await registry.get('test-id');
      expect(item).toEqual(item2);
    });

    it('should persist across instances', async () => {
      const testItem: TestItem = {
        id: 'test-id',
        updatedAt: new Date().toISOString(),
        name: 'Test Item',
        value: 42,
      };

      await registry.upsert(testItem);

      // Create new instance with same file path
      const registry2 = new FileRegistry<TestItem>(testFilePath);
      const item = await registry2.get('test-id');
      expect(item).toEqual(testItem);
    });
  });

  describe('delete()', () => {
    it('should return false for non-existent item', async () => {
      const result = await registry.delete('non-existent');
      expect(result).toBe(false);
    });

    it('should delete existing item', async () => {
      const testItem: TestItem = {
        id: 'test-id',
        updatedAt: new Date().toISOString(),
        name: 'Test Item',
        value: 42,
      };

      await registry.upsert(testItem);
      const result = await registry.delete('test-id');
      expect(result).toBe(true);

      const item = await registry.get('test-id');
      expect(item).toBeNull();
    });
  });
});
