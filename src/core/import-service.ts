/**
 * Import Service
 *
 * Handles MCP server and skill import logic.
 */

import type { AaiJson, McpConfig, RuntimeAppRecord } from '../types/aai-json.js';
import { getMcpExecutor } from '../executors/mcp.js';
import { importMcpServer, importSkill } from './importer.js';
import {
  deleteAppPolicyState,
  removeAppFromAllAgents,
  saveAppPolicyState,
} from '../storage/agent-state.js';
import { getSkillRegistry } from '../storage/skill-registry.js';
import { getManagedAppDir } from '../storage/paths.js';
import { rm } from 'node:fs/promises';
import type { CallerContext } from '../types/caller.js';

export interface ImportResult {
  appId: string;
  descriptor: AaiJson;
  managedPath: string;
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

export class ImportService {
  constructor(
    private readonly appRegistry: {
      set(appId: string, record: RuntimeAppRecord): void;
      delete(appId: string): boolean;
    }
  ) {}

  async importMcp(
    options: {
      name?: string;
      config: McpConfig;
      summary: string;
      enableScope: 'current' | 'all';
    },
    caller: CallerContext
  ): Promise<ImportResult> {
    const result = await importMcpServer(getMcpExecutor(), {
      name: options.name,
      config: options.config,
      summary: options.summary,
    });

    await saveAppPolicyState(result.entry.appId, {
      defaultEnabled: options.enableScope === 'current' ? 'importer-only' : 'all',
      importerAgentId: caller.id,
      updatedAt: new Date().toISOString(),
    });

    this.appRegistry.set(result.entry.appId, {
      appId: result.entry.appId,
      descriptor: result.descriptor,
      source: 'mcp-import',
      location: result.entry.descriptorPath,
    });

    return {
      appId: result.entry.appId,
      descriptor: result.descriptor,
      managedPath: result.entry.descriptorPath,
      tools: result.tools,
    };
  }

  async importSkill(
    options: { path: string; enableScope?: 'current' | 'all' },
    caller: CallerContext
  ): Promise<ImportResult> {
    const result = await importSkill({ path: options.path });

    const scope = options.enableScope ?? 'current';
    await saveAppPolicyState(result.appId, {
      defaultEnabled: scope === 'current' ? 'importer-only' : 'all',
      importerAgentId: caller.id,
      updatedAt: new Date().toISOString(),
    });

    this.appRegistry.set(result.appId, {
      appId: result.appId,
      descriptor: result.descriptor,
      source: 'skill-import',
      location: result.managedPath,
    });

    return {
      appId: result.appId,
      descriptor: result.descriptor,
      managedPath: result.managedPath,
      tools: [],
    };
  }

  async removeApp(appId: string): Promise<void> {
    const { getMcpRegistry } = await import('../storage/mcp-registry.js');
    const registry = getMcpRegistry();

    const mcpEntry = await registry.get(appId);
    if (mcpEntry) {
      await registry.delete(appId);
    } else {
      await getSkillRegistry().delete(appId);
    }

    await deleteAppPolicyState(appId);
    await removeAppFromAllAgents(appId);
    await rm(getManagedAppDir(appId), { recursive: true, force: true });

    // Remove from in-memory app registry so the app disappears immediately
    this.appRegistry.delete(appId);
  }
}
