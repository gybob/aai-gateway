import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CliExecutor, getCliExecutor } from './cli.js';
import type { AaiJson } from '../types/aai-json.js';
import { AaiError } from '../errors/errors.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CliExecutor', () => {
  let executor: CliExecutor;
  let mockSpawn: any;

  const testDescriptor: AaiJson = {
    schemaVersion: '1.0',
    version: '1.0.0',
    platform: 'macos',
    app: {
      id: 'cli-anything.test',
      name: { en: 'Test CLI' },
      description: 'A test CLI tool',
      defaultLang: 'en',
    },
    execution: {
      type: 'cli',
      command: 'test-cli',
    },
    tools: [
      {
        name: 'project_new',
        description: 'Create a new project',
        parameters: { type: 'object', properties: {} },
      },
    ],
  };

  const descriptorWithCustomJsonFlag: AaiJson = {
    ...testDescriptor,
    execution: {
      type: 'cli',
      command: 'test-cli',
      jsonFlag: '--output=json',
    },
  };

  const descriptorWithTimeout: AaiJson = {
    ...testDescriptor,
    execution: {
      type: 'cli',
      command: 'test-cli',
      timeout: 5000,
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    executor = new CliExecutor();
    mockSpawn = vi.mocked((await import('child_process')).spawn);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getCliExecutor', () => {
    it('should return singleton instance', () => {
      const instance1 = getCliExecutor();
      const instance2 = getCliExecutor();
      expect(instance1).toBe(instance2);
    });
  });

  describe('execute', () => {
    it('should execute CLI command and parse JSON output', async () => {
      const mockResult = { success: true, data: 'test' };
      mockSpawn.mockImplementation(() => createMockProcess(0, JSON.stringify(mockResult), ''));

      const result = await executor.execute(testDescriptor, 'project_new', {
        name: 'TestProject',
        width: 1920,
      });

      expect(result).toEqual(mockResult);
      expect(mockSpawn).toHaveBeenCalledWith(
        'test-cli',
        expect.arrayContaining([
          '--json',
          'project_new',
          '--name',
          'TestProject',
          '--width',
          '1920',
        ]),
        expect.any(Object)
      );
    });

    it('should use custom jsonFlag when specified', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0, '{"ok": true}', ''));

      await executor.execute(descriptorWithCustomJsonFlag, 'project_new', {});

      expect(mockSpawn).toHaveBeenCalledWith(
        'test-cli',
        expect.arrayContaining(['--output=json', 'project_new']),
        expect.any(Object)
      );
    });

    it('should throw on non-zero exit code', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(1, '', 'Error: something went wrong'));

      await expect(executor.execute(testDescriptor, 'project_new', {})).rejects.toThrow(AaiError);
      await expect(executor.execute(testDescriptor, 'project_new', {})).rejects.toThrow(
        /exit code 1/
      );
    });

    it('should throw on invalid JSON output', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0, 'not valid json', ''));

      await expect(executor.execute(testDescriptor, 'project_new', {})).rejects.toThrow(AaiError);
      await expect(executor.execute(testDescriptor, 'project_new', {})).rejects.toThrow(
        /Failed to parse/
      );
    });

    it('should convert camelCase args to kebab-case', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0, '{"ok": true}', ''));

      await executor.execute(testDescriptor, 'project_new', {
        workingDirectory: '/tmp',
        enableFeature: true,
      });

      const callArgs = mockSpawn.mock.calls[0][1];
      expect(callArgs).toContain('--working-directory');
      expect(callArgs).toContain('--enable-feature');
    });

    it('should handle boolean flags', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0, '{"ok": true}', ''));

      await executor.execute(testDescriptor, 'project_new', {
        verbose: true,
        quiet: false,
      });

      const callArgs = mockSpawn.mock.calls[0][1];
      expect(callArgs).toContain('--verbose');
      expect(callArgs).not.toContain('--quiet');
    });

    it('should handle array args', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0, '{"ok": true}', ''));

      await executor.execute(testDescriptor, 'project_new', {
        files: ['a.txt', 'b.txt'],
      });

      const callArgs = mockSpawn.mock.calls[0][1];
      expect(callArgs).toContain('--files');
      expect(callArgs).toContain('a.txt');
      expect(callArgs).toContain('b.txt');
    });

    it('should skip undefined and null args', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0, '{"ok": true}', ''));

      await executor.execute(testDescriptor, 'project_new', {
        name: 'test',
        optional: undefined,
        another: null,
      });

      const callArgs = mockSpawn.mock.calls[0][1];
      expect(callArgs).toContain('--name');
      expect(callArgs).not.toContain('--optional');
      expect(callArgs).not.toContain('--another');
    });

    it('should throw TIMEOUT error on timeout', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess(0, '{"ok": true}', '', 10000);
        return proc;
      });

      await expect(executor.execute(descriptorWithTimeout, 'project_new', {})).rejects.toThrow(
        AaiError
      );
    });

    it('should throw error for non-CLI descriptor', async () => {
      const invalidDescriptor = {
        ...testDescriptor,
        execution: { type: 'http' as const, baseUrl: 'https://api.test.com' },
      };

      await expect(executor.execute(invalidDescriptor, 'project_new', {})).rejects.toThrow(
        'not a CLI application'
      );
    });
  });

  describe('getDescriptor', () => {
    it('should retrieve and parse descriptor via --aai', async () => {
      const mockDescriptor = {
        schemaVersion: '1.0',
        app: { id: 'test.cli', name: { en: 'Test' } },
      };
      mockSpawn.mockImplementation(() => createMockProcess(0, JSON.stringify(mockDescriptor), ''));

      const result = await executor.getDescriptor('test-cli');

      expect(result).toEqual(mockDescriptor);
      expect(mockSpawn).toHaveBeenCalledWith('test-cli', ['--aai'], expect.any(Object));
    });

    it('should throw on non-zero exit code', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(1, '', 'Error: unknown flag'));

      await expect(executor.getDescriptor('test-cli')).rejects.toThrow(AaiError);
    });

    it('should throw on invalid JSON', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0, 'invalid', ''));

      await expect(executor.getDescriptor('test-cli')).rejects.toThrow(AaiError);
    });
  });

  describe('camelToKebab', () => {
    it('should convert camelCase to kebab-case', () => {
      expect(executor['camelToKebab']('workingDirectory')).toBe('working-directory');
      expect(executor['camelToKebab']('enableFeature')).toBe('enable-feature');
      expect(executor['camelToKebab']('simple')).toBe('simple');
    });
  });
});

function createMockProcess(exitCode: number, stdout: string, stderr: string, delay = 0) {
  const listeners: Record<string, Function[]> = {};

  const proc = {
    stdout: {
      on: (event: string, cb: Function) => {
        if (event === 'data') {
          setTimeout(() => cb(Buffer.from(stdout)), delay);
        }
      },
    },
    stderr: {
      on: (event: string, cb: Function) => {
        if (event === 'data') {
          cb(Buffer.from(stderr));
        }
      },
    },
    on: (event: string, cb: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
      if (event === 'close') {
        setTimeout(() => cb(exitCode), delay + 10);
      }
    },
    kill: vi.fn(),
  };

  return proc;
}
