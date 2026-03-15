import { describe, expect, it, vi } from 'vitest';

import { AaiGatewayServer } from './server.js';
import type {
  AaiDescriptor,
  ManagedIntegrationRecord,
  PrimitiveSummary,
  ResourceTemplateDef,
  Runtime,
} from '../aai/types.js';

const runtime: Runtime = {
  id: 'runtime-1',
  kind: 'rpc',
  protocol: 'mcp',
  default: true,
  transport: {
    type: 'stdio',
    command: 'demo-mcp',
  },
};

function createRecord(summary: PrimitiveSummary): ManagedIntegrationRecord {
  const descriptor: AaiDescriptor = {
    schemaVersion: '2.0',
    identity: {
      id: 'demo.integration',
      name: { en: 'Demo Integration' },
      defaultLang: 'en',
      version: '1.0.0',
      description: 'Managed integration for tests',
    },
    disclosure: {
      mode: 'required',
      modelSurface: 'integration-only',
      detailLoad: 'on-demand',
      executionSurface: 'universal-exec',
      maxVisibleItems: 10,
    },
    runtimes: [runtime],
    catalog: {
      tools: { mode: 'none', summary: summary.kind === 'tool' ? [summary] : [] },
      prompts: { mode: 'none', summary: summary.kind === 'prompt' ? [summary] : [] },
      resources: { mode: 'none', summary: summary.kind === 'resource' ? [summary] : [] },
      resourceTemplates: { mode: 'snapshot', summary: summary.kind === 'resource-template' ? [summary] : [] },
    },
  };

  return {
    descriptor,
    metadata: {
      integrationId: 'demo.integration',
      importedAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
      sourceType: 'mcp-config',
      sourceHash: 'hash',
      converterVersion: 'test',
    },
  };
}

describe('AaiGatewayServer', () => {
  it('lists the bounded progressive disclosure tool surface', () => {
    const summary: PrimitiveSummary = {
      ref: 'tool:search',
      kind: 'tool',
      name: 'search',
    };
    const record = createRecord(summary);
    const server = new AaiGatewayServer(
      createRegistry(record, summary, runtime),
      {} as never,
      { buildGuide: () => 'guide' } as never,
      {} as never,
      {} as never,
    );

    const tools = server.listModelTools();
    expect(tools.map((tool) => tool.name)).toEqual(['integration:demo.integration', 'aai:exec']);
  });

  it('expands resource templates and reads the resolved resource lazily', async () => {
    const summary: PrimitiveSummary = {
      ref: 'resource-template:repo',
      kind: 'resource-template',
      name: 'repoFile',
      runtimeId: runtime.id,
    };
    const record = createRecord(summary);
    const template: ResourceTemplateDef = {
      ref: 'resource-template:repo',
      name: 'repoFile',
      uriTemplate: 'repo://{owner}/{repo}{?path,ref}',
      runtimeId: runtime.id,
    };

    const readResource = vi.fn().mockResolvedValue({
      uri: 'repo://gybob/aai-gateway?path=README.md&ref=main',
      contents: 'ok',
    });

    const server = new AaiGatewayServer(
      createRegistry(record, summary, runtime),
      { readResource } as never,
      { buildGuide: () => 'guide' } as never,
      { resolveResourceTemplate: vi.fn().mockResolvedValue(template) } as never,
      {} as never,
    );

    const response = await server.invokeTool('aai:exec', {
      integrationId: 'demo.integration',
      primitiveRef: 'resource-template:repo',
      arguments: {
        owner: 'gybob',
        repo: 'aai-gateway',
        path: 'README.md',
        ref: 'main',
      },
    });

    expect(readResource).toHaveBeenCalledWith(
      record.descriptor,
      runtime,
      'repo://gybob/aai-gateway?path=README.md&ref=main',
    );
    expect(response.content[0]?.text).toContain('repo://gybob/aai-gateway?path=README.md&ref=main');
  });
});

function createRegistry(
  record: ManagedIntegrationRecord,
  summary: PrimitiveSummary,
  resolvedRuntime: Runtime,
): {
  list: () => ManagedIntegrationRecord[];
  get: (integrationId: string) => ManagedIntegrationRecord;
  resolveSummary: (integrationId: string, primitiveRef: string) => PrimitiveSummary;
  resolveRuntime: () => Runtime;
} {
  return {
    list: () => [record],
    get: (integrationId: string) => {
      if (integrationId !== record.metadata.integrationId) {
        throw new Error(`Unexpected integration ${integrationId}`);
      }
      return record;
    },
    resolveSummary: (_integrationId: string, primitiveRef: string) => {
      if (primitiveRef !== summary.ref) {
        throw new Error(`Unexpected primitiveRef ${primitiveRef}`);
      }
      return summary;
    },
    resolveRuntime: () => resolvedRuntime,
  };
}
