import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseAaiJson } from '../parsers/schema.js';
import type { AaiJson, SkillConfig } from '../types/aai-json.js';

import { getManagedAppDir, getManagedAppsRoot } from './paths.js';
import { FileRegistry } from './registry.js';

const REGISTRY_FILE = 'skill-registry.json';

export interface SkillRegistryEntry {
  id: string;
  localId: string;
  protocol: 'skill';
  config: SkillConfig;
  exposureMode?: 'summary' | 'keywords';
  descriptorPath: string;
  importedAt: string;
  updatedAt: string;
}

/**
 * Skill Registry
 *
 * Manages imported skill registrations using the unified FileRegistry.
 */
export class SkillRegistry {
  private registry: FileRegistry<SkillRegistryEntry>;

  constructor() {
    const registryPath = join(getManagedAppsRoot(), REGISTRY_FILE);
    this.registry = new FileRegistry<SkillRegistryEntry>(
      registryPath,
      (entry) => ({
        id: entry.id,
        localId: entry.localId,
        protocol: entry.protocol,
        config: entry.config,
        exposureMode: entry.exposureMode,
        descriptorPath: entry.descriptorPath,
        importedAt: entry.importedAt,
        updatedAt: entry.updatedAt,
      }),
      (raw) => raw as unknown as SkillRegistryEntry
    );
  }

  /**
   * List all skill registry entries
   */
  async list(): Promise<SkillRegistryEntry[]> {
    return this.registry.list();
  }

  /**
   * Get a specific skill registry entry by ID
   */
  async get(id: string): Promise<SkillRegistryEntry | null> {
    return this.registry.get(id);
  }

  /**
   * Add or update a skill registry entry
   */
  async upsert(
    entry: Omit<SkillRegistryEntry, 'id' | 'descriptorPath' | 'importedAt' | 'updatedAt'>,
    descriptor: AaiJson
  ): Promise<SkillRegistryEntry> {
    const existing = await this.get(entry.localId);
    const now = new Date().toISOString();
    const appDir = getManagedAppDir(entry.localId);
    const descriptorPath = join(appDir, 'aai.json');

    await mkdir(appDir, { recursive: true });
    await writeFile(descriptorPath, JSON.stringify(descriptor, null, 2), 'utf-8');

    const nextEntry: SkillRegistryEntry = {
      id: entry.localId,
      ...entry,
      descriptorPath,
      importedAt: existing?.importedAt ?? now,
      updatedAt: now,
    };

    return this.registry.upsert(nextEntry);
  }

  /**
   * Delete a skill registry entry
   */
  async delete(id: string): Promise<boolean> {
    return this.registry.delete(id);
  }

  /**
   * Load imported skill apps with their descriptors
   */
  async loadApps(): Promise<Array<{ entry: SkillRegistryEntry; descriptor: AaiJson }>> {
    const entries = await this.list();
    const loaded: Array<{ entry: SkillRegistryEntry; descriptor: AaiJson }> = [];

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

let skillRegistryInstance: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!skillRegistryInstance) {
    skillRegistryInstance = new SkillRegistry();
  }
  return skillRegistryInstance;
}

// Backward compatibility exports
export async function listSkillRegistryEntries(): Promise<SkillRegistryEntry[]> {
  return getSkillRegistry().list();
}

export async function getSkillRegistryEntry(localId: string): Promise<SkillRegistryEntry | null> {
  return getSkillRegistry().get(localId);
}

export async function upsertSkillRegistryEntry(
  entry: Omit<SkillRegistryEntry, 'id' | 'descriptorPath' | 'importedAt' | 'updatedAt'>,
  descriptor: AaiJson
): Promise<SkillRegistryEntry> {
  return getSkillRegistry().upsert(entry, descriptor);
}

export async function loadImportedSkillApps(): Promise<Array<{ entry: SkillRegistryEntry; descriptor: AaiJson }>> {
  return getSkillRegistry().loadApps();
}
