import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { AaiError } from '../errors/errors.js';
import type {
  McpConfig,
  ExecutionResult,
} from '../types/index.js';
import type { AppCapabilities, ToolSchema } from '../types/capabilities.js';
import { logger } from '../utils/logger.js';
import { AAI_GATEWAY_NAME, AAI_GATEWAY_VERSION } from '../version.js';
import { validateArgs, formatValidationErrors } from '../utils/schema-validator.js';

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
  appId: string;
  config: McpConfig;
  headers?: Record<string, string>;
}

interface ClientState {
  client: Client;
  targetKey: string;
  config: McpConfig;
  headers?: Record<string, string>;
  activityListeners: Set<(message: unknown) => void>;
}

interface McpServerInfo {
  name?: string;
  version?: string;
  [key: string]: unknown;
}

const MCP_MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

/**
 * MCP Executor implementation
 *
 * Implements the unified Executor interface for MCP servers.
 */
export class McpExecutor implements Executor {
  readonly protocol = 'mcp';
  private clients = new Map<string, ClientState>();

  // Cache: appId → MCP tools (原始数据，含 inputSchema)
  private toolsCache = new Map<string, McpListedTool[]>();

  // Secure storage for MCP headers
  secureStorage?: SecureStorage;

  constructor(secureStorage?: SecureStorage) {
    this.secureStorage = secureStorage;
  }

  async connect(appId: string, config: McpConfig): Promise<void> {
    const targetKey = JSON.stringify(config);
    const existing = this.clients.get(appId);
    if (existing && existing.targetKey === targetKey) {
      return;
    }

    if (existing) {
      await this.disconnect(appId);
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
      this.clients.set(appId, { client, targetKey, config, activityListeners });
      logger.info({ appId, config: summarizeMcpConfig(config) }, 'MCP connection established');
    } catch (err) {
      logger.error({ appId, config: summarizeMcpConfig(config), err }, 'MCP connection failed');
      throw new AaiError(
        'SERVICE_UNAVAILABLE',
        `Failed to connect MCP app '${appId}': ${String(err)}`
      );
    }
  }

  async disconnect(appId: string): Promise<void> {
    const existing = this.clients.get(appId);
    if (!existing) return;
    this.clients.delete(appId);
    try {
      await existing.client.close();
    } catch {
      // ignore
    }
    // Clear tools cache for this appId
    this.toolsCache.delete(appId);
  }


  /**
   * Load app-level capabilities (tool list without parameter definitions)
   * This guides agents to use schema endpoint for parameter details
   */
  async loadAppCapabilities(appId: string, config: McpConfig): Promise<AppCapabilities> {
    const headers = await loadImportedMcpHeaders(this.secureStorage, appId);
    const result = await this.listTools({ appId, config, headers });

    // Cache the full tools data (含 inputSchema)
    this.toolsCache.set(appId, result);

    // Return only tool summaries (不含 schema)
    const tools = result.map((t) => ({
      name: t.name,
      description: t.description ?? '',
    }));

    return { title: 'MCP Tools', tools };
  }

  /**
   * Load schema for a specific tool
   * Looks up from cache, returns null if not found
   */
  async loadToolSchema(
    appId: string,
    config: McpConfig,
    toolName: string
  ): Promise<ToolSchema | null> {
    // Try cache first
    let tools = this.toolsCache.get(appId);

    // Cache miss - reload from MCP
    if (!tools) {
      await this.loadAppCapabilities(appId, config);
      tools = this.toolsCache.get(appId);
      if (!tools) return null;
    }

    const tool = tools.find((t) => t.name === toolName);
    if (!tool) return null;

    return {
      name: tool.name,
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    };
  }

