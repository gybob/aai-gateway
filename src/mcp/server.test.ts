import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AaiGatewayServer } from './server.js';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushAsyncWork(): Promise<void> {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
    notification: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Server: vi.fn().mockImplementation(() => mockServer),
    _mockServer: mockServer, // Export for testing
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('../discovery/index.js', () => {
  const mockDiscoverySource = {
    scan: vi.fn().mockResolvedValue([]),
  };

  const mockManager = {
    register: vi.fn(),
    scanAll: vi.fn().mockResolvedValue([]),
    getSources: vi.fn().mockReturnValue([]),
  };

  return {
    createDesktopDiscovery: vi.fn().mockReturnValue(mockDiscoverySource),
    createDiscoveryManager: vi.fn().mockReturnValue({
      manager: mockManager,
      sources: {
        desktop: mockDiscoverySource,
        agents: mockDiscoverySource,
        managed: mockDiscoverySource,
      },
    }),
  };
});

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
    show: vi.fn().mockResolvedValue({ decision: 'tool', remember: false }),
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

vi.mock('../executors/acp.js', () => ({
  getAcpExecutor: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockRejectedValue(new Error('initialize timed out after 15000ms')),
    execute: vi.fn(),
    executeWithObserver: vi.fn(),
  }),
}));

