import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('aai config', () => {
  let tempDir: string;
  const originalAaiHome = process.env.AAI_HOME;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aai-gateway-config-'));
    process.env.AAI_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalAaiHome === undefined) {
      delete process.env.AAI_HOME;
    } else {
      process.env.AAI_HOME = originalAaiHome;
    }
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads log level from ~/.aai/config.json', async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, 'config.json'),
      JSON.stringify({
        logLevel: 'debug',
        server: {
          host: '127.0.0.1',
          port: 8765,
          path: '/mcp',
        },
      }),
      'utf8'
    );

    const { loadAaiConfig, getAaiConfigPath } = await import('./config.js');

    expect(getAaiConfigPath()).toBe(join(tempDir, 'config.json'));
    expect(loadAaiConfig()).toEqual({
      logLevel: 'debug',
      server: {
        host: '127.0.0.1',
        port: 8765,
        path: '/mcp',
      },
    });
  });

  it('ignores invalid config values', async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, 'config.json'), JSON.stringify({ logLevel: 'verbose' }), 'utf8');

    const { loadAaiConfig } = await import('./config.js');

    expect(loadAaiConfig()).toEqual({ logLevel: undefined, server: undefined });
  });

  it('ignores invalid server config values', async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, 'config.json'),
      JSON.stringify({
        server: {
          host: '',
          port: 70000,
          path: '',
        },
      }),
      'utf8'
    );

    const { loadAaiConfig } = await import('./config.js');

    expect(loadAaiConfig()).toEqual({ logLevel: undefined, server: undefined });
  });
});
