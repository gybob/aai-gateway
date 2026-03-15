import { readFile } from 'node:fs/promises';

import { AaiError } from '../errors/errors.js';
import { createIntegrationId, createRuntimeId } from '../aai/ids.js';
import type {
  AaiDescriptor,
  ImportMcpOptions,
  ImportedMcpSource,
  JsonObject,
  ManagedIntegrationRecord,
  Runtime,
} from '../aai/types.js';
import { RpcExecutor, toPrimitiveSummaries } from '../executors/rpc-executor.js';
import { createContentHash, ManagedIntegrationStore } from '../gateway/managed-store.js';
import { logger } from '../shared/logger.js';

export interface ImportMcpCliInput {
  name?: string;
  integrationId?: string;
  version?: string;
  dryRun?: boolean;
  serverConfigPath?: string;
  clientConfigPath?: string;
  serverName?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  transport?: 'streamable-http' | 'sse';
  headers?: Record<string, string>;
}

export class McpImporter {
  constructor(
    private readonly store = new ManagedIntegrationStore(),
    private readonly rpcExecutor = new RpcExecutor(),
  ) {}

  async import(input: ImportMcpCliInput): Promise<ManagedIntegrationRecord> {
    const source = await normalizeImportedMcpSource(input);
    const integrationId = input.integrationId ?? createIntegrationId(source, input.name);
    const runtimeId = createRuntimeId(integrationId, 'mcp');

    logger.info({ integrationId, sourceKind: source.kind }, 'Importing MCP integration');
    const catalog = await this.rpcExecutor.inspectSource(source, runtimeId);
    const summaries = toPrimitiveSummaries(catalog);
    const descriptor = createImportedDescriptor(source, runtimeId, integrationId, catalog, summaries, input);

    if (input.dryRun) {
      return {
        descriptor,
        metadata: {
          integrationId,
          importedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceType: 'mcp-config',
          sourceHash: createContentHash(source),
          converterVersion: '2.0.0-alpha',
          notes: 'Dry run only; not persisted',
        },
      };
    }

    return this.store.put(descriptor, {
      integrationId,
      sourceType: 'mcp-config',
      sourceHash: createContentHash(source),
      converterVersion: '2.0.0-alpha',
      notes: source.sourcePath ? `Imported from ${source.sourcePath}` : undefined,
    });
  }

  async refresh(integrationId: string): Promise<ManagedIntegrationRecord> {
    const existing = await this.store.get(integrationId);
    if (!existing) {
      throw new AaiError('NOT_FOUND', `Integration '${integrationId}' not found`);
    }

    const rawSource = existing.descriptor._meta?.importedMcpSource;
    if (!isJsonObject(rawSource)) {
      throw new AaiError(
        'NOT_IMPLEMENTED',
        `Integration '${integrationId}' cannot be refreshed because imported source metadata is missing`,
      );
    }

    const source = rawSource as unknown as ImportedMcpSource;
    const runtimeId = createRuntimeId(integrationId, 'mcp');
    const catalog = await this.rpcExecutor.inspectSource(source, runtimeId);
    const summaries = toPrimitiveSummaries(catalog);
    const descriptor = createImportedDescriptor(
      source,
      runtimeId,
      integrationId,
      catalog,
      summaries,
      {
        displayName: existing.descriptor.identity.title,
        version: existing.descriptor.identity.version,
      },
    );

    return this.store.put(descriptor, {
      integrationId,
      importedAt: existing.metadata.importedAt,
      sourceType: existing.metadata.sourceType,
      sourceHash: createContentHash(source),
      converterVersion: existing.metadata.converterVersion,
      notes: existing.metadata.notes,
    });
  }
}

export async function normalizeImportedMcpSource(input: ImportMcpCliInput): Promise<ImportedMcpSource> {
  if (input.command) {
    return {
      kind: 'stdio',
      name: input.name,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
    };
  }

  if (input.url) {
    return {
      kind: input.transport ?? 'streamable-http',
      name: input.name,
      url: input.url,
      headers: input.headers,
    };
  }

  const configPath = input.serverConfigPath ?? input.clientConfigPath;
  if (!configPath) {
    throw new AaiError(
      'INVALID_REQUEST',
      'Missing MCP import source. Provide --command, --url, --server-config, or --client-config',
    );
  }

  const raw = JSON.parse(await readFile(configPath, 'utf-8')) as JsonObject;
  const source = extractServerConfig(raw, input.serverName);
  return normalizeServerObject(source, {
    name: input.name ?? input.serverName,
    sourcePath: configPath,
  });
}

function extractServerConfig(raw: JsonObject, serverName?: string): JsonObject {
  if (isJsonObject(raw.mcpServers)) {
    if (!serverName) {
      throw new AaiError('INVALID_REQUEST', 'Config contains mcpServers; provide --server to select one');
    }
    const selected = raw.mcpServers[serverName];
    if (!isJsonObject(selected)) {
      throw new AaiError('NOT_FOUND', `MCP server '${serverName}' not found in config`);
    }
    return selected;
  }

  if (serverName && isJsonObject(raw[serverName])) {
    return raw[serverName] as JsonObject;
  }

  return raw;
}