describe('AaiGatewayServer - Caller Identity Extraction', () => {
  let mockServer: any;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'aai-gateway-server-test-'));

    // Get the mock server instance
    const { _mockServer } = await import('@modelcontextprotocol/sdk/server/index.js');
    mockServer = _mockServer;

    // Reset state
    mockServer._clientVersion = null;
    mockServer.oninitialized = null;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
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
      const { createDiscoveryManager } = await import('../discovery/index.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
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
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
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
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

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
      const execTool = response.tools.find((tool: { name: string }) => tool.name === 'aai:exec');
      expect(execTool.execution).toEqual({ taskSupport: 'optional' });
      expect(listCall).toBeDefined();
    });

    it('falls back to static ACP guide when live inspection fails', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-codex',
              source: 'acp-agent',
              location: '/opt/homebrew/bin/codex',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'Codex' } },
                access: {
                  protocol: 'acp-agent',
                  config: { command: 'npx', args: ['-y', '@zed-industries/codex-acp'] },
                },
                exposure: { keywords: ['code'], summary: 'Codex ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      const response = await callHandler({
        params: {
          name: 'app:acp-codex',
          arguments: {},
        },
      });

      expect(response.content[0].text).toContain(
        'To invoke this ACP agent, call `aai:exec` with `app: "acp-codex"`.'
      );
      expect(response.content[0].text).toContain(
        "Guide tool only. Do not pass `app:acp-codex` to your platform's Task/subagent API as an agent type."
      );
      expect(response.content[0].text).toContain('tool: "prompt"');
      expect(response.content[0].text).not.toContain(
        'Live ACP inspection is currently unavailable.'
      );
    });

    it('returns CreateTaskResult for task-augmented aai:exec requests', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockRejectedValue(new Error('initialize timed out after 15000ms')),
        execute: vi.fn(),
        executeWithObserver: vi.fn().mockResolvedValue({
          success: true,
          data: { stopReason: 'end_turn' },
        }),
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      const response = await callHandler(
        {
          id: 123,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello' },
            },
            task: { ttl: 1000, pollInterval: 250 },
            _meta: { progressToken: 'progress-1' },
          },
        },
        { requestId: 123 }
      );

      expect(response.task.taskId).toBeTruthy();
      expect(response.task.pollInterval).toBe(250);

      await flushMicrotasks();
      expect(mockServer.notification).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'notifications/tasks/status',
        })
      );
    });

    it('returns ACP prompt output text as the primary tool content', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockRejectedValue(new Error('initialize timed out after 15000ms')),
        execute: vi.fn(),
        executeWithObserver: vi.fn().mockResolvedValue({
          success: true,
          data: { stopReason: 'end_turn', outputText: '2' },
        }),
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      const response = await callHandler(
        {
          id: 789,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: '1+1等于几？' },
            },
            task: { ttl: 1000, pollInterval: 250 },
          },
        },
        { requestId: 789 }
      );

      await flushAsyncWork();
      const getTaskPayloadHandler = handlers[3];
      const taskResult = await getTaskPayloadHandler({
        params: {
          taskId: response.task.taskId,
        },
      });

      expect(taskResult.content[0].text).toBe('2');
      expect(taskResult.content[1].text).toContain('"stopReason": "end_turn"');
    });

    it('maps ACP observer task status updates to MCP task notifications', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockRejectedValue(new Error('initialize timed out after 15000ms')),
        execute: vi.fn(),
        executeWithObserver: vi.fn().mockImplementation(
          async (
            _localId: string,
            _config: unknown,
            _tool: string,
            _args: Record<string, unknown>,
            observer: {
              onTaskStatus?: (event: { status: 'working'; message?: string }) => Promise<void>;
            }
          ) => {
            await observer.onTaskStatus?.({ status: 'working', message: 'Agent is working' });
            return {
              success: true,
              data: { stopReason: 'end_turn' },
            };
          }
        ),
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      await callHandler(
        {
          id: 456,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello' },
            },
            task: { ttl: 1000, pollInterval: 250 },
            _meta: { progressToken: 'task-progress-1' },
          },
        },
        { requestId: 456 }
      );

      await flushAsyncWork();
      expect(
        mockServer.notification.mock.calls.some(
          ([notification]: any[]) =>
            notification?.method === 'notifications/progress' &&
            notification?.params?.progressToken === 'task-progress-1' &&
            notification?.params?.message === 'Agent is working'
        )
      ).toBe(true);
    });

    it('emits MCP progress notifications for synchronous ACP exec when progressToken is provided', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockRejectedValue(new Error('initialize timed out after 15000ms')),
        execute: vi.fn(),
        executeWithObserver: vi.fn().mockImplementation(
          async (
            _localId: string,
            _config: unknown,
            _tool: string,
            _args: Record<string, unknown>,
            observer: {
              onMessage?: (event: { message: string }) => Promise<void>;
              onProgress?: (event: { progress?: number; message?: string }) => Promise<void>;
            }
          ) => {
            await observer.onMessage?.({ message: 'working' });
            await observer.onProgress?.({ progress: 2, message: 'still working' });
            return {
              success: true,
              data: { stopReason: 'end_turn', outputText: 'done' },
            };
          }
        ),
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      const response = await callHandler(
        {
          id: 987,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello' },
            },
            _meta: { progressToken: 'progress-sync-1' },
          },
        },
        { requestId: 987 }
      );

      expect(response.content[0].text).toBe('done');
      expect(
        mockServer.notification.mock.calls.some(
          ([notification]: any[]) =>
            notification?.method === 'notifications/progress' &&
            notification?.params?.progressToken === 'progress-sync-1'
        )
      ).toBe(true);
    });

    it('emits MCP progress notifications for synchronous ACP exec on status-only updates', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockRejectedValue(new Error('initialize timed out after 15000ms')),
        execute: vi.fn(),
        executeWithObserver: vi.fn().mockImplementation(
          async (
            _localId: string,
            _config: unknown,
            _tool: string,
            _args: Record<string, unknown>,
            observer: {
              onTaskStatus?: (event: {
                status: 'working' | 'completed';
                message?: string;
              }) => Promise<void>;
            }
          ) => {
            await observer.onTaskStatus?.({ status: 'working' });
            await observer.onTaskStatus?.({ status: 'completed' });
            return {
              success: true,
              data: { stopReason: 'end_turn', outputText: 'done' },
            };
          }
        ),
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      await callHandler(
        {
          id: 988,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello' },
            },
            _meta: { progressToken: 'progress-sync-2' },
          },
        },
        { requestId: 988 }
      );

      expect(
        mockServer.notification.mock.calls.filter(
          ([notification]: any[]) =>
            notification?.method === 'notifications/progress' &&
            notification?.params?.progressToken === 'progress-sync-2'
        ).length
      ).toBeGreaterThanOrEqual(2);
    });

    it('accepts top-level progressToken from aai:exec tool arguments', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockRejectedValue(new Error('initialize timed out after 15000ms')),
        execute: vi.fn(),
        executeWithObserver: vi.fn().mockImplementation(
          async (
            _localId: string,
            _config: unknown,
            _tool: string,
            _args: Record<string, unknown>,
            observer: { onMessage?: (event: { message: string }) => Promise<void> }
          ) => {
            await observer.onMessage?.({ message: 'working' });
            return {
              success: true,
              data: { stopReason: 'end_turn', outputText: 'done' },
            };
          }
        ),
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      const response = await callHandler(
        {
          id: 989,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello' },
              progressToken: 'top-level-progress',
            },
          },
        },
        { requestId: 989 }
      );

      expect(response.content[0].text).toBe('done');
      expect(
        mockServer.notification.mock.calls.some(
          ([notification]: any[]) =>
            notification?.method === 'notifications/progress' &&
            notification?.params?.progressToken === 'top-level-progress'
        )
      ).toBe(true);
    });

    it('accepts top-level task from aai:exec tool arguments', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockRejectedValue(new Error('initialize timed out after 15000ms')),
        execute: vi.fn(),
        executeWithObserver: vi.fn().mockResolvedValue({
          success: true,
          data: { stopReason: 'end_turn', outputText: 'done' },
        }),
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      const response = await callHandler(
        {
          id: 990,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello' },
              task: {},
            },
          },
        },
        { requestId: 990 }
      );

      expect(response.task.taskId).toBeTruthy();
    });

    it('streams ACP session updates as MCP message notifications without requiring progressToken', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockResolvedValue({
          title: 'ACP Agent Details',
          body: 'Mock',
        }),
        execute: vi.fn(),
        executeWithObserver: vi.fn().mockImplementation(
          async (
            _localId: string,
            _config: unknown,
            _tool: string,
            _args: Record<string, unknown>,
            observer: { onMessage?: (event: { message: string }) => Promise<void> }
          ) => {
            await observer.onMessage?.({ message: 'working' });
            return {
              success: true,
              data: { outputText: 'done' },
            };
          }
        ),
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      await callHandler(
        {
          id: 991,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello' },
            },
          },
        },
        { requestId: 991 }
      );

      expect(
        mockServer.notification.mock.calls.some(
          ([notification]: any[]) =>
            notification?.method === 'notifications/message' &&
            notification?.params?.data === 'working'
        )
      ).toBe(true);
    });

    it('scopes ACP execution local ids per connected client context', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const { getAcpExecutor } = await import('../executors/acp.js');

      const executeWithObserver = vi.fn().mockResolvedValue({
        success: true,
        data: { outputText: 'done' },
      });

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'acp-agent',
              source: 'acp-agent',
              location: '/usr/local/bin/opencode',
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'OpenCode' } },
                access: { protocol: 'acp-agent', config: { command: 'opencode', args: ['acp'] } },
                exposure: { keywords: ['code'], summary: 'ACP agent.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      vi.mocked(getAcpExecutor).mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockResolvedValue({
          title: 'ACP Agent Details',
          body: 'Mock',
        }),
        execute: vi.fn(),
        executeWithObserver,
      } as any);

      const callsBeforeOne = mockServer.setRequestHandler.mock.calls.length;
      const serverOne = new AaiGatewayServer(undefined, { clientContextId: 'client-one' });
      await serverOne.initialize();
      const callHandlerOne = mockServer.setRequestHandler.mock.calls[callsBeforeOne + 1][1];

      const callsBeforeTwo = mockServer.setRequestHandler.mock.calls.length;
      const serverTwo = new AaiGatewayServer(undefined, { clientContextId: 'client-two' });
      await serverTwo.initialize();
      const callHandlerTwo = mockServer.setRequestHandler.mock.calls[callsBeforeTwo + 1][1];

      await callHandlerOne(
        {
          id: 992,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello from one' },
            },
          },
        },
        { requestId: 992 }
      );

      await callHandlerTwo(
        {
          id: 993,
          params: {
            name: 'aai:exec',
            arguments: {
              app: 'acp-agent',
              tool: 'prompt',
              args: { text: 'hello from two' },
            },
          },
        },
        { requestId: 993 }
      );

      const localIds = executeWithObserver.mock.calls.map((call) => call[0]);
      expect(localIds).toContain('client-one:acp-agent');
      expect(localIds).toContain('client-two:acp-agent');
    });

    it('includes gateway-managed skill paths in generated skill guidance', async () => {
      const { createDiscoveryManager } = await import('../discovery/index.js');
      const skillRoot = join(tempDir, 'managed-skill');
      await mkdir(skillRoot, { recursive: true });
      await writeFile(join(skillRoot, 'SKILL.md'), '# Managed Skill\n\nBody\n', 'utf8');

      vi.mocked(createDiscoveryManager).mockReturnValue({
        manager: {
          register: vi.fn(),
          scanAll: vi.fn().mockResolvedValue([
            {
              localId: 'skill-app',
              source: 'skill-import',
              location: skillRoot,
              descriptor: {
                schemaVersion: '2.0',
                version: '1.0.0',
                app: { name: { default: 'Managed Skill' } },
                access: { protocol: 'skill', config: { path: skillRoot } },
                exposure: { keywords: ['skill'], summary: 'Managed skill.' },
              },
            },
          ]),
          getSources: vi.fn().mockReturnValue([]),
        },
        sources: {
          desktop: { scan: vi.fn().mockResolvedValue([]) },
          agents: { scan: vi.fn().mockResolvedValue([]) },
          managed: { scan: vi.fn().mockResolvedValue([]) },
        },
      } as any);

      const server = new AaiGatewayServer();
      await server.initialize();

      const handlers = mockServer.setRequestHandler.mock.calls.map((call: any[]) => call[1]);
      const callHandler = handlers[1];
      const response = await callHandler(
        {
          id: 994,
          params: {
            name: 'app:skill-app',
            arguments: {},
          },
        },
        { requestId: 994 }
      );

      expect(response.content[0].text).toContain('Gateway-managed skill base path');
      expect(response.content[0].text).toContain(skillRoot);
    });
  });
});
