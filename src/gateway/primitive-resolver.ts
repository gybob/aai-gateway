import { AaiError } from '../errors/errors.js';
import type {
  AaiDescriptor,
  ManagedIntegrationRecord,
  PrimitiveSummary,
  PromptDef,
  ResourceDef,
  ResourceTemplateDef,
  Runtime,
  ToolDef,
} from '../aai/types.js';
import { RpcExecutor } from '../executors/rpc-executor.js';
import { ManagedIntegrationStore } from './managed-store.js';

export class PrimitiveResolver {
  constructor(
    private readonly rpcExecutor = new RpcExecutor(),
    private readonly store = new ManagedIntegrationStore(),
  ) {}

  async resolveTool(record: ManagedIntegrationRecord, summary: PrimitiveSummary): Promise<ToolDef> {
    const existing = record.descriptor.catalog.tools.snapshot?.find((tool) => tool.ref === summary.ref);
    if (existing) {
      return existing;
    }

    const refreshed = await this.refreshDescriptor(record);
    const tool = refreshed.descriptor.catalog.tools.snapshot?.find((entry) => entry.ref === summary.ref);
    if (!tool) {
      throw new AaiError('NOT_FOUND', `Tool '${summary.ref}' not found after refresh`);
    }
    return tool;
  }

  async resolvePrompt(record: ManagedIntegrationRecord, summary: PrimitiveSummary): Promise<PromptDef> {
    const existing = record.descriptor.catalog.prompts?.snapshot?.find((entry) => entry.ref === summary.ref);
    if (existing) {
      return existing;
    }

    const refreshed = await this.refreshDescriptor(record);
    const prompt = refreshed.descriptor.catalog.prompts?.snapshot?.find((entry) => entry.ref === summary.ref);
    if (!prompt) {
      throw new AaiError('NOT_FOUND', `Prompt '${summary.ref}' not found after refresh`);
    }
    return prompt;
  }

  async resolveResource(record: ManagedIntegrationRecord, summary: PrimitiveSummary): Promise<ResourceDef> {
    const existing = record.descriptor.catalog.resources?.snapshot?.find((entry) => entry.ref === summary.ref);
    if (existing) {
      return existing;
    }

    const refreshed = await this.refreshDescriptor(record);
    const resource = refreshed.descriptor.catalog.resources?.snapshot?.find((entry) => entry.ref === summary.ref);
    if (!resource) {
      throw new AaiError('NOT_FOUND', `Resource '${summary.ref}' not found after refresh`);
    }
    return resource;
  }

  async resolveResourceTemplate(
    record: ManagedIntegrationRecord,
    summary: PrimitiveSummary,
  ): Promise<ResourceTemplateDef> {
    const existing = record.descriptor.catalog.resourceTemplates?.snapshot?.find((entry) => entry.ref === summary.ref);
    if (existing) {
      return existing;
    }

    const refreshed = await this.refreshDescriptor(record);
    const template = refreshed.descriptor.catalog.resourceTemplates?.snapshot?.find(
      (entry) => entry.ref === summary.ref,
    );
    if (!template) {
      throw new AaiError('NOT_FOUND', `Resource template '${summary.ref}' not found after refresh`);
    }
    return template;
  }

  async refreshDescriptor(record: ManagedIntegrationRecord): Promise<ManagedIntegrationRecord> {
    const source = readImportedSource(record.descriptor);
    if (!source) {
      throw new AaiError(
        'NOT_IMPLEMENTED',
        `Integration '${record.metadata.integrationId}' cannot be refreshed because source metadata is missing`,
      );
    }

    const runtime = resolvePrimaryRuntime(record.descriptor);
    const catalog = await this.rpcExecutor.inspectRuntime(runtime);
    const summaries = buildSummariesFromCatalog(catalog);
    const descriptor: AaiDescriptor = {
      ...record.descriptor,
      discovery: {
        mode: record.descriptor.discovery?.mode ?? 'hybrid',
        ...record.descriptor.discovery,
        refresh: {
          ...record.descriptor.discovery?.refresh,
          honorListChanged: Boolean(catalog.capabilities?.tools?.listChanged),
        },
      },
      catalog: {
        ...record.descriptor.catalog,
        tools: {
          ...record.descriptor.catalog.tools,
          summary: summaries.tools,
          snapshot: catalog.tools,
          listChanged: catalog.capabilities?.tools?.listChanged,
        },
        prompts: {
          ...(record.descriptor.catalog.prompts ?? { mode: 'live', sourceRuntimeId: runtime.id }),
          summary: summaries.prompts,
          snapshot: catalog.prompts,
          listChanged: catalog.capabilities?.prompts?.listChanged,
        },
        resources: {
          ...(record.descriptor.catalog.resources ?? { mode: 'live', sourceRuntimeId: runtime.id }),
          summary: summaries.resources,
          snapshot: catalog.resources,
          listChanged: catalog.capabilities?.resources?.listChanged,
          subscribe: catalog.capabilities?.resources?.subscribe,
        },
        resourceTemplates: {
          ...(record.descriptor.catalog.resourceTemplates ?? { mode: 'live', sourceRuntimeId: runtime.id }),
          summary: summaries.resourceTemplates,
          snapshot: catalog.resourceTemplates,
        },
      },
      _meta: {
        ...record.descriptor._meta,
        importedMcpSource: source,
      },
    };

    return this.store.put(descriptor, {
      integrationId: record.metadata.integrationId,
      importedAt: record.metadata.importedAt,
      sourceType: record.metadata.sourceType,
      sourceHash: record.metadata.sourceHash,
      converterVersion: record.metadata.converterVersion,
      notes: record.metadata.notes,
    });
  }
}

function resolvePrimaryRuntime(descriptor: AaiDescriptor): Runtime {
  return descriptor.runtimes.find((runtime) => runtime.default) ?? descriptor.runtimes[0];
}

function readImportedSource(descriptor: AaiDescriptor): Record<string, unknown> | undefined {
  const value = descriptor._meta?.importedMcpSource;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function buildSummariesFromCatalog(catalog: Awaited<ReturnType<RpcExecutor['inspectRuntime']>>) {
  return {
    tools: catalog.tools.map((tool) => ({
      ref: tool.ref ?? `tool:${tool.name}`,
      kind: 'tool' as const,
      name: tool.name,
      title: tool.title,
      description: tool.description,
      runtimeId: tool.runtimeId,
    })),
    prompts: catalog.prompts.map((prompt) => ({
      ref: prompt.ref ?? `prompt:${prompt.name}`,
      kind: 'prompt' as const,
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      runtimeId: prompt.runtimeId,
    })),
    resources: catalog.resources.map((resource) => ({
      ref: resource.ref ?? `resource:${resource.uri}`,
      kind: 'resource' as const,
      name: resource.name,
      title: resource.title,
      description: resource.description,
      runtimeId: resource.runtimeId,
    })),
    resourceTemplates: catalog.resourceTemplates.map((template) => ({
      ref: template.ref ?? `resource-template:${template.uriTemplate}`,
      kind: 'resource-template' as const,
      name: template.name,
      title: template.title,
      description: template.description,
      runtimeId: template.runtimeId,
    })),
  };
}
