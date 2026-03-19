import { describe, expect, it } from 'vitest';
import type { DiscoveredAgent } from './agent-registry.js';
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
});
