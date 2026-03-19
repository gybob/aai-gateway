import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AaiError } from '../errors/errors.js';
import type {
  McpConfig,
  McpExecutorConfig,
  McpExecutorDetail,
  ExecutionResult,
} from '../types/index.js';
import type { Executor } from './interface.js';

export interface McpListedTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, object>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpConnectionTarget {
  localId: string;
  config: McpConfig;
  headers?: Record<string, string>;
}

interface ClientState {
  client: Client;
  targetKey: string;
  config: McpConfig;
  headers?: Record<string, string>;
}

function serializeTarget(target: McpConnectionTarget): string {
  return JSON.stringify({ config: target.config, headers: target.headers ?? {} });
}

/**
 * MCP Executor implementation
 *
 * Implements the unified Executor interface for MCP servers.
 */
export class McpExecutor implements Executor<McpConfig & McpExecutorConfig, McpExecutorDetail> {
  readonly protocol = 'mcp';
  private clients = new Map<string, ClientState>();

  async connect(localId: string, config: McpConfig & McpExecutorConfig): Promise<void> {
    const targetKey = JSON.stringify(config);
    const existing = this.clients.get(localId);
    if (existing && existing.targetKey === targetKey) {
      return;
    }

    if (existing) {
      await this.disconnect(localId);
    }

    const client = new Client({ name: 'aai-gateway', version: '0.3.5' }, { capabilities: {} });
    const transport = this.createTransport(config);

    try {
      await client.connect(transport);
      this.clients.set(localId, { client, targetKey, config });
    } catch (err) {
      throw new AaiError(
        'SERVICE_UNAVAILABLE',
        `Failed to connect MCP app '${localId}': ${String(err)}`
      );
    }
  }

  async disconnect(localId: string): Promise<void> {
    const existing = this.clients.get(localId);
    if (!existing) return;
    this.clients.delete(localId);
    try {
      await existing.client.close();
    } catch {
      // ignore
    }
  }

  async loadDetail(config: McpConfig & McpExecutorConfig): Promise<McpExecutorDetail> {
    // Use a temporary connection to load tools
    const tempId = `temp-${Date.now()}`;
    await this.connect(tempId, config);
    try {
      const tools = await this.listTools({ localId: tempId, config });
      return { tools };
    } finally {
      await this.disconnect(tempId);
    }
  }

  async execute(
    localId: string,
    config: McpConfig & McpExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    try {
      const data = await this.callTool({ localId, config }, operation, args);
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async health(localId: string): Promise<boolean> {
    const existing = this.clients.get(localId);
    return !!existing;
  }

  // Legacy methods for backward compatibility

  async connectLegacy(target: McpConnectionTarget): Promise<Client> {
    const targetKey = serializeTarget(target);
    const existing = this.clients.get(target.localId);
    if (existing && existing.targetKey === targetKey) {
      return existing.client;
    }

    if (existing) {
      await this.close(target.localId);
    }

    await this.connect(target.localId, target.config);

    const client = this.clients.get(target.localId)?.client;
    if (!client) {
      throw new Error('Failed to get client after connection');
    }

    // Store headers for future use
    if (this.clients.has(target.localId)) {
      const state = this.clients.get(target.localId)!;
      state.headers = target.headers;
      state.targetKey = targetKey;
    }

    return client;
  }

  async listTools(target: McpConnectionTarget): Promise<McpListedTool[]> {
    const client = await this.connectLegacy(target);
    try {
      const result = await client.listTools();
      return result.tools as McpListedTool[];
    } catch (err) {
      await this.close(target.localId);
      throw new AaiError(
        'EXECUTION_ERROR',
        `Failed to list tools for '${target.localId}': ${String(err)}`
      );
    }
  }

  async callTool(
    target: McpConnectionTarget,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const execute = async (): Promise<unknown> => {
      const client = await this.connectLegacy(target);
      const result = (await client.callTool({
        name: toolName,
        arguments: args,
      })) as {
        structuredContent?: unknown;
        content?: Array<{ type?: string; text?: string }>;
      };

      if (result.structuredContent) {
        return result.structuredContent;
      }
      if (result.content?.length === 1 && result.content[0]?.type === 'text') {
        return result.content[0].text;
      }
      return result.content ?? null;
    };

    try {
      return await execute();
    } catch (err) {
      await this.close(target.localId);
      try {
        return await execute();
      } catch (retryErr) {
        throw new AaiError(
          'EXECUTION_ERROR',
          `MCP tool '${toolName}' failed for '${target.localId}': ${String(retryErr ?? err)}`
        );
      }
    }
  }

  async close(localId: string): Promise<void> {
    return this.disconnect(localId);
  }

  private createTransport(config: McpConfig & McpExecutorConfig) {
    switch (config.transport) {
      case 'stdio':
        return new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env,
          cwd: config.cwd,
          stderr: 'pipe',
        });
      case 'streamable-http':
        return new StreamableHTTPClientTransport(new URL(config.url));
      case 'sse':
        return new SSEClientTransport(new URL(config.url));
    }
  }
}

let singleton: McpExecutor | undefined;

export function getMcpExecutor(): McpExecutor {
  if (!singleton) {
    singleton = new McpExecutor();
  }
  return singleton;
}
