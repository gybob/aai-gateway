import { describe, expect, it } from 'vitest';

import { normalizeImportedMcpSource } from './mcp-importer.js';

describe('normalizeImportedMcpSource', () => {
  it('normalizes direct stdio input', async () => {
    const source = await normalizeImportedMcpSource({
      name: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: {
        DEBUG: '1',
      },
    });

    expect(source).toEqual({
      kind: 'stdio',
      name: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      cwd: undefined,
      env: { DEBUG: '1' },
    });
  });

  it('normalizes direct remote input', async () => {
    const source = await normalizeImportedMcpSource({
      name: 'Remote Demo',
      url: 'https://example.com/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
      transport: 'sse',
    });

    expect(source.kind).toBe('sse');
    expect(source.url).toBe('https://example.com/mcp');
    expect(source.headers?.Authorization).toBe('Bearer token');
  });
});