  async execute(
    appId: string,
    config: McpConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    // Get schema for validation
    const schema = await this.loadToolSchema(appId, config, operation);

    // Validate if schema is available
    if (schema) {
      const result = validateArgs(args, schema.inputSchema);
      if (!result.valid) {
        const errorMessage = `参数校验失败 for '${operation}'\n${formatValidationErrors(result)}`;
        return {
          success: false,
          error: errorMessage,
          schema: schema.inputSchema,
          suggestion: `请参考 schema 重试:\n${JSON.stringify(schema.inputSchema, null, 2)}`,
        };
      }
    }

    try {
      const data = await this.callTool(
        { appId, config },
        operation,
        args
      );
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async health(appId: string): Promise<boolean> {
    return this.clients.has(appId);
  }

  async listTools(target: McpConnectionTarget): Promise<McpListedTool[]> {
    try {
      const client = await this.connectLegacy(target);
      const result = await client.listTools();
      logger.info(
        { appId: target.appId, config: summarizeMcpConfig(target.config), toolCount: result.tools.length },
        'MCP tools listed'
      );
      return result.tools as McpListedTool[];
    } catch (err) {
      logger.error(
        { appId: target.appId, config: summarizeMcpConfig(target.config), err },
        'Failed to list MCP tools'
      );
      throw new AaiError(
        'EXECUTION_ERROR',
        `Failed to list tools for '${target.appId}': ${String(err)}`
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
      const state = this.clients.get(target.appId);
      if (!state) {
        throw new AaiError('SERVICE_UNAVAILABLE', `MCP app '${target.appId}' is not connected`);
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
        )) as { content?: unknown };

        state.activityListeners.delete(activityListener);
        logger.info(
          {
            appId: target.appId,
            tool: toolName,
            config: summarizeMcpConfig(target.config),
          },
          'MCP tool call completed'
        );
        return result;
      } catch (err) {
        state.activityListeners.delete(activityListener);
        logger.error(
          {
            appId: target.appId,
            tool: toolName,
            config: summarizeMcpConfig(target.config),
            err,
          },
          'MCP tool call failed'
        );
        throw err;
      }
    };

    try {
      return await execute();
    } catch (err) {
      await this.close(target.appId);
      try {
        return await execute();
      } catch (retryErr) {
        logger.error(
          {
            appId: target.appId,
            tool: toolName,
            config: summarizeMcpConfig(target.config),
            err: retryErr ?? err,
          },
          'MCP tool call failed after retry'
        );
        throw new AaiError(
          'EXECUTION_ERROR',
          `MCP tool '${toolName}' failed for '${target.appId}': ${String(retryErr ?? err)}`
        );
      }
    }
  }

  async close(appId: string): Promise<void> {
    return this.disconnect(appId);
  }

  private createTransport(config: McpConfig) {
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

  private async connectLegacy(target: McpConnectionTarget): Promise<Client> {
    await this.connect(target.appId, target.config);
    const state = this.clients.get(target.appId);
    if (!state) {
      throw new AaiError('SERVICE_UNAVAILABLE', `MCP app '${target.appId}' is not connected`);
    }
    return state.client;
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

function summarizeMcpConfig(config: McpConfig): Record<string, unknown> {
  switch (config.transport) {
    case 'stdio':
      return {
        transport: config.transport,
        command: config.command,
        argvLength: config.args?.length ?? 0,
        ...(config.cwd ? { cwd: config.cwd } : {}),
        ...(config.env ? { envKeys: Object.keys(config.env) } : {}),
        ...(config.timeout ? { timeout: config.timeout } : {}),
      };
    case 'streamable-http':
    case 'sse':
      return {
        transport: config.transport,
        url: config.url,
        ...(config.timeout ? { timeout: config.timeout } : {}),
      };
  }
}

// Helper to load headers for imported MCP apps
async function loadImportedMcpHeaders(
  _secureStorage: SecureStorage | undefined,
  _appId: string
): Promise<Record<string, string> | undefined> {
  // TODO: Implement header loading from secure storage if needed
  return undefined;
}

// Placeholder for SecureStorage type
type SecureStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

let singleton: McpExecutor | undefined;

export function getMcpExecutor(secureStorage?: SecureStorage): McpExecutor {
  if (!singleton) {
    singleton = new McpExecutor(secureStorage);
  } else if (secureStorage) {
    // Allow updating secureStorage after creation
    singleton.secureStorage = secureStorage;
  }
  return singleton;
}
