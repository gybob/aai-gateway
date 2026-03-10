import { describe, it, expect } from 'vitest';
import type { DiscoveredAgent } from './agent-registry.js';
import type { AaiJson } from '../types/aai-json.js';

describe('Agent Registry Types', () => {
  describe('DiscoveredAgent', () => {
    it('should have correct structure', () => {
      const descriptor: AaiJson = {
        schemaVersion: '1.0',
        version: '1.0.0',
        platform: 'macos',
        app: {
          id: 'dev.sst.opencode',
          name: { en: 'OpenCode' },
          description: 'Open-source AI coding agent',
          defaultLang: 'en',
        },
        execution: {
          type: 'acp',
          start: { command: 'opencode' },
        },
        tools: [],
      };

      const agent: DiscoveredAgent = {
        appId: 'dev.sst.opencode',
        name: 'OpenCode',
        description: 'Open-source AI coding agent',
        descriptor,
        commandPath: '/usr/local/bin/opencode',
      };

      expect(agent.appId).toBe('dev.sst.opencode');
      expect(agent.name).toBe('OpenCode');
      expect(agent.commandPath).toBe('/usr/local/bin/opencode');
    });
  });

  describe('AaiJson for ACP agents', () => {
    it('should have correct structure', () => {
      const descriptor: AaiJson = {
        schemaVersion: '1.0',
        version: '1.0.0',
        platform: 'macos',
        app: {
          id: 'dev.sst.opencode',
          name: { en: 'OpenCode', 'zh-CN': 'OpenCode' },
          description: 'Open-source AI coding agent',
          defaultLang: 'en',
          aliases: ['opencode', 'sst'],
        },
        execution: {
          type: 'acp',
          start: {
            command: 'opencode',
            args: [],
          },
        },
        tools: [
          {
            name: 'session/new',
            description: 'Create a new coding session',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      expect(descriptor.app.id).toBe('dev.sst.opencode');
      expect(descriptor.tools).toHaveLength(1);
      expect(descriptor.tools[0].name).toBe('session/new');
      expect(descriptor.execution.type).toBe('acp');
    });

    it('should support optional fields', () => {
      const descriptor: AaiJson = {
        schemaVersion: '1.0',
        version: '1.0.0',
        platform: 'macos',
        app: {
          id: 'test.agent',
          name: { en: 'Test' },
          description: 'Test agent',
          defaultLang: 'en',
        },
        execution: {
          type: 'acp',
          start: { command: 'test' },
        },
        tools: [],
      };

      expect(descriptor.app.aliases).toBeUndefined();
      expect(descriptor.execution.type).toBe('acp');
      if (descriptor.execution.type === 'acp') {
        expect(descriptor.execution.start.args).toBeUndefined();
        expect(descriptor.execution.start.env).toBeUndefined();
      }
    });
  });
});
