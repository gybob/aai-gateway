import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutorRegistry } from '@/executors/registry';
import type { Executor, ExecutionResult } from '@/types/index';

// Mock executor implementation
class MockExecutor implements Executor<unknown, unknown> {
  readonly protocol: string;
  private connections = new Set<string>();

  constructor(protocol: string) {
    this.protocol = protocol;
  }

  async connect(localId: string): Promise<void> {
    this.connections.add(localId);
  }

  async disconnect(localId: string): Promise<void> {
    this.connections.delete(localId);
  }

  async loadDetail(): Promise<unknown> {
    return { mockDetail: true };
  }

  async execute(
    localId: string,
    _config: unknown,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    if (!this.connections.has(localId)) {
      return {
        success: false,
        error: 'Not connected',
      };
    }
    return {
      success: true,
      data: { operation, args },
    };
  }

  async health(localId: string): Promise<boolean> {
    return this.connections.has(localId);
  }
}

describe('ExecutorRegistry', () => {
  let registry: ExecutorRegistry;
  let mockMcpExecutor: MockExecutor;
  let mockSkillExecutor: MockExecutor;

  beforeEach(() => {
    registry = new ExecutorRegistry();
    mockMcpExecutor = new MockExecutor('mcp');
    mockSkillExecutor = new MockExecutor('skill');
  });

  describe('register()', () => {
    it('should register an executor for a protocol', () => {
      registry.register('mcp', mockMcpExecutor);
      expect(registry.has('mcp')).toBe(true);
    });

    it('should overwrite existing executor', () => {
      const executor1 = new MockExecutor('mcp');
      const executor2 = new MockExecutor('mcp');
      registry.register('mcp', executor1);
      registry.register('mcp', executor2);
      expect(registry.get('mcp')).toBe(executor2);
    });
  });

  describe('get()', () => {
    it('should return registered executor', () => {
      registry.register('mcp', mockMcpExecutor);
      const executor = registry.get('mcp');
      expect(executor).toBe(mockMcpExecutor);
    });

    it('should return undefined for unknown protocol', () => {
      const executor = registry.get('unknown');
      expect(executor).toBeUndefined();
    });
  });

  describe('has()', () => {
    it('should return true for registered protocol', () => {
      registry.register('mcp', mockMcpExecutor);
      expect(registry.has('mcp')).toBe(true);
    });

    it('should return false for unknown protocol', () => {
      expect(registry.has('unknown')).toBe(false);
    });
  });

  describe('execute()', () => {
    beforeEach(() => {
      registry.register('mcp', mockMcpExecutor);
    });

    it('should execute operation via executor', async () => {
      await registry.connect('mcp', 'test-id', {});
      const result = await registry.execute(
        'mcp',
        'test-id',
        {},
        'test-op',
        { arg1: 'value1' }
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        operation: 'test-op',
        args: { arg1: 'value1' },
      });
    });

    it('should throw error for unknown protocol', async () => {
      await expect(
        registry.execute('unknown', 'test-id', {}, 'test-op', {})
      ).rejects.toThrow('Unknown protocol: unknown');
    });
  });

  describe('connect()', () => {
    it('should connect via executor', async () => {
      registry.register('mcp', mockMcpExecutor);
      await registry.connect('mcp', 'test-id', {});
      const isHealthy = await registry.health('mcp', 'test-id');
      expect(isHealthy).toBe(true);
    });

    it('should throw error for unknown protocol', async () => {
      await expect(
        registry.connect('unknown', 'test-id', {})
      ).rejects.toThrow('Unknown protocol: unknown');
    });
  });

  describe('disconnect()', () => {
    it('should disconnect via executor', async () => {
      registry.register('mcp', mockMcpExecutor);
      await registry.connect('mcp', 'test-id', {});
      await registry.disconnect('mcp', 'test-id');
      const isHealthy = await registry.health('mcp', 'test-id');
      expect(isHealthy).toBe(false);
    });
  });

  describe('loadDetail()', () => {
    it('should load detail via executor', async () => {
      registry.register('mcp', mockMcpExecutor);
      const detail = await registry.loadDetail('mcp', {});
      expect(detail).toEqual({ mockDetail: true });
    });
  });

  describe('health()', () => {
    beforeEach(() => {
      registry.register('mcp', mockMcpExecutor);
    });

    it('should return true for healthy connection', async () => {
      await registry.connect('mcp', 'test-id', {});
      const isHealthy = await registry.health('mcp', 'test-id');
      expect(isHealthy).toBe(true);
    });

    it('should return false for unhealthy connection', async () => {
      const isHealthy = await registry.health('mcp', 'test-id');
      expect(isHealthy).toBe(false);
    });
  });
});

describe('getExecutorRegistry()', () => {
  it('should return singleton instance', async () => {
    const { getExecutorRegistry } = await import('@/executors/registry');
    const registry1 = getExecutorRegistry();
    const registry2 = getExecutorRegistry();
    expect(registry1).toBe(registry2);
  });
});
