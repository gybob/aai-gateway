import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ManagedIntegrationStore } from './managed-store.js';
import type { AaiDescriptor } from '../aai/types.js';

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.allSettled(
    createdDirs.splice(0).map(async (dir) => {
      const store = new ManagedIntegrationStore(dir);
      await store.remove('demo.integration');
    }),
  );
});

function createDescriptor(): AaiDescriptor {
  return {
    schemaVersion: '2.0',
    identity: {
      id: 'demo.integration',
      name: { en: 'Demo Integration' },
      defaultLang: 'en',
      version: '1.0.0',
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
        mode: 'none',
      },
    },
  };
}

describe('ManagedIntegrationStore', () => {
  it('persists and reloads descriptors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aai-gateway-test-'));
    createdDirs.push(root);

    const store = new ManagedIntegrationStore(root);
    const saved = await store.put(createDescriptor(), {
      sourceType: 'manual',
      converterVersion: 'test',
    });

    expect(saved.metadata.integrationId).toBe('demo.integration');

    const loaded = await store.get('demo.integration');
    expect(loaded?.descriptor.identity.id).toBe('demo.integration');
    expect(loaded?.metadata.converterVersion).toBe('test');
  });
});