function normalizeServerObject(
  raw: JsonObject,
  options: { name?: string; sourcePath?: string },
): ImportedMcpSource {
  if (typeof raw.command === 'string') {
    return {
      kind: 'stdio',
      name: options.name,
      command: raw.command,
      args: readStringArray(raw.args),
      cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
      env: readStringMap(raw.env),
      sourcePath: options.sourcePath,
      rawConfig: raw,
    };
  }

  if (typeof raw.url === 'string') {
    return {
      kind: raw.transport === 'sse' ? 'sse' : 'streamable-http',
      name: options.name,
      url: raw.url,
      headers: readStringMap(raw.headers),
      sourcePath: options.sourcePath,
      rawConfig: raw,
    };
  }

  throw new AaiError(
    'INVALID_REQUEST',
    'Unsupported MCP config shape. Expected command/args or url/headers',
  );
}

function createImportedDescriptor(
  source: ImportedMcpSource,
  runtimeId: string,
  integrationId: string,
  catalog: Awaited<ReturnType<RpcExecutor['inspectSource']>>,
  summaries: ReturnType<typeof toPrimitiveSummaries>,
  options: ImportMcpOptions,
): AaiDescriptor {
  const now = new Date().toISOString();
  const displayName = options.displayName ?? source.name ?? source.command ?? source.url ?? integrationId;
  const runtime = createRuntime(source, runtimeId);

  return {
    schemaVersion: '2.0',
    identity: {
      id: integrationId,
      name: { en: displayName },
      defaultLang: 'en',
      title: displayName,
      description: `Imported MCP integration for ${displayName}`,
      version: options.version ?? '0.1.0',
      categories: ['mcp-import'],
      tags: ['mcp', 'imported', source.kind],
    },
    provenance: {
      sources: [
        {
          kind: 'generated',
          filePath: source.sourcePath,
          fetchedAt: now,
          digestSha256: createContentHash(source),
          note: 'Generated from MCP configuration by aai-gateway import-mcp',
        },
      ],
    },
    discovery: {
      mode: 'hybrid',
      refresh: {
        strategy: 'lazy',
        honorListChanged: Boolean(catalog.capabilities?.tools?.listChanged),
      },
    },
    disclosure: {
      mode: 'required',
      modelSurface: 'integration-only',
      detailLoad: 'on-demand',
      executionSurface: 'universal-exec',
      maxVisibleItems: 64,
    },
    runtimes: [runtime],
    catalog: {
      tools: {
        mode: catalog.tools.length > 0 ? 'hybrid' : 'live',
        sourceRuntimeId: runtimeId,
        listChanged: catalog.capabilities?.tools?.listChanged,
        summary: summaries.tools,
        snapshot: catalog.tools,
      },
      prompts: {
        mode: catalog.prompts.length > 0 ? 'hybrid' : 'live',
        sourceRuntimeId: runtimeId,
        listChanged: catalog.capabilities?.prompts?.listChanged,
        summary: summaries.prompts,
        snapshot: catalog.prompts,
      },
      resources: {
        mode: catalog.resources.length > 0 ? 'hybrid' : 'live',
        sourceRuntimeId: runtimeId,
        listChanged: catalog.capabilities?.resources?.listChanged,
        subscribe: catalog.capabilities?.resources?.subscribe,
        summary: summaries.resources,
        snapshot: catalog.resources,
      },
      resourceTemplates: {
        mode: catalog.resourceTemplates.length > 0 ? 'hybrid' : 'live',
        sourceRuntimeId: runtimeId,
        summary: summaries.resourceTemplates,
        snapshot: catalog.resourceTemplates,
      },
    },
    policy: {
      cache: {
        descriptorTtlSeconds: 300,
        catalogTtlSeconds: 300,
      },
      trust: {
        allowUnverifiedPublishers: true,
      },
    },
    _meta: {
      importedMcpSource: source,
    },
  };
}

function createRuntime(source: ImportedMcpSource, runtimeId: string): Runtime {
  if (source.kind === 'stdio' && source.command) {
    return {
      id: runtimeId,
      kind: 'rpc',
      protocol: 'mcp',
      default: true,
      label: source.name ?? source.command,
      transport: {
        type: 'stdio',
        command: source.command,
        args: source.args,
        cwd: source.cwd,
        env: source.env,
      },
    };
  }

  if ((source.kind === 'streamable-http' || source.kind === 'sse') && source.url) {
    return {
      id: runtimeId,
      kind: 'rpc',
      protocol: 'mcp',
      default: true,
      label: source.name ?? source.url,
      transport:
        source.kind === 'streamable-http'
          ? {
              type: 'streamable-http',
              url: source.url,
            }
          : {
              type: 'sse',
              url: source.url,
            },
      _meta: {
        importedHeaders: source.headers,
      },
    };
  }

  throw new AaiError('INVALID_REQUEST', 'Unable to create runtime from MCP source');
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
