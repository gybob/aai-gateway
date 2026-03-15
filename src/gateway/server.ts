import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { AaiError } from '../errors/errors.js';
import { getIntegrationDisplayName } from '../aai/types.js';
import { RpcExecutor } from '../executors/rpc-executor.js';
import { logger } from '../shared/logger.js';
import { expandUriTemplate, listUriTemplateVariables } from '../shared/uri-template.js';
import { DisclosureEngine } from './disclosure-engine.js';
import { ExecutorRouter } from './executor-router.js';
import { IntegrationRegistry } from './integration-registry.js';
import { PrimitiveResolver } from './primitive-resolver.js';

export class AaiGatewayServer {
  private readonly server: Server;

  constructor(
    private readonly registry = new IntegrationRegistry(),
    private readonly rpcExecutor = new RpcExecutor(),
    private readonly disclosure = new DisclosureEngine(),
    private readonly primitiveResolver = new PrimitiveResolver(rpcExecutor),
    private readonly executorRouter = new ExecutorRouter(rpcExecutor),
  ) {
    this.server = new Server(
      { name: 'aai-gateway', version: '2.0.0-alpha' },
      { capabilities: { tools: {} } },
    );
    this.setupHandlers();
  }

  async initialize(): Promise<void> {
    await this.registry.load();
    logger.info({ integrations: this.registry.list().length }, 'Gateway registry loaded');
  }

  async start(): Promise<void> {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('AAI Gateway MCP server started');
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.listModelTools() }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.invokeTool(name, readObject(args));
    });
  }

  listModelTools(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }> = this.registry.list().map((record) => ({
      name: `integration:${record.metadata.integrationId}`,
      description: buildIntegrationEntryDescription(record.descriptor),
      inputSchema: {
        type: 'object',
        properties: {},
      },
    }));

    tools.push({
      name: 'aai:exec',
      description:
        'Execute a primitive from an imported integration by integrationId and primitiveRef. Use after reading the integration guide.',
      inputSchema: {
        type: 'object',
        properties: {
          integrationId: {
            type: 'string',
            description: 'Imported integration identifier',
          },
          primitiveRef: {
            type: 'string',
            description: 'Stable primitive reference from the integration guide',
          },
          arguments: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments for the selected primitive, or URI template variables for resource templates',
          },
        },
        required: ['integrationId', 'primitiveRef'],
        additionalProperties: false,
      },
    });

    return tools;
  }

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    if (name.startsWith('integration:')) {
      return this.renderGuide(name.slice('integration:'.length));
    }

    if (name === 'aai:exec') {
      const integrationId = asRequiredString(args, 'integrationId');
      const primitiveRef = asRequiredString(args, 'primitiveRef');
      const callArguments = readObject(args.arguments);
      return this.executePrimitive(integrationId, primitiveRef, callArguments);
    }

    throw new AaiError('UNKNOWN_TOOL', `Unknown gateway tool '${name}'`);
  }

  private async renderGuide(integrationId: string): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const record = this.registry.get(integrationId);
    return {
      content: [{ type: 'text', text: this.disclosure.buildGuide(record.descriptor) }],
    };
  }

  private async executePrimitive(
    integrationId: string,
    primitiveRef: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const record = this.registry.get(integrationId);
    const summary = this.registry.resolveSummary(integrationId, primitiveRef);
    const runtime = this.registry.resolveRuntime(record.descriptor, summary.runtimeId);

    let result: unknown;

    switch (summary.kind) {
      case 'tool': {
        const tool = await this.primitiveResolver.resolveTool(record, summary);
        result = await this.executorRouter.executeTool(
          record.descriptor,
          runtime,
          summary,
          tool,
          args,
        );
        break;
      }
      case 'prompt': {
        await this.primitiveResolver.resolvePrompt(record, summary);
        const promptArgs = Object.fromEntries(
          Object.entries(args).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );
        result = await this.rpcExecutor.getPrompt(record.descriptor, runtime, summary.name, promptArgs);
        break;
      }
      case 'resource': {
        const resource = await this.primitiveResolver.resolveResource(record, summary);
        result = await this.rpcExecutor.readResource(record.descriptor, runtime, resource.uri);
        break;
      }
      case 'resource-template': {
        const template = await this.primitiveResolver.resolveResourceTemplate(record, summary);
        const resourceUri = expandUriTemplate(template.uriTemplate, args);

        if (resourceUri.includes('{')) {
          const requiredVariables = listUriTemplateVariables(template.uriTemplate);
          throw new AaiError(
            'INVALID_REQUEST',
            `Resource template '${template.name}' requires variables: ${requiredVariables.join(', ')}`,
          );
        }

        if (runtime.kind !== 'rpc') {
          throw new AaiError(
            'NOT_IMPLEMENTED',
            `Resource template execution currently requires an rpc runtime, got '${runtime.kind}'`,
          );
        }

        result = await this.rpcExecutor.readResource(record.descriptor, runtime, resourceUri);
        break;
      }
      default:
        throw new AaiError('NOT_IMPLEMENTED', `Unsupported primitive kind '${String(summary.kind)}'`);
    }

    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  }
}

export async function createGatewayServer(): Promise<AaiGatewayServer> {
  return new AaiGatewayServer();
}

function buildIntegrationEntryDescription(descriptor: ReturnType<IntegrationRegistry['get']>['descriptor']): string {
  const summaryCount = [
    ...(descriptor.catalog.tools.summary ?? []),
    ...(descriptor.catalog.prompts?.summary ?? []),
    ...(descriptor.catalog.resources?.summary ?? []),
    ...(descriptor.catalog.resourceTemplates?.summary ?? []),
  ].length;

  const parts = [
    getIntegrationDisplayName(descriptor),
    descriptor.identity.description ?? 'Imported integration',
    `${summaryCount} cached primitives`,
    `Use this entry to inspect available primitives before calling aai:exec.`,
  ];

  return parts.join(' | ');
}

function asRequiredString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>)[key] !== 'string') {
    throw new AaiError('INVALID_REQUEST', `Missing required string field '${key}'`);
  }
  return (value as Record<string, unknown>)[key] as string;
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
