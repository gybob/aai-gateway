import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseAaiJson } from '../parsers/schema.js';
import type { AaiJson, McpConfig } from '../types/aai-json.js';

import { getManagedAppDir, getManagedAppsRoot } from './paths.js';
import { FileRegistry } from './registry.js';

const REGISTRY_FILE = 'mcp-registry.json';

export interface McpRegistryEntry {
  id: string;
  appId: string;
  protocol: 'mcp';
  config: McpConfig;
  exposureMode?: 'summary' | 'keywords';
  descriptorPath: string;
  importedAt: string;
  updatedAt: string;
}

/**
 * MCP Registry
 *
 * Manages imported MCP server registrations using the unified FileRegistry.
 */
export class McpRegistry {
  private registry: FileRegistry<McpRegistryEntry>;

  constructor() {
    const registryPath = join(getManagedAppsRoot(), REGISTRY_FILE);
    this.registry = new FileRegistry<McpRegistryEntry>(
      registryPath,
      (entry) => ({
        id: entry.id,
        appId: entry.appId,
        protocol: entry.protocol,
        config: entry.config,
        exposureMode: entry.exposureMode,
        descriptorPath: entry.descriptorPath,
        importedAt: entry.importedAt,
        updatedAt: entry.updatedAt,
      }),
      (raw) => raw as unknown as McpRegistryEntry
    );
  }

  /**
   * List all MCP registry entries
   */
  async list(): Promise<McpRegistryEntry[]> {
    return this.registry.list();
  }

  /**
   * Get a specific MCP registry entry by ID
   */
  async get(id: string): Promise<McpRegistryEntry | null> {
    return this.registry.get(id);
  }

  /**
   * Add or update an MCP registry entry
   */
  async upsert(
    entry: Omit<McpRegistryEntry, 'id' | 'descriptorPath' | 'importedAt' | 'updatedAt'>,
    descriptor: AaiJson
  ): Promise<McpRegistryEntry> {
    const existing = await this.get(entry.appId);
    const now = new Date().toISOString();
    const appDir = getManagedAppDir(entry.appId);
    const descriptorPath = join(appDir, 'aai.json');

    await mkdir(appDir, { recursive: true });
    await writeFile(descriptorPath, JSON.stringify(descriptor, null, 2), 'utf-8');

    const nextEntry: McpRegistryEntry = {
      id: entry.appId,
      ...entry,
      descriptorPath,
      importedAt: existing?.importedAt ?? now,
      updatedAt: now,
    };

    return this.registry.upsert(nextEntry);
  }

  /**
   * Delete an MCP registry entry
   */
  async delete(id: string): Promise<boolean> {
    return this.registry.delete(id);
  }

  /**
   * Load imported MCP apps with their descriptors
   */
  async loadApps(): Promise<Array<{ entry: McpRegistryEntry; descriptor: AaiJson }>> {
    const entries = await this.list();
    const loaded: Array<{ entry: McpRegistryEntry; descriptor: AaiJson }> = [];

    for (const entry of entries) {
      try {
        const raw = await readFile(entry.descriptorPath, 'utf-8');
        loaded.push({
          entry,
          descriptor: parseAaiJson(JSON.parse(raw)),
        });
      } catch (err) {
        // Skip entries with missing or invalid descriptors
      }
    }

    return loaded;
  }
}

let mcpRegistryInstance: McpRegistry | null = null;

export function getMcpRegistry(): McpRegistry {
  if (!mcpRegistryInstance) {
    mcpRegistryInstance = new McpRegistry();
  }
  return mcpRegistryInstance;
}

// Backward compatibility exports
export async function listMcpRegistryEntries(): Promise<McpRegistryEntry[]> {
  return getMcpRegistry().list();
}

export async function getMcpRegistryEntry(appId: string): Promise<McpRegistryEntry | null> {
  return getMcpRegistry().get(appId);
}

export async function upsertMcpRegistryEntry(
  entry: Omit<McpRegistryEntry, 'id' | 'descriptorPath' | 'importedAt' | 'updatedAt'>,
  descriptor: AaiJson
): Promise<McpRegistryEntry> {
  return getMcpRegistry().upsert(entry, descriptor);
}

export async function loadImportedMcpApps(): Promise<Array<{ entry: McpRegistryEntry; descriptor: AaiJson }>> {
  return getMcpRegistry().loadApps();
}
