import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { SecureStorage } from '../storage/secure-storage/interface.js';
import { getManagedAppDir } from '../storage/paths.js';
import type { AaiJson, McpConfig } from '../types/aai-json.js';
import type { McpExecutor, McpListedTool } from '../executors/mcp.js';
import { deriveLocalId, slugify } from '../utils/ids.js';
import { upsertMcpRegistryEntry, type McpRegistryEntry } from '../storage/mcp-registry.js';
import { upsertSkillRegistryEntry } from '../storage/skill-registry.js';
import { parseAaiJson } from '../parsers/schema.js';

const SECRET_PREFIX = 'mcp-import-headers-';

export interface ExposureDraft {
  keywords: string[];
  summary: string;
}

export interface McpImportOptions {
  localId?: string;
  name?: string;
  config: McpConfig;
  headers?: Record<string, string>;
  exposure?: ExposureDraft;
}

export interface McpImportedResult {
  entry: McpRegistryEntry;
  descriptor: AaiJson;
  tools: McpListedTool[];
}

function deriveImportName(options: McpImportOptions): string {
  if (options.name) return options.name;
  if (options.config.transport === 'stdio') return basename(options.config.command);
  return new URL(options.config.url).hostname;
}

function deriveExposure(name: string, tools: McpListedTool[], override?: ExposureDraft): ExposureDraft {
  if (override) {
    return override;
  }

  const keywords = Array.from(
    new Set([
      slugify(name),
      ...tools.flatMap((tool) => tool.name.split(/[^a-zA-Z0-9]+/)).map((part) => part.toLowerCase()),
    ])
  )
    .filter(Boolean)
    .slice(0, 8);

  const preview = tools.slice(0, 3).map((tool) => tool.name).join(', ');
  const summary =
    tools.length > 0
      ? `${name} exposes ${tools.length} MCP tools. Common operations include ${preview}.`
      : `${name} is an imported MCP server.`;

  return { keywords, summary };
}

function deriveLocalImportId(options: McpImportOptions, name: string): string {
  if (options.localId) return options.localId;
  const seed =
    options.config.transport === 'stdio'
      ? `mcp:${options.config.command}:${(options.config.args ?? []).join(' ')}`
      : `mcp:${options.config.transport}:${options.config.url}`;
  return deriveLocalId(seed || name, 'mcp');
}

export function generateMcpDescriptor(options: McpImportOptions, tools: McpListedTool[]): AaiJson {
  const name = deriveImportName(options);
  const exposure = deriveExposure(name, tools, options.exposure);

  return {
    schemaVersion: '2.0',
    version: '1.0.0',
    app: {
      name: {
        default: name,
        en: name,
      },
    },
    access: {
      protocol: 'mcp',
      config: options.config,
    },
    exposure,
  };
}

export async function storeImportedMcpHeaders(
  storage: SecureStorage,
  localId: string,
  headers: Record<string, string>
): Promise<void> {
  await storage.set(`${SECRET_PREFIX}${localId}`, JSON.stringify(headers));
}

export async function loadImportedMcpHeaders(
  storage: SecureStorage,
  localId: string
): Promise<Record<string, string>> {
  const raw = await storage.get(`${SECRET_PREFIX}${localId}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function importMcpServer(
  executor: McpExecutor,
  storage: SecureStorage,
  options: McpImportOptions
): Promise<McpImportedResult> {
  const name = deriveImportName(options);
  const localId = deriveLocalImportId(options, name);
  const tools = await executor.listTools({
    localId,
    config: options.config,
    headers: options.headers,
  });

  const descriptor = generateMcpDescriptor({ ...options, localId, name }, tools);
  const entry = await upsertMcpRegistryEntry(
    {
      localId,
      protocol: 'mcp',
      config: options.config,
    },
    descriptor
  );

  if (options.headers && Object.keys(options.headers).length > 0) {
    await storeImportedMcpHeaders(storage, localId, options.headers);
  }

  return { entry, descriptor, tools };
}

export async function refreshImportedMcpServer(
  executor: McpExecutor,
  storage: SecureStorage,
  entry: McpRegistryEntry,
  exposure?: ExposureDraft
): Promise<McpImportedResult> {
  const headers = await loadImportedMcpHeaders(storage, entry.localId);
  const tools = await executor.listTools({
    localId: entry.localId,
    config: entry.config,
    headers,
  });

  const currentDescriptor = parseAaiJson(JSON.parse(await readFile(entry.descriptorPath, 'utf-8')));
  const descriptor: AaiJson = {
    ...currentDescriptor,
    access: {
      protocol: 'mcp',
      config: entry.config,
    },
    exposure: deriveExposure(currentDescriptor.app.name.default, tools, exposure),
  };

  const nextEntry = await upsertMcpRegistryEntry(
    {
      localId: entry.localId,
      protocol: 'mcp',
      config: entry.config,
    },
    descriptor
  );

  return { entry: nextEntry, descriptor, tools };
}

export interface SkillImportOptions {
  localId?: string;
  name?: string;
  path?: string;
  url?: string;
  exposure: ExposureDraft;
}

function deriveSkillName(options: SkillImportOptions): string {
  if (options.name) return options.name;
  if (options.path) return basename(options.path);
  if (options.url) return new URL(options.url).hostname;
  return 'Imported Skill';
}

export async function importSkill(
  options: SkillImportOptions
): Promise<{ localId: string; descriptor: AaiJson; managedPath: string }> {
  const name = deriveSkillName(options);
  const localId =
    options.localId ??
    deriveLocalId(
      options.path ? `skill:${options.path}` : `skill:${options.url ?? name}`,
      'skill'
    );
  const appDir = getManagedAppDir(localId);
  const managedSkillDir = join(appDir, 'skill');
  await mkdir(appDir, { recursive: true });

  if (options.path) {
    await copyDirectory(options.path, managedSkillDir);
  } else if (options.url) {
    await downloadRemoteSkill(options.url, managedSkillDir);
  } else {
    throw new Error('Skill import requires either path or url');
  }

  const descriptor: AaiJson = {
    schemaVersion: '2.0',
    version: '1.0.0',
    app: {
      name: {
        default: name,
        en: name,
      },
    },
    access: {
      protocol: 'skill',
      config: {
        path: managedSkillDir,
      },
    },
    exposure: options.exposure,
  };

  await writeFile(join(appDir, 'aai.json'), JSON.stringify(descriptor, null, 2), 'utf-8');
  await upsertSkillRegistryEntry(
    {
      localId,
      protocol: 'skill',
      config: {
        path: managedSkillDir,
      },
    },
    descriptor
  );
  return { localId, descriptor, managedPath: managedSkillDir };
}

async function copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.cp(sourceDir, targetDir, { recursive: true });
}

async function downloadRemoteSkill(skillRootUrl: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const skillUrl = `${skillRootUrl.replace(/\/$/, '')}/SKILL.md`;
  const response = await fetch(skillUrl);
  if (!response.ok) {
    throw new Error(`Failed to download remote skill: ${skillUrl} (${response.status})`);
  }

  const content = await response.text();
  await writeFile(join(targetDir, 'SKILL.md'), content, 'utf-8');
}
