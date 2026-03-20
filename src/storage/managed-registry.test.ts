import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Managed registry', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aai-gateway-managed-'));
    process.env.AAI_GATEWAY_APPS_DIR = join(tempDir, 'apps');
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.AAI_GATEWAY_APPS_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('skips descriptors whose discovery checks fail', async () => {
    const root = process.env.AAI_GATEWAY_APPS_DIR!;
    const brokenDir = join(root, 'broken-cli');
    const okDir = join(root, 'ok-cli');

    await mkdir(brokenDir, { recursive: true });
    await mkdir(okDir, { recursive: true });

    await writeFile(
      join(brokenDir, 'aai.json'),
      JSON.stringify({
        schemaVersion: '2.0',
        version: '1.0.0',
        app: {
          name: { default: 'Broken CLI' },
        },
        discovery: {
          checks: [{ kind: 'command', command: 'definitely-not-a-real-command-xyz' }],
        },
        access: {
          protocol: 'cli',
          config: {
            command: 'broken-cli',
          },
        },
        exposure: {
          keywords: ['broken'],
          summary: 'Broken CLI.',
        },
      }),
      'utf-8'
    );

    await writeFile(
      join(okDir, 'aai.json'),
      JSON.stringify({
        schemaVersion: '2.0',
        version: '1.0.0',
        app: {
          name: { default: 'Node CLI' },
        },
        discovery: {
          checks: [{ kind: 'command', command: 'node' }],
        },
        access: {
          protocol: 'cli',
          config: {
            command: 'node',
          },
        },
        exposure: {
          keywords: ['node'],
          summary: 'Node CLI.',
        },
      }),
      'utf-8'
    );

    const { loadManagedDescriptors } = await import('./managed-registry.js');
    const records = await loadManagedDescriptors();

    expect(records).toHaveLength(1);
    expect(records[0].localId).toBe('ok-cli');
  });
});
