import { describe, it, expect } from 'vitest';
import type {
  ExecutionResult,
  ExecutorConfig,
  ExecutorDetail,
  DiscoveryOptions,
  DiscoverySource,
  RegistryItem,
  Command,
  CommandOptions,
  ArgumentDef,
} from '@/types/index';

describe('Type Definitions', () => {
  describe('Executor Types', () => {
    it('should accept ExecutionResult type', () => {
      const result: ExecutionResult = {
        success: true,
        data: { test: 'data' },
      };
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ test: 'data' });
    });

    it('should accept ExecutorConfig type', () => {
      const config: ExecutorConfig = {
        command: 'test',
        args: ['--verbose'],
      };
      expect(config.command).toBe('test');
      expect(config.args).toEqual(['--verbose']);
    });

    it('should accept ExecutorDetail type', () => {
      const detail: ExecutorDetail = {
        tools: ['tool1', 'tool2'],
      };
      expect(detail.tools).toEqual(['tool1', 'tool2']);
    });
  });

  describe('Discovery Types', () => {
    it('should accept DiscoveryOptions type', () => {
      const options: DiscoveryOptions = {
        devMode: true,
        forceRefresh: false,
      };
      expect(options.devMode).toBe(true);
      expect(options.forceRefresh).toBe(false);
    });

    it('should accept DiscoverySource interface', () => {
      const source: DiscoverySource = {
        name: 'test-source',
        priority: 10,
        async scan() {
          return [];
        },
        shouldCache() {
          return true;
        },
        getCacheKey() {
          return 'test-key';
        },
      };
      expect(source.name).toBe('test-source');
      expect(source.priority).toBe(10);
    });
  });

  describe('Storage Types', () => {
    it('should accept RegistryItem type', () => {
      const item: RegistryItem = {
        id: 'test-id',
        updatedAt: new Date().toISOString(),
      };
      expect(item.id).toBe('test-id');
      expect(item.updatedAt).toBeTruthy();
    });
  });

  describe('CLI Types', () => {
    it('should accept Command interface', () => {
      const command: Command = {
        name: 'test-command',
        description: 'Test command',
        parse() {
          return { dev: false };
        },
        async execute() {},
      };
      expect(command.name).toBe('test-command');
      expect(command.description).toBe('Test command');
    });

    it('should accept CommandOptions type', () => {
      const options: CommandOptions = {
        dev: false,
        verbose: true,
      };
      expect(options.dev).toBe(false);
    });

    it('should accept ArgumentDef type', () => {
      const argDef: ArgumentDef = {
        name: 'verbose',
        type: 'flag',
        short: 'v',
        description: 'Enable verbose output',
      };
      expect(argDef.name).toBe('verbose');
      expect(argDef.type).toBe('flag');
      expect(argDef.short).toBe('v');
    });
  });
});
