import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AaiJson } from '../types/aai-json.js';

describe('MCP registry', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aai-gateway-registry-'));
    process.env.AAI_GATEWAY_APPS_DIR = join(tempDir, 'apps');
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.AAI_GATEWAY_APPS_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes and loads imported MCP descriptors from the managed registry', async () => {
    const registry = await import('./mcp-registry.js');

    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: {
          default: 'Remote Docs',
          en: 'Remote Docs',
        },
      },
      access: {
        protocol: 'mcp',
        config: {
          transport: 'streamable-http',
          url: 'https://example.com/mcp',
        },
      },
      exposure: {
        keywords: ['docs', 'search'],
        summary: 'Imported remote MCP.',
      },
    };

    const entry = await registry.upsertMcpRegistryEntry(
      {
        localId: 'remote-docs',
        protocol: 'mcp',
        config: {
          transport: 'streamable-http',
          url: 'https://example.com/mcp',
        },
      },
      descriptor
    );

    expect(entry.localId).toBe('remote-docs');
    const loaded = await registry.loadImportedMcpApps();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].descriptor.app.name.default).toBe('Remote Docs');
  });

  it('updates an existing entry in place', async () => {
    const registry = await import('./mcp-registry.js');

    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: { default: 'Filesystem MCP', en: 'Filesystem MCP' },
      },
      access: {
        protocol: 'mcp',
        config: {
          transport: 'stdio',
          command: 'filesystem-server',
        },
      },
      exposure: {
        keywords: ['files'],
        summary: 'Filesystem tools.',
      },
    };

    const first = await registry.upsertMcpRegistryEntry(
      {
        localId: 'filesystem-mcp',
        protocol: 'mcp',
        config: {
          transport: 'stdio',
          command: 'filesystem-server',
        },
      },
      descriptor
    );

    const second = await registry.upsertMcpRegistryEntry(
      {
        localId: 'filesystem-mcp',
        protocol: 'mcp',
        config: {
          transport: 'stdio',
          command: 'filesystem-server',
        },
      },
      {
        ...descriptor,
        exposure: {
          keywords: ['files', 'local'],
          summary: 'Updated filesystem tools.',
        },
      }
    );

    expect(second.descriptorPath).toBe(first.descriptorPath);
    const loaded = await registry.loadImportedMcpApps();
    expect(loaded[0].descriptor.exposure.summary).toBe('Updated filesystem tools.');
  });
});
