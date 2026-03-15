import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { AaiError } from '../errors/errors.js';
import { createPrimitiveRef } from '../aai/ids.js';
import { logger } from '../shared/logger.js';
import type {
  AaiDescriptor,
  ImportedMcpSource,
  ImportedPrimitiveCatalog,
  PrimitiveSummary,
  PromptDef,
  ResourceDef,
  ResourceTemplateDef,
  Runtime,
  RuntimeCapabilities,
  ToolDef,
} from '../aai/types.js';

type ConnectedSession = {
  client: Client;
  transport: Transport;
};

type ToolLike = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolDef['annotations'];
  execution?: ToolDef['execution'];
  icons?: ToolDef['icons'];
  _meta?: Record<string, unknown>;
};

type PromptLike = {
  name: string;
  title?: string;
  description?: string;
  arguments?: PromptDef['arguments'];
  icons?: PromptDef['icons'];
  _meta?: Record<string, unknown>;
};

type ResourceLike = {
  name: string;
  title?: string;
  uri: string;
  description?: string;
  mimeType?: string;
  icons?: ResourceDef['icons'];
  size?: number;
  annotations?: ResourceDef['annotations'];
  _meta?: Record<string, unknown>;
};

type ResourceTemplateLike = {
  name: string;
  title?: string;
  uriTemplate: string;
  description?: string;
  mimeType?: string;
  icons?: ResourceTemplateDef['icons'];
  annotations?: ResourceTemplateDef['annotations'];
  _meta?: Record<string, unknown>;
};

export class RpcExecutor {
  private readonly sessions = new Map<string, ConnectedSession>();

  async inspectSource(source: ImportedMcpSource, runtimeId: string): Promise<ImportedPrimitiveCatalog> {
    const runtime = createRuntimeFromSource(source);
    runtime.id = runtimeId;
    return this.inspectRuntime(runtime);
  }

  async inspectRuntime(runtime: Runtime): Promise<ImportedPrimitiveCatalog> {
    const { client, transport } = await this.connectRuntime(runtime);
    const runtimeId = runtime.id;

    try {
      const capabilities = mapRuntimeCapabilities(client.getServerCapabilities());
      const [toolsResult, promptsResult, resourcesResult, templatesResult] = await Promise.all([
        safeList(() => client.listTools()),
        safeList(() => client.listPrompts()),
        safeList(() => client.listResources()),
        safeList(() => client.listResourceTemplates()),
      ]);

      return {
        tools: (toolsResult?.tools ?? []).map((tool) => mapTool(tool as ToolLike, runtimeId)),
        prompts: (promptsResult?.prompts ?? []).map((prompt) => mapPrompt(prompt as PromptLike, runtimeId)),
        resources: (resourcesResult?.resources ?? []).map((resource) =>
          mapResource(resource as ResourceLike, runtimeId),
        ),
        resourceTemplates: (templatesResult?.resourceTemplates ?? []).map((template) =>
          mapResourceTemplate(template as ResourceTemplateLike, runtimeId),
        ),
        capabilities,
      };
    } finally {
      await transport.close();
    }
  }

  async callTool(
    descriptor: AaiDescriptor,
    runtime: Runtime,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = await this.getClient(descriptor, runtime);
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    return result;
  }

  async getPrompt(
    descriptor: AaiDescriptor,
    runtime: Runtime,
    promptName: string,
    args: Record<string, string>,
  ): Promise<unknown> {
    const client = await this.getClient(descriptor, runtime);
    return client.getPrompt({
      name: promptName,
      arguments: args,
    });
  }

  async readResource(
    descriptor: AaiDescriptor,
    runtime: Runtime,
    uri: string,
  ): Promise<unknown> {
    const client = await this.getClient(descriptor, runtime);
    return client.readResource({ uri });
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.transport.close();
    }
    this.sessions.clear();
  }

  private async getClient(descriptor: AaiDescriptor, runtime: Runtime): Promise<Client> {
    const sessionKey = `${descriptor.identity.id}:${runtime.id}`;
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      return existing.client;
    }

    const session = await this.connectRuntime(runtime);
    this.sessions.set(sessionKey, session);
    return session.client;
  }

  private async connectRuntime(runtime: Runtime): Promise<ConnectedSession> {
    const client = new Client(
      { name: 'aai-gateway', version: '2.0.0-alpha' },
      { capabilities: {} },
    );
    const transport = createTransport(runtime);
    await client.connect(transport);
    logger.info({ runtimeId: runtime.id, protocol: runtime.protocol }, 'RPC runtime connected');
    return { client, transport };
  }
}

function createRuntimeFromSource(source: ImportedMcpSource): Runtime {
  if (source.kind === 'stdio' && source.command) {
    return {
      id: 'introspection-runtime',
      kind: 'rpc',
      protocol: 'mcp',
      default: true,
      transport: {
        type: 'stdio',
        command: source.command,
        args: source.args,
        cwd: source.cwd,
        env: source.env,
      },
    };
  }

  if (source.kind === 'streamable-http' && source.url) {
    return {
      id: 'introspection-runtime',
      kind: 'rpc',
      protocol: 'mcp',
      default: true,
      transport: {
        type: 'streamable-http',
        url: source.url,
      },
      _meta: {
        importedHeaders: source.headers,
      },
    };
  }

  if (source.kind === 'sse' && source.url) {
    return {
      id: 'introspection-runtime',
      kind: 'rpc',
      protocol: 'mcp',
      default: true,
      transport: {
        type: 'sse',
        url: source.url,
      },
      _meta: {
        importedHeaders: source.headers,
      },
    };
  }

  throw new AaiError('INVALID_REQUEST', 'Unsupported MCP source configuration');
}

