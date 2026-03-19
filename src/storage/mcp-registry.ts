import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AaiJson, McpConfig } from '../types/aai-json.js';
import { parseAaiJson } from '../parsers/schema.js';
import { getManagedAppDir, getManagedAppsRoot } from './paths.js';

const REGISTRY_FILE = 'mcp-registry.json';

export interface McpRegistryEntry {
  localId: string;
  protocol: 'mcp';
  config: McpConfig;
  descriptorPath: string;
  importedAt: string;
  updatedAt: string;
}

interface McpRegistryFile {
  version: 2;
  entries: McpRegistryEntry[];
}

export interface ImportedMcpApp {
  entry: McpRegistryEntry;
  descriptor: AaiJson;
}

async function loadRegistryFile(): Promise<McpRegistryFile> {
  try {
    const raw = await readFile(join(getManagedAppsRoot(), REGISTRY_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as McpRegistryFile;
    return { version: 2, entries: parsed.entries ?? [] };
  } catch {
    return { version: 2, entries: [] };
  }
}

async function saveRegistryFile(registry: McpRegistryFile): Promise<void> {
  await mkdir(getManagedAppsRoot(), { recursive: true });
  await writeFile(join(getManagedAppsRoot(), REGISTRY_FILE), JSON.stringify(registry, null, 2), 'utf-8');
}

export async function listMcpRegistryEntries(): Promise<McpRegistryEntry[]> {
  const registry = await loadRegistryFile();
  return registry.entries;
}

export async function getMcpRegistryEntry(localId: string): Promise<McpRegistryEntry | null> {
  const entries = await listMcpRegistryEntries();
  return entries.find((entry) => entry.localId === localId) ?? null;
}

export async function upsertMcpRegistryEntry(
  entry: Omit<McpRegistryEntry, 'descriptorPath' | 'importedAt' | 'updatedAt'>,
  descriptor: AaiJson
): Promise<McpRegistryEntry> {
  const registry = await loadRegistryFile();
  const existing = registry.entries.find((item) => item.localId === entry.localId);
  const now = new Date().toISOString();
  const appDir = getManagedAppDir(entry.localId);
  const descriptorPath = join(appDir, 'aai.json');

  await mkdir(appDir, { recursive: true });
  await writeFile(descriptorPath, JSON.stringify(descriptor, null, 2), 'utf-8');

  const nextEntry: McpRegistryEntry = {
    ...entry,
    descriptorPath,
    importedAt: existing?.importedAt ?? now,
    updatedAt: now,
  };

  const nextEntries = registry.entries.filter((item) => item.localId !== entry.localId);
  nextEntries.push(nextEntry);
  await saveRegistryFile({ version: 2, entries: nextEntries });
  return nextEntry;
}

export async function loadImportedMcpApps(): Promise<ImportedMcpApp[]> {
  const entries = await listMcpRegistryEntries();
  const loaded: ImportedMcpApp[] = [];

  for (const entry of entries) {
    const raw = await readFile(entry.descriptorPath, 'utf-8');
    loaded.push({
      entry,
      descriptor: parseAaiJson(JSON.parse(raw)),
    });
  }

  return loaded;
}
