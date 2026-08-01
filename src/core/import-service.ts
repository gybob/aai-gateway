/**
 * Import Service
 *
 * Handles MCP server and skill import logic.
 */

import { rm } from 'node:fs/promises';

import { AaiError } from '../errors/errors.js';
import { getMcpExecutor } from '../executors/mcp.js';
import {
  deleteAppPolicyState,
  removeAppFromAllAgents,
  saveAppPolicyState,
} from '../storage/agent-state.js';
import { upsertMcpRegistryEntry } from '../storage/mcp-registry.js';
import { getManagedAppDir } from '../storage/paths.js';
import { getSkillRegistry } from '../storage/skill-registry.js';
import type { AaiJson, McpConfig, RuntimeAppRecord } from '../types/aai-json.js';
import type { CallerContext } from '../types/caller.js';
import { getDotenvPath } from '../utils/dotenv.js';

import {
  importMcpServer,
  importSkill,
  buildMcpImportConfig,
  buildImportedMcpDescriptor,
  buildSensitiveValueWarnings,
  normalizeSummaryInput,
  normalizeImportedAppName,
  resolveImportedMcpRuntimeValues,
  type McpImportConfigInput,
} from './importer.js';

export interface ImportResult {
  appId: string;
  descriptor: AaiJson;
  managedPath: string;
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

/** Partial update to an imported MCP app's config. Only provided fields are applied. */
export interface McpAppPatch {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  url?: string;
  headers?: Record<string, string>;
  transport?: 'streamable-http' | 'sse';
  name?: string;
  summary?: string;
}

export interface UpdateMcpResult {
  appId: string;
  descriptor: AaiJson;
  config: McpConfig;
  warnings: string[];
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

  /**
   * Apply a partial patch to an imported MCP app's config.
   * Validates, re-checks env var resolution, double-writes (registry + descriptor),
   * and updates the in-memory registry. Cross-process notification (bumpGeneration)
   * is the caller's responsibility.
   */
  async updateMcpApp(
    appId: string,
    patch: McpAppPatch,
    existing: RuntimeAppRecord
  ): Promise<UpdateMcpResult> {
    if (existing.descriptor.access.protocol !== 'mcp') {
      throw new AaiError(
        'INVALID_REQUEST',
        `updateAppConfig only supports MCP apps. '${appId}' is a '${existing.descriptor.access.protocol}' app.`
      );
    }

    const current = existing.descriptor.access.config;
    const baseInput: McpImportConfigInput = {};

    if (current.transport === 'stdio') {
      if (
        patch.url !== undefined ||
        patch.headers !== undefined ||
        patch.transport !== undefined
      ) {
        throw new AaiError(
          'INVALID_REQUEST',
          `App '${appId}' is a stdio MCP; cannot apply remote-only fields (url/headers/transport). Remove and re-import to switch type.`
        );
      }
      baseInput.command = current.command;
      if (current.args) baseInput.args = current.args;
      if (current.env) baseInput.env = current.env;
      if (current.cwd) baseInput.cwd = current.cwd;
      if (current.timeout !== undefined) baseInput.timeout = current.timeout;
    } else {
      if (
        patch.command !== undefined ||
        patch.args !== undefined ||
        patch.env !== undefined ||
        patch.cwd !== undefined
      ) {
        throw new AaiError(
          'INVALID_REQUEST',
          `App '${appId}' is a remote MCP; cannot apply stdio-only fields (command/args/env/cwd). Remove and re-import to switch type.`
        );
      }
      baseInput.url = current.url;
      baseInput.transport = current.transport;
      if (current.headers) baseInput.headers = current.headers;
      if (current.timeout !== undefined) baseInput.timeout = current.timeout;
    }

    const mergedInput: McpImportConfigInput = { ...baseInput };
    if (patch.command !== undefined) mergedInput.command = patch.command;
    if (patch.args !== undefined) mergedInput.args = patch.args;
    if (patch.env !== undefined) mergedInput.env = patch.env;
    if (patch.cwd !== undefined) mergedInput.cwd = patch.cwd;
    if (patch.timeout !== undefined) mergedInput.timeout = patch.timeout;
    if (patch.url !== undefined) mergedInput.url = patch.url;
    if (patch.headers !== undefined) mergedInput.headers = patch.headers;
    if (patch.transport !== undefined) mergedInput.transport = patch.transport;

    const newConfig = buildMcpImportConfig(mergedInput);

    // Verify all ${VAR} placeholders resolve before persisting.
    const { missingVars } = await resolveImportedMcpRuntimeValues(newConfig);
    if (missingVars.length > 0) {
      const uniqueMissing = [...new Set(missingVars)];
      throw new Error(
        `Missing environment variables in ${getDotenvPath()}: ${uniqueMissing
          .map((v) => `$\{${v}}`)
          .join(', ')}.`
      );
    }

    let name: string;
    if (patch.name !== undefined) {
      const normalized = normalizeImportedAppName(patch.name);
      if (!normalized) {
        throw new AaiError('INVALID_REQUEST', "name cannot be empty.");
      }
      name = normalized;
    } else {
      name = existing.descriptor.app.name.default;
    }

    const summary =
      patch.summary !== undefined
        ? normalizeSummaryInput(patch.summary).summary
        : existing.descriptor.exposure.summary;

    const warnings = buildSensitiveValueWarnings({ config: newConfig, summary });
    const descriptor = buildImportedMcpDescriptor(name, newConfig, { summary });

    await upsertMcpRegistryEntry(
      { appId, protocol: 'mcp', config: newConfig },
      descriptor
    );

    this.appRegistry.set(appId, {
      appId,
      descriptor,
      source: existing.source,
      location: existing.location,
    });

    return { appId, descriptor, config: newConfig, warnings };
  }
}
