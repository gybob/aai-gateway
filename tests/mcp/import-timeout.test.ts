import { describe, expect, it } from 'vitest';

import { buildMcpImportConfig } from '../../src/mcp/importer.js';
import { parseAaiJson } from '../../src/parsers/schema.js';

describe('MCP import timeout', () => {
  it('stores timeout on stdio MCP configs', () => {
    const config = buildMcpImportConfig({
      command: 'npx',
      timeout: 45_000,
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/repo'],
    });

    expect(config).toEqual({
      transport: 'stdio',
      command: 'npx',
      timeout: 45_000,
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/repo'],
    });
  });

  it('accepts timeout in parsed MCP descriptors', () => {
    const descriptor = parseAaiJson({
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: {
          default: 'Timed MCP',
        },
      },
      access: {
        protocol: 'mcp',
        config: {
          transport: 'streamable-http',
          url: 'https://example.com/mcp',
          timeout: 60_000,
        },
      },
      exposure: {
        keywords: ['timed', 'mcp'],
        summary: 'Timed MCP.',
      },
    });

    expect(descriptor.access.protocol).toBe('mcp');
    if (descriptor.access.protocol !== 'mcp') {
      throw new Error('expected mcp access');
    }
    expect(descriptor.access.config.timeout).toBe(60_000);
  });
});
