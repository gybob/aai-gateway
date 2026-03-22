import { describe, it, expect, vi } from 'vitest';
import { registerCommands, getCommandRegistry } from '@/cli/commands';
import { ArgumentParser } from '@/cli/parser';
import { createGatewayServer } from '@/mcp/server';
import { createDesktopDiscovery } from '@/discovery';

// Mock dependencies
vi.mock('@/mcp/server', () => ({
  createGatewayServer: vi.fn(),
}));

vi.mock('@/discovery', () => ({
  createDesktopDiscovery: vi.fn(),
}));

describe('Command Registry', () => {
  describe('registerCommands()', () => {
    it('should register commands', () => {
      const parser = new ArgumentParser();
      const registry = registerCommands(parser);

      expect(registry.has('serve')).toBe(true);
      expect(registry.has('scan')).toBe(true);
    });

    it('should define common arguments', () => {
      const parser = new ArgumentParser();
      registerCommands(parser);

      expect(parser.getDefinedNames()).toContain('dev');
    });
  });

  describe('getCommandRegistry()', () => {
    it('should return singleton instance', () => {
      const registry1 = getCommandRegistry();
      const registry2 = getCommandRegistry();
      expect(registry1).toBe(registry2);
    });
  });
});

describe('ServeCommand', () => {
  it('should parse args correctly', async () => {
    const registry = getCommandRegistry();
    const command = registry.get('serve');
    expect(command).toBeDefined();

    const options1 = command?.parse([]);
    expect(options1?.dev).toBe(false);

    const options2 = command?.parse(['--dev']);
    expect(options2?.dev).toBe(true);

    const options3 = command?.parse(['--host', '127.0.0.1', '--port', '8765', '--path', '/mcp']);
    expect(options3?.host).toBe('127.0.0.1');
    expect(options3?.port).toBe(8765);
    expect(options3?.path).toBe('/mcp');
  });

  it('should execute createGatewayServer', async () => {
    const mockServer = { start: vi.fn() };
    vi.mocked(createGatewayServer).mockResolvedValue(mockServer as never);

    const registry = getCommandRegistry();
    const command = registry.get('serve');
    expect(command).toBeDefined();

    await command?.execute({ dev: false });

    expect(createGatewayServer).toHaveBeenCalledWith({ devMode: false });
    expect(mockServer.start).toHaveBeenCalled();
  });
});

describe('ScanCommand', () => {
  it('should parse args correctly', async () => {
    const registry = getCommandRegistry();
    const command = registry.get('scan');
    expect(command).toBeDefined();

    const options = command?.parse(['--dev']);
    expect(options?.dev).toBe(true);
  });

  it('should scan and print results', async () => {
    const mockDiscovery = {
      scan: vi.fn().mockResolvedValue([
        {
          localId: 'test-app',
          descriptor: {
            app: { name: { default: 'Test App' } },
            access: { protocol: 'mcp', config: {} },
            exposure: { keywords: [], summary: 'Test summary' },
          },
          location: '/path/to/app',
        },
      ]),
    };
    vi.mocked(createDesktopDiscovery).mockReturnValue(mockDiscovery as never);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const registry = getCommandRegistry();
    const command = registry.get('scan');
    expect(command).toBeDefined();

    await command?.execute({ dev: false });

    expect(mockDiscovery.scan).toHaveBeenCalledWith({ devMode: false });
    expect(consoleSpy).toHaveBeenCalledWith('test-app');
    expect(consoleSpy).toHaveBeenCalledWith('  Name: Test App');
    expect(consoleSpy).toHaveBeenCalledWith('  Location: /path/to/app');

    consoleSpy.mockRestore();
  });

  it('should print message when no apps found', async () => {
    const mockDiscovery = {
      scan: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createDesktopDiscovery).mockReturnValue(mockDiscovery as never);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const registry = getCommandRegistry();
    const command = registry.get('scan');
    expect(command).toBeDefined();

    await command?.execute({ dev: false });

    expect(consoleSpy).toHaveBeenCalledWith('No desktop descriptors found.');

    consoleSpy.mockRestore();
  });
});
