import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpApiExecutor } from './http-api-executor.js';
import type { AaiDescriptor, Runtime, ToolDef } from '../aai/types.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('HttpApiExecutor', () => {
  it('executes http bindings against the runtime base url', async () => {
    const executor = new HttpApiExecutor();
    const runtime: Runtime = {
      id: 'runtime',
      kind: 'http-api',
      protocol: 'rest',
      transport: {
        type: 'http',
        baseUrl: 'https://example.com/api',
      },
    };
    const tool: ToolDef = {
      name: 'search',
      inputSchema: { type: 'object', properties: {} },
      binding: {
        type: 'http',
        path: '/search',
        method: 'POST',
      },
    };
    const descriptor = {
      schemaVersion: '2.0',
      identity: {
        id: 'demo',
        name: { en: 'Demo' },
        defaultLang: 'en',
        version: '1.0.0',
      },
      runtimes: [runtime],
      catalog: { tools: { mode: 'none' } },
    } as AaiDescriptor;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    );
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const result = await executor.executeTool(descriptor, runtime, tool, { query: 'hello' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://example.com/search');
    expect(init?.method).toBe('POST');
  });
});
