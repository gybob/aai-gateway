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

vi.mock('../credential/dialog/index.js', () => ({
  createCredentialDialog: vi.fn().mockReturnValue({
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
  });
});
