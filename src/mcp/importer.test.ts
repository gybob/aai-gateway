import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('MCP and skill importer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aai-gateway-importer-'));
    process.env.AAI_GATEWAY_APPS_DIR = join(tempDir, 'apps');
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.AAI_GATEWAY_APPS_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('generates a minimal MCP descriptor with access and exposure', async () => {
    const { generateMcpDescriptor } = await import('./importer.js');

    const descriptor = generateMcpDescriptor(
      {
        name: 'Filesystem MCP',
        config: {
          transport: 'stdio',
          command: 'filesystem-server',
        },
      },
      [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ]
    );

    expect(descriptor.schemaVersion).toBe('2.0');
    expect(descriptor.app.name.default).toBe('Filesystem MCP');
    expect(descriptor.access.protocol).toBe('mcp');
    expect(descriptor.exposure.keywords).toContain('filesystem-mcp');
  });

  it('imports an MCP server and stores headers outside the descriptor', async () => {
    const { importMcpServer, loadImportedMcpHeaders } = await import('./importer.js');

    const storageData = new Map<string, string>();
    const storage = {
      get: vi.fn(async (key: string) => storageData.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        storageData.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        storageData.delete(key);
      }),
    };

    const executor = {
      listTools: vi.fn(async () => [
        {
          name: 'search',
          description: 'Search remote documents',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ]),
    };

    const result = await importMcpServer(executor as never, storage, {
      localId: 'remote-docs',
      name: 'Remote Docs',
      config: {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
      },
      headers: {
        Authorization: 'Bearer secret-token',
      },
      exposure: {
        keywords: ['docs', 'search'],
        summary: 'Search remote documents.',
      },
    });

    expect(result.entry.localId).toBe('remote-docs');
    expect(result.descriptor.access.protocol).toBe('mcp');
    expect(result.descriptor.exposure.summary).toBe('Search remote documents.');
    await expect(loadImportedMcpHeaders(storage, 'remote-docs')).resolves.toEqual({
      Authorization: 'Bearer secret-token',
    });
  });

  it('imports a local skill directory into gateway-managed storage', async () => {
    const { importSkill } = await import('./importer.js');

    const sourceDir = join(tempDir, 'source-skill');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'SKILL.md'), '# Test Skill\n', 'utf-8');
    await writeFile(join(sourceDir, 'script.sh'), 'echo test\n', 'utf-8');

    const result = await importSkill({
      localId: 'test-skill',
      path: sourceDir,
      exposure: {
        keywords: ['skill'],
        summary: 'Imported skill.',
      },
    });

    expect(result.localId).toBe('test-skill');
    expect(result.descriptor.access.protocol).toBe('skill');
    expect(result.descriptor.access.config).toEqual({
      path: result.managedPath,
    });
  });
});
