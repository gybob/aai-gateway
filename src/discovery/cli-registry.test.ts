import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanCliTools, lookupCliToolByAlias, type DiscoveredCliTool } from './cli-registry.js';
import type { AaiJson } from '../types/aai-json.js';

const mockGetDescriptor = vi.fn();

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock('../executors/cli.js', () => ({
  getCliExecutor: () => ({
    getDescriptor: mockGetDescriptor,
  }),
}));

vi.mock('../utils/locale.js', () => ({
  getSystemLocale: () => 'en',
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CliRegistry', () => {
  let mockReaddir: any;
  let mockAccess: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const fs = await import('node:fs/promises');
    mockReaddir = vi.mocked(fs.readdir);
    mockAccess = vi.mocked(fs.access);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('scanCliTools', () => {
    it('should discover CLI tools matching pattern', async () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '/usr/bin:/usr/local/bin';

      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir === '/usr/bin') {
          return ['cli-anything-gimp', 'other-tool', 'cli-anything-blender'];
        }
        if (dir === '/usr/local/bin') {
          return ['another-tool'];
        }
        return [];
      });

      const gimpDescriptor: AaiJson = {
        schemaVersion: '1.0',
        version: '1.0.0',
        platform: 'macos',
        app: {
          id: 'cli-anything.gimp',
          name: { en: 'GIMP CLI' },
          description: 'GIMP',
          defaultLang: 'en',
        },
        execution: { type: 'cli', command: 'cli-anything-gimp' },
        tools: [],
      };

      const blenderDescriptor: AaiJson = {
        schemaVersion: '1.0',
        version: '1.0.0',
        platform: 'macos',
        app: {
          id: 'cli-anything.blender',
          name: { en: 'Blender CLI' },
          description: 'Blender',
          defaultLang: 'en',
        },
        execution: { type: 'cli', command: 'cli-anything-blender' },
        tools: [],
      };

      mockGetDescriptor
        .mockResolvedValueOnce(gimpDescriptor)
        .mockResolvedValueOnce(blenderDescriptor);

      const tools = await scanCliTools();

      expect(tools).toHaveLength(2);
      expect(tools[0].appId).toBe('cli-anything.gimp');
      expect(tools[1].appId).toBe('cli-anything.blender');

      process.env.PATH = originalPath;
    });

    it('should handle Windows .exe extension', async () => {
      const originalPlatform = process.platform;
      const originalPath = process.env.PATH;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.PATH = 'C:\\Program Files\\Test';

      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['cli-anything-gimp.exe', 'other.exe']);

      const descriptor: AaiJson = {
        schemaVersion: '1.0',
        version: '1.0.0',
        platform: 'windows',
        app: {
          id: 'cli-anything.gimp',
          name: { en: 'GIMP CLI' },
          description: 'GIMP',
          defaultLang: 'en',
        },
        execution: { type: 'cli', command: 'cli-anything-gimp' },
        tools: [],
      };

      mockGetDescriptor.mockResolvedValue(descriptor);

      const tools = await scanCliTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].command).toBe('cli-anything-gimp');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
      process.env.PATH = originalPath;
    });

    it('should skip tools that fail descriptor retrieval', async () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '/usr/bin';

      mockAccess.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['cli-anything-gimp', 'cli-anything-broken']);

      const gimpDescriptor: AaiJson = {
        schemaVersion: '1.0',
        version: '1.0.0',
        platform: 'macos',
        app: {
          id: 'cli-anything.gimp',
          name: { en: 'GIMP CLI' },
          description: 'GIMP',
          defaultLang: 'en',
        },
        execution: { type: 'cli', command: 'cli-anything-gimp' },
        tools: [],
      };

      mockGetDescriptor
        .mockResolvedValueOnce(gimpDescriptor)
        .mockRejectedValueOnce(new Error('Failed to get descriptor'));

      const tools = await scanCliTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].appId).toBe('cli-anything.gimp');

      process.env.PATH = originalPath;
    });

    it('should handle inaccessible directories', async () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '/nonexistent:/usr/bin';

      mockAccess.mockImplementation(async (dir: string) => {
        if (dir === '/nonexistent') {
          throw new Error('ENOENT');
        }
        return undefined;
      });
      mockReaddir.mockResolvedValue([]);

      const tools = await scanCliTools();

      expect(tools).toHaveLength(0);

      process.env.PATH = originalPath;
    });

    it('should return empty array when PATH is not set', async () => {
      const originalPath = process.env.PATH;
      delete process.env.PATH;

      const tools = await scanCliTools();

      expect(tools).toHaveLength(0);

      process.env.PATH = originalPath;
    });
  });

  describe('lookupCliToolByAlias', () => {
    const mockTools: DiscoveredCliTool[] = [
      {
        appId: 'cli-anything.gimp',
        name: 'GIMP CLI',
        description: 'Image editing',
        descriptor: {
          schemaVersion: '1.0',
          version: '1.0.0',
          platform: 'macos',
          app: {
            id: 'cli-anything.gimp',
            name: { en: 'GIMP CLI' },
            description: 'Image editing',
            defaultLang: 'en',
            aliases: ['gimp', 'image-editor'],
          },
          execution: { type: 'cli', command: 'cli-anything-gimp' },
          tools: [],
        },
        command: 'cli-anything-gimp',
        commandPath: '/usr/bin/cli-anything-gimp',
      },
    ];

    it('should find tool by app ID', () => {
      const result = lookupCliToolByAlias(mockTools, 'cli-anything.gimp');
      expect(result).toBe(mockTools[0]);
    });

    it('should find tool by command name', () => {
      const result = lookupCliToolByAlias(mockTools, 'cli-anything-gimp');
      expect(result).toBe(mockTools[0]);
    });

    it('should find tool by alias', () => {
      const result = lookupCliToolByAlias(mockTools, 'gimp');
      expect(result).toBe(mockTools[0]);
    });

    it('should find tool by localized name', () => {
      const result = lookupCliToolByAlias(mockTools, 'gimp cli');
      expect(result).toBe(mockTools[0]);
    });

    it('should be case-insensitive', () => {
      const result = lookupCliToolByAlias(mockTools, 'GIMP');
      expect(result).toBe(mockTools[0]);
    });

    it('should return null when not found', () => {
      const result = lookupCliToolByAlias(mockTools, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('DiscoveredCliTool type', () => {
    it('should have correct structure', () => {
      const descriptor: AaiJson = {
        schemaVersion: '1.0',
        version: '1.0.0',
        platform: 'macos',
        app: {
          id: 'cli-anything.test',
          name: { en: 'Test CLI' },
          description: 'A test CLI',
          defaultLang: 'en',
        },
        execution: {
          type: 'cli',
          command: 'cli-anything-test',
        },
        tools: [],
      };

      const tool: DiscoveredCliTool = {
        appId: 'cli-anything.test',
        name: 'Test CLI',
        description: 'A test CLI',
        descriptor,
        command: 'cli-anything-test',
        commandPath: '/usr/bin/cli-anything-test',
      };

      expect(tool.appId).toBe('cli-anything.test');
      expect(tool.command).toBe('cli-anything-test');
      expect(tool.commandPath).toBe('/usr/bin/cli-anything-test');
      expect(tool.descriptor.execution.type).toBe('cli');
    });
  });
});
