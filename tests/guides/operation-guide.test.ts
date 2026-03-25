import { describe, expect, it } from 'vitest';

import { generateOperationGuide } from '../../src/guides/app-guide-generator.js';
import type { AaiJson, DetailedCapability } from '../../src/types/aai-json.js';

describe('generateOperationGuide', () => {
  it('renders MCP tool descriptions, schemas, and exec examples', () => {
    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: {
          default: 'Web Search',
          en: 'Web Search',
        },
      },
      access: {
        protocol: 'mcp',
        config: {
          transport: 'stdio',
          command: 'node',
        },
      },
      exposure: {
        keywords: ['web-search', 'search'],
        summary: 'Search the web.',
      },
    };

    const detail: DetailedCapability = {
      title: 'MCP Tools',
      body: JSON.stringify(
        [
          {
            name: 'search',
            description: 'Search the web using one or more engines.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                limit: { type: 'integer' },
              },
              required: ['query'],
            },
          },
        ],
        null,
        2
      ),
    };

    const guide = generateOperationGuide('open-websearch-latest', descriptor, detail);

    expect(guide).toContain('### search');
    expect(guide).toContain('Search the web using one or more engines.');
    expect(guide).toContain('"required": [\n    "query"\n  ]');
    expect(guide).toContain('## Execution');
    expect(guide).toContain('"tool": "search"');
    expect(guide).toContain('"query": "<string>"');
    expect(guide).not.toContain('`aai:exec` example:');
  });

  it('renders ACP tools, polling output schemas, and both prompt flow cases', () => {
    const descriptor: AaiJson = {
      schemaVersion: '2.0',
      version: '1.0.0',
      app: {
        name: {
          default: 'ACP Agent',
          en: 'ACP Agent',
        },
      },
      access: {
        protocol: 'acp-agent',
        config: {
          command: 'agent',
        },
      },
      exposure: {
        keywords: ['agent', 'acp'],
        summary: 'A reusable ACP agent.',
      },
    };

    const detail: DetailedCapability = {
      title: 'ACP Agent Details',
      body: JSON.stringify(
        {
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: {
              image: false,
              embeddedContext: true,
            },
          },
        },
        null,
        2
      ),
    };

    const guide = generateOperationGuide('demo-acp', descriptor, detail);

    expect(guide).toContain('### prompt');
    expect(guide).toContain('### session/new');
    expect(guide).toContain('### session/prompt');
    expect(guide).toContain('### session/poll');
    expect(guide).toContain('Output schema:');
    expect(guide).toContain('"done"');
    expect(guide).toContain('## Polling Model');
    expect(guide).toContain('## Case 1: One-Off Prompt Then Poll');
    expect(guide).toContain('"tool": "prompt"');
    expect(guide).toContain('"pollTool": "session/poll"');
    expect(guide).toContain('## Case 2: Explicit Session Reuse');
    expect(guide).toContain('"tool": "session/new"');
    expect(guide).toContain('"tool": "session/poll"');
  });
});
