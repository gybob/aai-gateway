import { describe, it, expect, beforeEach, vi, useFakeTimers } from 'vitest';
import { SimpleCache } from '@/storage/cache';

describe('SimpleCache', () => {
  let cache: SimpleCache<string>;

  beforeEach(() => {
    cache = new SimpleCache<string>(1000); // 1 second TTL for tests
    vi.useRealTimers();
  });

  describe('get()', () => {
    it('should return null for non-existent key', () => {
      const value = cache.get('non-existent');
      expect(value).toBeNull();
    });

    it('should return cached value', () => {
      cache.set('test-key', 'test-value');
      const value = cache.get('test-key');
      expect(value).toBe('test-value');
    });

    it('should return null for expired entry', () => {
      vi.useFakeTimers();
      cache.set('test-key', 'test-value');
      vi.advanceTimersByTime(1500); // Advance past TTL
      const value = cache.get('test-key');
      expect(value).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('set()', () => {
    it('should store value with default TTL', () => {
      cache.set('test-key', 'test-value');
      expect(cache.has('test-key')).toBe(true);
    });

    it('should store value with custom TTL', () => {
      cache.set('test-key', 'test-value', 2000);
      expect(cache.has('test-key')).toBe(true);
    });

    it('should overwrite existing value', () => {
      cache.set('test-key', 'value1');
      cache.set('test-key', 'value2');
      expect(cache.get('test-key')).toBe('value2');
    });
  });

  describe('has()', () => {
    it('should return false for non-existent key', () => {
      expect(cache.has('non-existent')).toBe(false);
    });

    it('should return true for existing key', () => {
      cache.set('test-key', 'test-value');
      expect(cache.has('test-key')).toBe(true);
    });

    it('should return false for expired entry', () => {
      vi.useFakeTimers();
      cache.set('test-key', 'test-value');
      vi.advanceTimersByTime(1500);
      expect(cache.has('test-key')).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('delete()', () => {
    it('should return false for non-existent key', () => {
      const result = cache.delete('non-existent');
      expect(result).toBe(false);
    });

    it('should delete existing key', () => {
      cache.set('test-key', 'test-value');
      const result = cache.delete('test-key');
      expect(result).toBe(true);
      expect(cache.has('test-key')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.size()).toBe(3);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(false);
    });
  });

  describe('cleanup()', () => {
    it('should remove expired entries', () => {
      vi.useFakeTimers();
      cache.set('key1', 'value1', 500);
      cache.set('key2', 'value2', 1500);
      cache.set('key3', 'value3', 2000);

      vi.advanceTimersByTime(1000);

      const removed = cache.cleanup();
      expect(removed).toBe(1);
      expect(cache.size()).toBe(2);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      vi.useRealTimers();
    });

    it('should return 0 if no expired entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const removed = cache.cleanup();
      expect(removed).toBe(0);
    });
  });

  describe('size()', () => {
    it('should return 0 for empty cache', () => {
      expect(cache.size()).toBe(0);
    });

    it('should return number of entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      expect(cache.size()).toBe(3);
    });
  });
});
