import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { AaiError } from '../errors/errors.js';
import type {
  McpConfig,
  McpExecutorDetail,
  ExecutionResult,
} from '../types/index.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';

import type { ExecutionObserver } from './events.js';
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

export interface McpServerInfo {
  name: string;
  version: string;
}

interface ClientState {
  client: Client;
  targetKey: string;
  config: McpConfig;
  headers?: Record<string, string>;
  activityListeners: Set<(message: unknown) => void>;
}

function serializeTarget(target: McpConnectionTarget): string {
  return JSON.stringify({ config: target.config, headers: target.headers ?? {} });
}

const MCP_MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

/**
 * MCP Executor implementation
 *
 * Implements the unified Executor interface for MCP servers.
 */
export class McpExecutor implements Executor<McpConfig  , McpExecutorDetail> {
  readonly protocol = 'mcp';
  private clients = new Map<string, ClientState>();

  async connect(localId: string, config: McpConfig  ): Promise<void> {
    const targetKey = JSON.stringify(config);
    const existing = this.clients.get(localId);
    if (existing && existing.targetKey === targetKey) {
      return;
    }

    if (existing) {
      await this.disconnect(localId);
    }

    const client = new Client(
      { name: AAI_GATEWAY_NAME, version: AAI_GATEWAY_VERSION },
      { capabilities: {} }
    );
    const transport = this.createTransport(config);
    const activityListeners = new Set<(message: unknown) => void>();
    transport.onmessage = (message) => {
      for (const listener of Array.from(activityListeners)) {
        listener(message);
      }
    };

    try {
      await client.connect(transport);
      this.clients.set(localId, { client, targetKey, config, activityListeners });
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

  async loadDetail(config: McpConfig  ): Promise<McpExecutorDetail> {
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
    config: McpConfig  ,
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

  async getServerInfo(target: McpConnectionTarget): Promise<McpServerInfo | undefined> {
    const client = await this.connectLegacy(target);
    return client.getServerVersion() as McpServerInfo | undefined;
  }

  async callTool(
    target: McpConnectionTarget,
    toolName: string,
    args: Record<string, unknown>,
    observer?: ExecutionObserver
  ): Promise<unknown> {
    const execute = async (): Promise<unknown> => {
      const client = await this.connectLegacy(target);
      const state = this.clients.get(target.localId);
      if (!state) {
        throw new AaiError('SERVICE_UNAVAILABLE', `MCP app '${target.localId}' is not connected`);
      }

      const activityListener = (message: unknown) => {
        const notificationMessage = extractNotificationMessage(message);
        if (notificationMessage) {
          void observer?.onMessage?.({ message: notificationMessage });
        }
      };

      state.activityListeners.add(activityListener);

      try {
        const result = (await client.callTool(
          {
            name: toolName,
            arguments: args,
          },
          undefined,
          {
            timeout: MCP_MAX_REQUEST_TIMEOUT_MS,
            onprogress: (progress) => {
              void observer?.onProgress?.({
                progress: progress.progress,
                ...(progress.message ? { message: progress.message } : {}),
              });
            },
          }
        )) as {
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
      } finally {
        state.activityListeners.delete(activityListener);
      }
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

  private createTransport(config: McpConfig  ) {
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

function extractNotificationMessage(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const method = (message as { method?: unknown }).method;
  if (method !== 'notifications/message') {
    return null;
  }

  const params = (message as { params?: unknown }).params;
  if (!params || typeof params !== 'object') {
    return null;
  }

  const data = (params as { data?: unknown }).data;
  if (typeof data === 'string' && data.length > 0) {
    return data;
  }

  if (data !== undefined) {
    const serialized = JSON.stringify(data);
    return serialized && serialized !== 'null' ? serialized : null;
  }

  return null;
}

let singleton: McpExecutor | undefined;

export function getMcpExecutor(): McpExecutor {
  if (!singleton) {
    singleton = new McpExecutor();
  }
  return singleton;
}
