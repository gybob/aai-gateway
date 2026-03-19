import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AaiError } from '../errors/errors.js';
import type { McpConfig } from '../types/aai-json.js';

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
}

function serializeTarget(target: McpConnectionTarget): string {
  return JSON.stringify({ config: target.config, headers: target.headers ?? {} });
}

export class McpExecutor {
  private clients = new Map<string, ClientState>();

  async connect(target: McpConnectionTarget): Promise<Client> {
    const targetKey = serializeTarget(target);
    const existing = this.clients.get(target.localId);
    if (existing && existing.targetKey === targetKey) {
      return existing.client;
    }

    if (existing) {
      await this.close(target.localId);
    }

    const client = new Client({ name: 'aai-gateway', version: '0.3.5' }, { capabilities: {} });
    const transport = this.createTransport(target);

    try {
      await client.connect(transport);
    } catch (err) {
      throw new AaiError(
        'SERVICE_UNAVAILABLE',
        `Failed to connect MCP app '${target.localId}': ${String(err)}`
      );
    }

    this.clients.set(target.localId, { client, targetKey });
    return client;
  }

  async listTools(target: McpConnectionTarget): Promise<McpListedTool[]> {
    const client = await this.connect(target);
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
      const client = await this.connect(target);
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
    const existing = this.clients.get(localId);
    if (!existing) return;
    this.clients.delete(localId);
    try {
      await existing.client.close();
    } catch {
      // ignore
    }
  }

  private createTransport(target: McpConnectionTarget) {
    const { config, headers } = target;

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
        return new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers },
        });
      case 'sse':
        return new SSEClientTransport(new URL(config.url), {
          requestInit: { headers },
        });
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
