/**
 * Import Service
 *
 * Handles MCP server and skill import logic.
 */

import type { AaiJson, McpConfig, RuntimeAppRecord } from '../types/aai-json.js';
import type { AppCapabilities } from '../types/capabilities.js';
import { getMcpExecutor } from '../executors/mcp.js';
import { getAcpExecutor } from '../executors/acp.js';
import { getCliExecutor } from '../executors/cli.js';
import { importMcpServer, importSkill } from '../mcp/importer.js';
import type { SkillImportMode } from '../guides/skill-stub-generator.js';
import {
  deleteAppPolicyState,
  removeAppFromAllAgents,
  saveAppPolicyState,
  saveAgentState,
  upsertAgentState,
} from '../storage/agent-state.js';
import { getSkillRegistry } from '../storage/skill-registry.js';
import { getManagedAppDir } from '../storage/paths.js';
import { rm } from 'node:fs/promises';
import { AaiError } from '../errors/errors.js';
import type { CallerContext } from '../types/caller.js';
import type { Executor } from '../executors/interface.js';
import { getSkillExecutor } from '../executors/skill.js';
import { writeAppProxySkill } from '../guides/skill-stub-generator.js';
import type { SecureStorage } from '../storage/secure-storage/index.js';

export interface ImportResult {
  appId: string;
  descriptor: AaiJson;
  managedPath: string;
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

export class ImportService {
  constructor(
    private readonly secureStorage: SecureStorage,
    private readonly appRegistry: {
      set(appId: string, record: RuntimeAppRecord): void;
      delete(appId: string): boolean;
    }
  ) {}

  async importMcp(
    options: {
      name?: string;
      config: McpConfig;
      headers?: Record<string, string>;
      summary: string;
      enableScope: 'current' | 'all';
    },
    caller: CallerContext
  ): Promise<ImportResult> {
    const result = await importMcpServer(getMcpExecutor(), this.secureStorage, {
      name: options.name,
      config: options.config,
      headers: options.headers,
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
    options: {
      path: string;
      importMode: SkillImportMode;
    },
    caller: CallerContext
  ): Promise<ImportResult> {
    const result = await importSkill({
      path: options.path,
    });

    await saveAppPolicyState(result.appId, {
      defaultEnabled: 'importer-only',
      importerAgentId: caller.id,
      updatedAt: new Date().toISOString(),
    });

    const agentState = await upsertAgentState({
      agentId: caller.id,
      callerName: caller.name,
      agentType: caller.type,
      skillDir: caller.skillDir,
    });

    let stubPath: string | undefined;
    if (options.importMode === 'auto') {
      if (!agentState.skillDir) {
        throw new AaiError(
          'INVALID_REQUEST',
          'Current agent does not expose a skills directory. Import the skill in manual mode or configure AAI_GATEWAY_SKILL_DIR.'
        );
      }
      stubPath = await writeAppProxySkill({
        skillsDir: agentState.skillDir,
        name: result.descriptor.app.name.default,
        appId: result.appId,
        summary: result.descriptor.exposure.summary,
        mode: 'auto',
      });
      agentState.generatedStubs[result.appId] = stubPath;
      agentState.updatedAt = new Date().toISOString();
      await saveAgentState(agentState);
    }

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
    const { deleteImportedMcpHeaders } = await import('../mcp/importer.js');
    const registry = getMcpRegistry();

    const mcpEntry = await registry.get(appId);
    if (mcpEntry) {
      await registry.delete(appId);
      await deleteImportedMcpHeaders(this.secureStorage, appId);
    } else {
      await getSkillRegistry().delete(appId);
    }

    await deleteAppPolicyState(appId);
    await removeAppFromAllAgents(appId);
    await rm(getManagedAppDir(appId), { recursive: true, force: true });
  }

  async getAppCapabilities(appId: string, descriptor: AaiJson): Promise<AppCapabilities> {
    const executor = this.getExecutorForProtocol(descriptor.access.protocol);

    try {
      return await executor.loadAppCapabilities(appId, descriptor.access.config as any);
    } catch {
      return {
        title: descriptor.access.protocol === 'mcp' ? 'MCP Tools' : 'Tools',
        tools: [],
      };
    }
  }

  private getExecutorForProtocol(protocol: string): Executor {
    switch (protocol) {
      case 'mcp':
        return getMcpExecutor();
      case 'skill':
        return getSkillExecutor();
      case 'acp-agent':
        return getAcpExecutor();
      case 'cli':
        return getCliExecutor();
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }
}
