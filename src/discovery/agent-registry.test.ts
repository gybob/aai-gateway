import { describe, it, expect } from 'vitest';
import type { DiscoveredAgent, AgentDescriptor } from './agent-registry.js';

describe('Agent Registry Types', () => {
  describe('DiscoveredAgent', () => {
    it('should have correct structure', () => {
      const agent: DiscoveredAgent = {
        appId: 'dev.sst.opencode',
        name: 'OpenCode',
        description: 'Open-source AI coding agent',
        descriptor: {
          id: 'dev.sst.opencode',
          name: { en: 'OpenCode' },
          description: 'Open-source AI coding agent',
          defaultLang: 'en',
          start: { command: 'opencode' },
          tools: [],
        },
        commandPath: '/usr/local/bin/opencode',
      };

      expect(agent.appId).toBe('dev.sst.opencode');
      expect(agent.name).toBe('OpenCode');
      expect(agent.commandPath).toBe('/usr/local/bin/opencode');
    });
  });

  describe('AgentDescriptor', () => {
    it('should have correct structure', () => {
      const descriptor: AgentDescriptor = {
        id: 'dev.sst.opencode',
        name: { en: 'OpenCode', 'zh-CN': 'OpenCode' },
        description: 'Open-source AI coding agent',
        defaultLang: 'en',
        aliases: ['opencode', 'sst'],
        start: {
          command: 'opencode',
          args: [],
        },
        tools: [
          {
            name: 'session/new',
            description: 'Create a new coding session',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      expect(descriptor.id).toBe('dev.sst.opencode');
      expect(descriptor.tools).toHaveLength(1);
      expect(descriptor.tools[0].name).toBe('session/new');
    });

    it('should support optional fields', () => {
      const descriptor: AgentDescriptor = {
        id: 'test.agent',
        name: { en: 'Test' },
        description: 'Test agent',
        defaultLang: 'en',
        start: { command: 'test' },
        tools: [],
      };

      expect(descriptor.aliases).toBeUndefined();
      expect(descriptor.start.args).toBeUndefined();
      expect(descriptor.start.env).toBeUndefined();
    });
  });
});
