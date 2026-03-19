import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AaiJson, SkillConfig } from '../types/aai-json.js';
import { parseAaiJson } from '../parsers/schema.js';
import { getManagedAppDir, getManagedAppsRoot } from './paths.js';

const REGISTRY_FILE = 'skill-registry.json';

export interface SkillRegistryEntry {
  localId: string;
  protocol: 'skill';
  config: SkillConfig;
  descriptorPath: string;
  importedAt: string;
  updatedAt: string;
}

interface SkillRegistryFile {
  version: 1;
  entries: SkillRegistryEntry[];
}

export interface ImportedSkillApp {
  entry: SkillRegistryEntry;
  descriptor: AaiJson;
}

async function loadRegistryFile(): Promise<SkillRegistryFile> {
  try {
    const raw = await readFile(join(getManagedAppsRoot(), REGISTRY_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as SkillRegistryFile;
    return { version: 1, entries: parsed.entries ?? [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

async function saveRegistryFile(registry: SkillRegistryFile): Promise<void> {
  await mkdir(getManagedAppsRoot(), { recursive: true });
  await writeFile(join(getManagedAppsRoot(), REGISTRY_FILE), JSON.stringify(registry, null, 2), 'utf-8');
}

export async function listSkillRegistryEntries(): Promise<SkillRegistryEntry[]> {
  const registry = await loadRegistryFile();
  return registry.entries;
}

export async function upsertSkillRegistryEntry(
  entry: Omit<SkillRegistryEntry, 'descriptorPath' | 'importedAt' | 'updatedAt'>,
  descriptor: AaiJson
): Promise<SkillRegistryEntry> {
  const registry = await loadRegistryFile();
  const existing = registry.entries.find((item) => item.localId === entry.localId);
  const now = new Date().toISOString();
  const appDir = getManagedAppDir(entry.localId);
  const descriptorPath = join(appDir, 'aai.json');

  await mkdir(appDir, { recursive: true });
  await writeFile(descriptorPath, JSON.stringify(descriptor, null, 2), 'utf-8');

  const nextEntry: SkillRegistryEntry = {
    ...entry,
    descriptorPath,
    importedAt: existing?.importedAt ?? now,
    updatedAt: now,
  };

  const nextEntries = registry.entries.filter((item) => item.localId !== entry.localId);
  nextEntries.push(nextEntry);
  await saveRegistryFile({ version: 1, entries: nextEntries });
  return nextEntry;
}

export async function loadImportedSkillApps(): Promise<ImportedSkillApp[]> {
  const entries = await listSkillRegistryEntries();
  const loaded: ImportedSkillApp[] = [];

  for (const entry of entries) {
    const raw = await readFile(entry.descriptorPath, 'utf-8');
    loaded.push({
      entry,
      descriptor: parseAaiJson(JSON.parse(raw)),
    });
  }

  return loaded;
}
