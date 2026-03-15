import { describe, expect, it } from 'vitest';

import { parseAaiDescriptor } from './parser.js';
import type { AaiDescriptor } from './types.js';

function createDescriptor(): AaiDescriptor {
  return {
    schemaVersion: '2.0',
    identity: {
      id: 'demo.integration',
      name: { en: 'Demo Integration' },
      defaultLang: 'en',
      version: '1.0.0',
    },
    disclosure: {
      mode: 'required',
      modelSurface: 'integration-only',
      detailLoad: 'on-demand',
      executionSurface: 'universal-exec',
    },
    runtimes: [
      {
        id: 'demo-runtime',
        kind: 'rpc',
        protocol: 'mcp',
        default: true,
        transport: {
          type: 'stdio',
          command: 'demo-server',
        },
      },
    ],
    catalog: {
      tools: {
        mode: 'hybrid',
        sourceRuntimeId: 'demo-runtime',
        summary: [
          {
            ref: 'tool:search',
            kind: 'tool',
            name: 'search',
            runtimeId: 'demo-runtime',
          },
        ],
        snapshot: [
          {
            ref: 'tool:search',
            name: 'search',
            inputSchema: { type: 'object', properties: {} },
            runtimeId: 'demo-runtime',
            binding: {
              type: 'mcp-tool',
              toolName: 'search',
            },
          },
        ],
      },
    },
  };
}

describe('parseAaiDescriptor', () => {
  it('parses a valid descriptor', () => {
    const descriptor = parseAaiDescriptor(createDescriptor());
    expect(descriptor.identity.id).toBe('demo.integration');
    expect(descriptor.catalog.tools.summary).toHaveLength(1);
  });

  it('rejects mismatched summary/detail names for the same ref', () => {
    const invalid = createDescriptor();
    invalid.catalog.tools.snapshot = [
      {
        ref: 'tool:search',
        name: 'different-name',
        inputSchema: { type: 'object', properties: {} },
        runtimeId: 'demo-runtime',
        binding: {
          type: 'mcp-tool',
        },
      },
    ];

    expect(() => parseAaiDescriptor(invalid)).toThrow(/mismatched names/i);
  });

  it('rejects unknown runtime references', () => {
    const invalid = createDescriptor();
    invalid.catalog.tools.summary = [
      {
        ref: 'tool:search',
        kind: 'tool',
        name: 'search',
        runtimeId: 'missing-runtime',
      },
    ];

    expect(() => parseAaiDescriptor(invalid)).toThrow(/unknown runtimeId/i);
  });
});
