import { describe, expect, it } from 'vitest';
import type { DiscoveredAgent } from './agent-registry.js';
import { resolveDiscoveryLocation } from './agent-registry.js';
import type { AaiJson } from '../types/aai-json.js';

describe('Agent registry types', () => {
  it('supports the new ACP descriptor shape', () => {
    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: {
          default: 'OpenCode',
          en: 'OpenCode',
        },
      },
      discovery: {
        checks: [{ kind: 'command', command: 'opencode' }],
      },
      access: {
        protocol: 'acp-agent',
        config: {
          command: 'opencode',
          args: ['acp'],
        },
      },
      exposure: {
        keywords: ['code', 'agent'],
        summary: 'ACP coding agent.',
      },
    };

    const agent: DiscoveredAgent = {
      localId: 'acp-opencode',
      descriptor,
      source: 'acp-agent',
      commandPath: '/usr/local/bin/opencode',
      location: '/usr/local/bin/opencode',
    };

    expect(agent.localId).toBe('acp-opencode');
    expect(agent.descriptor.access.protocol).toBe('acp-agent');
    expect(agent.descriptor.app.name.default).toBe('OpenCode');
  });

  it('passes discovery when all command checks succeed', async () => {
    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: {
          default: 'Node CLI',
        },
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
    };

    await expect(resolveDiscoveryLocation(descriptor)).resolves.toBeTruthy();
  });

  it('fails discovery when a required command is missing', async () => {
    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: {
          default: 'Missing CLI',
        },
      },
      discovery: {
        checks: [{ kind: 'command', command: 'definitely-not-a-real-command-xyz' }],
      },
      access: {
        protocol: 'cli',
        config: {
          command: 'node',
        },
      },
      exposure: {
        keywords: ['missing'],
        summary: 'Missing CLI.',
      },
    };

    await expect(resolveDiscoveryLocation(descriptor)).resolves.toBeNull();
  });
});
