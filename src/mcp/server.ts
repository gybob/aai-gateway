/**
 * MCP Server
 *
 * Thin protocol layer — handles MCP request/response serialization
 * and delegates all business logic to Gateway (core/gateway.ts).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { AaiError } from '../errors/errors.js';
import type { CallerContext } from '../types/caller.js';
import { logger } from '../utils/logger.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';
import { Gateway, type GatewayTextResult } from '../core/gateway.js';
import { normalizeArgumentsWithSchema } from '../core/parsers.js';

const TOOLS_CHANGING_OPERATIONS = new Set([
  'mcp:import', 'skill:import', 'disableApp', 'enableApp', 'removeApp',
]);

export class AaiGatewayServer {
  private readonly server: Server;
  private readonly gateway = new Gateway();
  private callerContext?: CallerContext;

  constructor() {
    this.server = new Server(
      { name: AAI_GATEWAY_NAME, version: AAI_GATEWAY_VERSION },
      {
        capabilities: {
          tools: { listChanged: true },
          logging: {},
        },
      }
    );
    this.setupHandlers();
  }

  async initialize(): Promise<void> {
    await this.gateway.initialize();
  }

  async start(): Promise<void> {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('AAI Gateway started (stdio)');
  }

  // ============================================================
  // MCP Protocol Handlers
  // ============================================================

  private setupHandlers(): void {
    this.server.oninitialized = () => {
      const clientVersion = this.server.getClientVersion();
      this.callerContext = this.gateway.createCallerContext(clientVersion);
    };

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.gateway.listTools(this.requireCaller());
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: rawArgs } = request.params;
      const caller = this.requireCaller();

      // Normalize args against tool schema if available
      const toolDef = this.gateway.getGatewayToolDefinition(name);
      const args = toolDef
        ? (normalizeArgumentsWithSchema(rawArgs, toolDef.inputSchema) as
            | Record<string, unknown>
            | undefined)
        : rawArgs;

      // app:<id> → guide
      if (name.startsWith('app:')) {
        return this.toCallToolResult(
          await this.gateway.handleAppGuide(name.slice(4), caller)
        );
      }

      // aai:exec → dispatch
      if (name === 'aai:exec') {
        const payload = args as { app?: string; tool: string; args?: Record<string, unknown> };
        const result = await this.gateway.handleExec(
          extra.requestId,
          payload.app,
          payload.tool,
          payload.args ?? {},
          caller
        );
        if (TOOLS_CHANGING_OPERATIONS.has(payload.tool) && !result.isError) {
          await this.notifyToolsListChanged();
        }
        return this.toCallToolResult(result);
      }

      // mcp:import / skill:import → always return guide (actual import via aai:exec)
      if (name === 'mcp:import' || name === 'skill:import') {
        return this.toCallToolResult(this.gateway.handleGatewayToolGuide(name));
      }

      // Management tools routed through exec
      if (
        name === 'search:discover' ||
        name === 'listAllAaiApps' ||
        name === 'disableApp' ||
        name === 'enableApp' ||
        name === 'removeApp'
      ) {
        const toolArgs = (args as Record<string, unknown> | undefined) ?? {};
        let result: GatewayTextResult;

        switch (name) {
          case 'search:discover':
            result = this.gateway.handleSearchDiscover(toolArgs);
            break;
          case 'listAllAaiApps':
            result = await this.gateway.handleListAllApps(caller);
            break;
          case 'disableApp':
            result = await this.gateway.handleDisableApp(toolArgs, caller);
            await this.notifyToolsListChanged();
            break;
          case 'enableApp':
            result = await this.gateway.handleEnableApp(toolArgs, caller);
            await this.notifyToolsListChanged();
            break;
          case 'removeApp':
            result = await this.gateway.handleRemoveApp(toolArgs, caller);
            await this.notifyToolsListChanged();
            break;
          default:
            throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
        }

        return this.toCallToolResult(result);
      }

      throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
    });
  }

  // ============================================================
  // Helpers
  // ============================================================

  private requireCaller(): CallerContext {
    if (this.callerContext) return this.callerContext;
    return {
      id: 'unknown-client',
      name: 'Unknown Client',
      transport: 'mcp',
      type: 'unknown',
    };
  }

  private async notifyToolsListChanged(): Promise<void> {
    try {
      await this.server.sendToolListChanged();
      logger.debug('Sent tools/listChanged notification');
    } catch (error) {
      logger.error({ err: error }, 'Failed to send tools/listChanged notification');
    }
  }

  private toCallToolResult(result: GatewayTextResult): CallToolResult {
    return {
      content: [{ type: 'text', text: result.text }],
      ...(result.isError ? { isError: true } : {}),
      ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    };
  }
}

export async function createGatewayServer(): Promise<AaiGatewayServer> {
  return new AaiGatewayServer();
}
