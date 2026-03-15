import { describe, expect, it } from 'vitest';

import { DisclosureEngine } from './disclosure-engine.js';
import type { AaiDescriptor } from '../aai/types.js';

function createDescriptor(): AaiDescriptor {
  return {
    schemaVersion: '2.0',
    identity: {
      id: 'demo.integration',
      name: { en: 'Demo Integration' },
      defaultLang: 'en',
      version: '1.0.0',
    },
    disclosure: {
      mode: 'required',
      modelSurface: 'integration-only',
      detailLoad: 'on-demand',
      executionSurface: 'universal-exec',
      maxVisibleItems: 1,
    },
    runtimes: [
      {
        id: 'runtime',
        kind: 'rpc',
        protocol: 'mcp',
        default: true,
        transport: { type: 'stdio', command: 'demo' },
      },
    ],
    catalog: {
      tools: {
        mode: 'hybrid',
        summary: [
          { ref: 'tool:one', kind: 'tool', name: 'one' },
          { ref: 'tool:two', kind: 'tool', name: 'two' },
        ],
      },
    },
  };
}

describe('DisclosureEngine', () => {
  it('limits visible summaries according to disclosure.maxVisibleItems', () => {
    const engine = new DisclosureEngine();
    const visible = engine.listVisibleSummaries(createDescriptor());
    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe('one');
  });

  it('renders a guide including hidden count', () => {
    const engine = new DisclosureEngine();
    const guide = engine.buildGuide(createDescriptor());
    expect(guide).toContain('Demo Integration');
    expect(guide).toContain('1 additional primitives are hidden');
  });
});