function createTransport(runtime: Runtime): Transport {
  if (runtime.transport.type === 'stdio') {
    return new StdioClientTransport({
      command: runtime.transport.command,
      args: runtime.transport.args,
      cwd: runtime.transport.cwd,
      env: runtime.transport.env,
      stderr: 'inherit',
    });
  }

  const importedHeaders = readImportedHeaders(runtime);
  const requestInit = importedHeaders ? { headers: importedHeaders } : undefined;

  if (runtime.transport.type === 'streamable-http') {
    return new StreamableHTTPClientTransport(new URL(runtime.transport.url), {
      requestInit,
    });
  }

  if (runtime.transport.type === 'sse') {
    return new SSEClientTransport(new URL(runtime.transport.url), {
      requestInit,
    });
  }

  throw new AaiError(
    'INVALID_REQUEST',
    `RpcExecutor only supports stdio/streamable-http/sse transports, got '${runtime.transport.type}'`,
  );
}

function readImportedHeaders(runtime: Runtime): Record<string, string> | undefined {
  const rawHeaders = runtime._meta?.importedHeaders;
  if (!rawHeaders || typeof rawHeaders !== 'object') {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(rawHeaders).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function mapRuntimeCapabilities(capabilities: unknown): RuntimeCapabilities | undefined {
  if (!capabilities || typeof capabilities !== 'object') {
    return undefined;
  }

  const candidate = capabilities as Record<string, unknown>;
  return {
    prompts: readListChangedCapability(candidate.prompts),
    resources: readResourceCapability(candidate.resources),
    tools: readListChangedCapability(candidate.tools),
    logging: Boolean(candidate.logging),
    completions: Boolean(candidate.completions),
  };
}

function readListChangedCapability(value: unknown): { listChanged?: boolean } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  return { listChanged: typeof candidate.listChanged === 'boolean' ? candidate.listChanged : undefined };
}

function readResourceCapability(
  value: unknown,
): { subscribe?: boolean; listChanged?: boolean } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  return {
    subscribe: typeof candidate.subscribe === 'boolean' ? candidate.subscribe : undefined,
    listChanged: typeof candidate.listChanged === 'boolean' ? candidate.listChanged : undefined,
  };
}

async function safeList<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logger.debug({ err: error }, 'Optional MCP listing unavailable');
    return null;
  }
}

function mapTool(tool: ToolLike, runtimeId: string): ToolDef {
  return {
    ref: createPrimitiveRef('tool', tool.name),
    name: tool.name,
    title: tool.title,
    description: tool.description,
    icons: tool.icons,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    execution: tool.execution,
    runtimeId,
    binding: {
      type: 'mcp-tool',
      toolName: tool.name,
    },
    _meta: tool._meta,
  };
}

function mapPrompt(prompt: PromptLike, runtimeId: string): PromptDef {
  return {
    ref: createPrimitiveRef('prompt', prompt.name),
    name: prompt.name,
    title: prompt.title,
    description: prompt.description,
    icons: prompt.icons,
    arguments: prompt.arguments,
    runtimeId,
    _meta: prompt._meta,
  };
}

function mapResource(resource: ResourceLike, runtimeId: string): ResourceDef {
  return {
    ref: createPrimitiveRef('resource', resource.uri),
    name: resource.name,
    title: resource.title,
    uri: resource.uri,
    description: resource.description,
    mimeType: resource.mimeType,
    icons: resource.icons,
    size: resource.size,
    annotations: resource.annotations,
    runtimeId,
    _meta: resource._meta,
  };
}

function mapResourceTemplate(template: ResourceTemplateLike, runtimeId: string): ResourceTemplateDef {
  return {
    ref: createPrimitiveRef('resource-template', template.uriTemplate),
    name: template.name,
    title: template.title,
    uriTemplate: template.uriTemplate,
    description: template.description,
    mimeType: template.mimeType,
    icons: template.icons,
    annotations: template.annotations,
    runtimeId,
    _meta: template._meta,
  };
}

export function toPrimitiveSummaries(catalog: ImportedPrimitiveCatalog): {
  tools: PrimitiveSummary[];
  prompts: PrimitiveSummary[];
  resources: PrimitiveSummary[];
  resourceTemplates: PrimitiveSummary[];
} {
  return {
    tools: catalog.tools.map((tool) => ({
      ref: tool.ref ?? createPrimitiveRef('tool', tool.name),
      kind: 'tool',
      name: tool.name,
      title: tool.title,
      description: tool.description,
      runtimeId: tool.runtimeId,
    })),
    prompts: catalog.prompts.map((prompt) => ({
      ref: prompt.ref ?? createPrimitiveRef('prompt', prompt.name),
      kind: 'prompt',
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      runtimeId: prompt.runtimeId,
    })),
    resources: catalog.resources.map((resource) => ({
      ref: resource.ref ?? createPrimitiveRef('resource', resource.uri),
      kind: 'resource',
      name: resource.name,
      title: resource.title,
      description: resource.description,
      runtimeId: resource.runtimeId,
    })),
    resourceTemplates: catalog.resourceTemplates.map((template) => ({
      ref: template.ref ?? createPrimitiveRef('resource-template', template.uriTemplate),
      kind: 'resource-template',
      name: template.name,
      title: template.title,
      description: template.description,
      runtimeId: template.runtimeId,
    })),
  };
}
