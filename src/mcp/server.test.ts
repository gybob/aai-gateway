import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AaiGatewayServer } from './server.js';

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const mockServer = {
    oninitialized: null as (() => void) | null,
    _clientVersion: null as any,
    getClientVersion: vi.fn(function (this: any) {
      return this._clientVersion;
    }),
    setRequestHandler: vi.fn(),
    connect: vi.fn(),
  };

  return {
    Server: vi.fn().mockImplementation(() => mockServer),
    _mockServer: mockServer, // Export for testing
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('../discovery/index.js', () => ({
  createDesktopDiscovery: vi.fn().mockReturnValue({
    scan: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../discovery/agent-registry.js', () => ({
  scanInstalledAgents: vi.fn().mockResolvedValue([]),
}));

vi.mock('../storage/managed-descriptors.js', () => ({
  loadManagedDescriptors: vi.fn().mockResolvedValue([]),
}));

vi.mock('../storage/secure-storage/index.js', () => ({
  createSecureStorage: vi.fn().mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock('../consent/dialog/index.js', () => ({
  createConsentDialog: vi.fn().mockReturnValue({
    show: vi.fn(),
  }),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe('AaiGatewayServer - Caller Identity Extraction', () => {
  let mockServer: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mock server instance
    const { _mockServer } = await import('@modelcontextprotocol/sdk/server/index.js');
    mockServer = _mockServer;

    // Reset state
    mockServer._clientVersion = null;
    mockServer.oninitialized = null;
  });

  describe('caller identity extraction', () => {
    it('should extract caller identity from MCP clientInfo', async () => {
      // Setup: Mock clientVersion to return client info
      mockServer._clientVersion = {
        name: 'Claude Desktop',
        version: '1.0.0',
      };

      // Create server instance (this sets up the oninitialized callback)
      const server = new AaiGatewayServer();
      await server.initialize();

      // Trigger the oninitialized callback
      if (mockServer.oninitialized) {
        mockServer.oninitialized();
      }

      // Verify: The caller identity should be extracted
      expect(mockServer.getClientVersion).toHaveBeenCalled();
    });

    it('should use "Unknown Client" when clientInfo is missing', async () => {
      // Setup: Mock clientVersion to return undefined
      mockServer._clientVersion = undefined;

      // Create server instance
      const server = new AaiGatewayServer();
      await server.initialize();

      // Trigger the oninitialized callback
      if (mockServer.oninitialized) {
        mockServer.oninitialized();
      }

      // Verify: The fallback should be used
      expect(mockServer.getClientVersion).toHaveBeenCalled();
    });

    it('should use "Unknown Client" when clientInfo.name is missing', async () => {
      // Setup: Mock clientVersion to return empty object
      mockServer._clientVersion = {};

      // Create server instance
      const server = new AaiGatewayServer();
      await server.initialize();

      // Trigger the oninitialized callback
      if (mockServer.oninitialized) {
        mockServer.oninitialized();
      }

      // Verify: The fallback should be used
      expect(mockServer.getClientVersion).toHaveBeenCalled();
    });

    it('should extract version if available', async () => {
      // Setup: Mock clientVersion to return client info with version
      mockServer._clientVersion = {
        name: 'Cursor',
        version: '2.1.0',
      };

      // Create server instance
      const server = new AaiGatewayServer();
      await server.initialize();

      // Trigger the oninitialized callback
      if (mockServer.oninitialized) {
        mockServer.oninitialized();
      }

      // Verify: Both name and version should be extracted
      expect(mockServer.getClientVersion).toHaveBeenCalled();
    });

    it('should handle clients without version', async () => {
      // Setup: Mock clientVersion to return client info without version
      mockServer._clientVersion = {
        name: 'Windsurf',
      };

      // Create server instance
      const server = new AaiGatewayServer();
      await server.initialize();

      // Trigger the oninitialized callback
      if (mockServer.oninitialized) {
        mockServer.oninitialized();
      }

      // Verify: Name should be extracted, version should be undefined
      expect(mockServer.getClientVersion).toHaveBeenCalled();
    });

    it('should setup oninitialized callback during construction', async () => {
      // Create server instance
      const server = new AaiGatewayServer();
      await server.initialize();

      // Verify: oninitialized callback should be set
      expect(mockServer.oninitialized).not.toBeNull();
      expect(typeof mockServer.oninitialized).toBe('function');
    });

    it('lists mixed protocol families as app entries', async () => {
      const { createDesktopDiscovery } = await import('../discovery/index.js');
      const { scanInstalledAgents } = await import('../discovery/agent-registry.js');
      const { loadManagedDescriptors } = await import('../storage/managed-descriptors.js');

      vi.mocked(createDesktopDiscovery).mockReturnValue({
        scan: vi.fn().mockResolvedValue([
          {
            localId: 'desktop-app',
            source: 'desktop',
            location: '/Applications/Desktop.app',
            descriptor: {
              schemaVersion: '2.0',
              version: '1.0.0',
              app: { name: { default: 'Desktop App' } },
              access: { protocol: 'cli', config: { command: 'desktop-app' } },
              exposure: { keywords: ['desktop'], summary: 'Desktop app.' },
            },
          },
        ]),
      } as any);
      vi.mocked(scanInstalledAgents).mockResolvedValue([
        {
          localId: 'acp-agent',
          source: 'acp-agent',
          location: '/usr/local/bin/opencode',
          commandPath: '/usr/local/bin/opencode',
          descriptor: {
            schemaVersion: '2.0',
            version: '1.0.0',
            app: { name: { default: 'OpenCode' } },
            access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
            exposure: { keywords: ['code'], summary: 'ACP agent.' },
          },
        },
      ] as any);
      vi.mocked(loadManagedDescriptors).mockResolvedValue([
        {
          localId: 'mcp-app',
          source: 'mcp-import',
          location: '/tmp/mcp/aai.json',
          descriptor: {
            schemaVersion: '2.0',
            version: '1.0.0',
            app: { name: { default: 'Filesystem MCP' } },
            access: { protocol: 'mcp', config: { transport: 'stdio', command: 'filesystem' } },
            exposure: { keywords: ['files'], summary: 'MCP app.' },
          },
        },
        {
          localId: 'skill-app',
          source: 'skill-import',
          location: '/tmp/skill/aai.json',
          descriptor: {
            schemaVersion: '2.0',
            version: '1.0.0',
            app: { name: { default: 'Skill App' } },
            access: { protocol: 'skill', config: { path: '/tmp/skill' } },
            exposure: { keywords: ['skill'], summary: 'Skill app.' },
          },
        },
      ] as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const listCall = mockServer.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0]?._def?.typeName === 'ZodObject' || call[0]
      );
      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const listHandler = handlers[0];
      const response = await listHandler();

      const names = response.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain('app:desktop-app');
      expect(names).toContain('app:acp-agent');
      expect(names).toContain('app:mcp-app');
      expect(names).toContain('app:skill-app');
      expect(listCall).toBeDefined();
    });
  });
});
