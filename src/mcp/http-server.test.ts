import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scanAllMock = vi.fn();
const transportInstances: MockStreamableTransport[] = [];
const createServerMock = vi.fn();

let requestHandler: ((req: MockRequest, res: MockResponse) => void) | undefined;
let addressPort = 4100;

class MockStreamableTransport {
  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;
  readonly handleRequest = vi.fn(async (_req: unknown, res: MockResponse) => {
    if (!this.sessionId) {
      this.sessionId = this.options.sessionIdGenerator?.() ?? `session-${transportInstances.length + 1}`;
      this.options.onsessioninitialized?.(this.sessionId);
    }
    res.end('ok');
  });
  readonly close = vi.fn(async () => {
    this.onclose?.();
  });

  constructor(
    private readonly options: {
      sessionIdGenerator?: () => string;
      onsessioninitialized?: (sessionId: string) => void;
    } = {}
  ) {
    transportInstances.push(this);
  }
}

interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator](): AsyncIterableIterator<Buffer>;
}

interface MockResponse {
  statusCode: number;
  headersSent: boolean;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

vi.mock('node:http', () => ({
  createServer: createServerMock.mockImplementation((handler: typeof requestHandler) => {
    requestHandler = handler;

    return {
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
        callback?.();
      }),
      close: vi.fn((callback?: (error?: Error) => void) => {
        callback?.();
      }),
      address: vi.fn(() => ({ port: addressPort })),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: MockStreamableTransport,
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    oninitialized: null,
    getClientVersion: vi.fn(() => ({ name: 'Mock Client', version: '1.0.0' })),
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../discovery/index.js', () => ({
  createDiscoveryManager: vi.fn(() => ({
    manager: {
      register: vi.fn(),
      scanAll: scanAllMock,
      getSources: vi.fn().mockReturnValue([]),
    },
    sources: {},
  })),
}));

vi.mock('../storage/secure-storage/index.js', () => ({
  createSecureStorage: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../consent/manager.js', () => ({
  ConsentManager: vi.fn().mockImplementation(() => ({
    checkAndPrompt: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../consent/dialog/index.js', () => ({
  createConsentDialog: vi.fn(() => ({
    show: vi.fn().mockResolvedValue({ decision: 'tool', remember: false }),
  })),
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

describe('AaiGatewayHttpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    transportInstances.length = 0;
    requestHandler = undefined;
    addressPort = 4100;
    scanAllMock.mockResolvedValue([]);
  });

  afterEach(() => {
    requestHandler = undefined;
  });

  it('starts a streamable HTTP listener with configured host, port, and path', async () => {
    const { createGatewayServer } = await import('./server.js');
    const gateway = await createGatewayServer({
      devMode: true,
      host: '127.0.0.1',
      port: 0,
      path: '/gateway',
    });

    await gateway.start();

    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(gateway.getUrl()).toBe('http://127.0.0.1:4100/gateway');
    expect(requestHandler).toBeTypeOf('function');
  });

  it('creates a streamable HTTP session on initialize and reuses it for follow-up requests', async () => {
    const { createGatewayServer } = await import('./server.js');
    const gateway = await createGatewayServer({
      devMode: true,
      host: '127.0.0.1',
      port: 8765,
      path: '/mcp',
    });

    await gateway.start();
    expect(requestHandler).toBeTypeOf('function');

    const initResponse = createMockResponse();
    await requestHandler!(
      createJsonRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'Client One', version: '1.0.0' },
        },
      }),
      initResponse
    );
    await flushAsyncWork();

    expect(transportInstances).toHaveLength(1);
    expect(transportInstances[0].handleRequest).toHaveBeenCalledTimes(1);
    expect(transportInstances[0].sessionId).toBeTruthy();
    expect(initResponse.body).toBe('ok');

    const followupResponse = createMockResponse();
    await requestHandler!(
      createJsonRequest(
        'POST',
        '/mcp',
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        { 'mcp-session-id': transportInstances[0].sessionId }
      ),
      followupResponse
    );
    await flushAsyncWork();

    expect(transportInstances).toHaveLength(1);
    expect(transportInstances[0].handleRequest).toHaveBeenCalledTimes(2);
    expect(followupResponse.body).toBe('ok');

    const secondInitResponse = createMockResponse();
    await requestHandler!(
      createJsonRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'Client Two', version: '1.0.0' },
        },
      }),
      secondInitResponse
    );
    await flushAsyncWork();

    expect(transportInstances).toHaveLength(2);
    expect(transportInstances[1].sessionId).toBeTruthy();
    expect(transportInstances[1].sessionId).not.toBe(transportInstances[0].sessionId);
  });
});

function createJsonRequest(
  method: string,
  url: string,
  body: unknown,
  headers: Record<string, string | string[] | undefined> = {}
): MockRequest {
  const payload = Buffer.from(JSON.stringify(body));

  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  };
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    headersSent: false,
    headers: {},
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk = '') {
      this.headersSent = true;
      this.body = chunk;
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
