import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { McpExecutor, McpListedTool } from '../executors/mcp.js';
import { parseAaiJson } from '../parsers/schema.js';
import {
  getMcpRegistryEntry,
  upsertMcpRegistryEntry,
  type McpRegistryEntry,
} from '../storage/mcp-registry.js';
import { getManagedAppDir } from '../storage/paths.js';
import type { SecureStorage } from '../storage/secure-storage/interface.js';
import { upsertSkillRegistryEntry } from '../storage/skill-registry.js';
import type { AaiJson, McpConfig } from '../types/aai-json.js';
import { deriveLocalId, slugify } from '../utils/ids.js';

const SECRET_PREFIX = 'mcp-import-headers-';

export type ExposureMode = 'summary' | 'keywords';

export interface ExposureDraft {
  keywords: string[];
  summary: string;
}

export interface McpImportOptions {
  config: McpConfig;
  headers?: Record<string, string>;
  exposureMode: ExposureMode;
}

export interface McpImportConfigInput {
  transport?: 'streamable-http' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpImportedResult {
  entry: McpRegistryEntry;
  descriptor: AaiJson;
  tools: McpListedTool[];
}

export function buildMcpImportConfig(input: McpImportConfigInput): McpConfig {
  const command = input.command && input.command.length > 0 ? input.command : undefined;
  const url = input.url && input.url.length > 0 ? input.url : undefined;

  if (command && url) {
    throw new Error('MCP import accepts either command or url, but not both');
  }

  if (command) {
    if (input.transport) {
      throw new Error('Local stdio MCP import does not accept transport');
    }

    return {
      transport: 'stdio',
      command,
      ...(input.args && input.args.length > 0 ? { args: input.args } : {}),
      ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    };
  }

  if (url) {
    const transport = input.transport ?? 'streamable-http';
    return {
      transport,
      url,
    };
  }

  throw new Error('MCP import requires either command or url');
}

async function deriveImportName(
  executor: McpExecutor,
  options: McpImportOptions,
  localId: string
): Promise<string> {
  const serverInfo = await executor.getServerInfo?.({
    localId,
    config: options.config,
    headers: options.headers,
  });
  if (serverInfo?.name) {
    return serverInfo.name;
  }

  if (options.config.transport === 'stdio') return basename(options.config.command);
  return new URL(options.config.url).hostname;
}

function deriveKeywords(name: string, tools: McpListedTool[]): string[] {
  return Array.from(
    new Set([
      slugify(name),
      ...tools.flatMap((tool) => tool.name.split(/[^a-zA-Z0-9]+/)).map((part) => part.toLowerCase()),
    ])
  )
    .filter(Boolean)
    .slice(0, 8);
}

export function buildMcpExposure(name: string, tools: McpListedTool[], mode: ExposureMode): ExposureDraft {
  const keywords = deriveKeywords(name, tools);
  const preview = tools.slice(0, 3).map((tool) => tool.name).join(', ');
  const summary = mode === 'summary'
    ? (tools.length > 0
      ? `${name} provides ${tools.length} MCP tools. Use it when the request matches operations like ${preview}.`
      : `${name} is an imported MCP server.`)
    : `Use for ${keywords.slice(0, 6).join(', ')}.`;

  return { keywords, summary };
}

function deriveLocalImportId(options: McpImportOptions): string {
  const seed =
    options.config.transport === 'stdio'
      ? deriveStdioImportSlug(options.config.command, options.config.args)
      : deriveRemoteImportSlug(options.config.url);
  return slugify(seed) || 'mcp';
}

async function deriveUniqueLocalImportId(options: McpImportOptions): Promise<string> {
  const preferred = deriveLocalImportId(options);
  const existing = await getMcpRegistryEntry(preferred);
  if (!existing) {
    return preferred;
  }

  if (JSON.stringify(existing.config) === JSON.stringify(options.config)) {
    return preferred;
  }

  const seed =
    options.config.transport === 'stdio'
      ? `mcp:${options.config.command}:${(options.config.args ?? []).join(' ')}`
      : `mcp:${options.config.transport}:${options.config.url}`;
  return deriveLocalId(seed, preferred);
}

function deriveStdioImportSlug(command: string, args?: string[]): string {
  const packageArg = args?.find((arg) => isLikelyPackageReference(arg));
  if (packageArg) {
    return simplifyImportedName(packageArg);
  }

  return simplifyImportedName(basename(command));
}

function deriveRemoteImportSlug(url: string): string {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^mcp\./, '');
  const hostnameWithoutTld = hostname.split('.').filter(Boolean).slice(0, -1).join('-');
  const pathPart = parsed.pathname
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .find((part) => part !== 'mcp' && part !== 'sse');

  return simplifyImportedName(hostnameWithoutTld || pathPart || hostname);
}

function isLikelyPackageReference(value: string): boolean {
  if (!value || value.startsWith('-')) {
    return false;
  }

  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.includes('\\')) {
    return false;
  }

  return value.includes('/') || value.includes('@') || /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function simplifyImportedName(value: string): string {
  const trimmed = value.trim();
  const withoutScope = trimmed.startsWith('@') ? trimmed.split('/').slice(1).join('/') : trimmed;
  const lastSegment = withoutScope.split('/').filter(Boolean).pop() ?? withoutScope;
  const normalized = lastSegment
    .replace(/^modelcontextprotocol-/, '')
    .replace(/^mcp-server-/, 'server-')
    .replace(/^mcp-/, '');

  return slugify(normalized) || 'mcp';
}

export function generateMcpDescriptor(options: McpImportOptions, tools: McpListedTool[]): AaiJson {
  const derivedName =
    options.config.transport === 'stdio' ? basename(options.config.command) : new URL(options.config.url).hostname;
  const exposure = buildMcpExposure(derivedName, tools, options.exposureMode);

  return {
    schemaVersion: '2.0',
    version: '1.0.0',
    app: {
      name: {
        default: derivedName,
        en: derivedName,
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
  const localId = await deriveUniqueLocalImportId(options);
  const tools = await executor.listTools({
    localId,
    config: options.config,
    headers: options.headers,
  });
  const name = await deriveImportName(executor, options, localId);

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
      protocol: 'mcp',
      config: options.config,
    },
    exposure: buildMcpExposure(name, tools, options.exposureMode),
  };
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
  exposureMode?: ExposureMode
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
    exposure: buildMcpExposure(
      currentDescriptor.app.name.default,
      tools,
      exposureMode ?? 'summary'
    ),
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
  path?: string;
  url?: string;
  exposureMode: ExposureMode;
}

export interface SkillImportSourceInput {
  path?: string;
  url?: string;
}

export function buildSkillImportSource(input: SkillImportSourceInput): SkillImportSourceInput {
  const path = input.path && input.path.length > 0 ? input.path : undefined;
  const url = input.url && input.url.length > 0 ? input.url : undefined;

  if (path && url) {
    throw new Error('Skill import accepts either path or url, but not both');
  }

  if (!path && !url) {
    throw new Error('Skill import requires either path or url');
  }

  return { path, url };
}

function deriveSkillName(options: SkillImportOptions, content: string): string {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  if (options.path) return basename(options.path);
  if (options.url) return new URL(options.url).hostname;
  return 'Imported Skill';
}

function deriveSkillKeywords(name: string, content: string): string[] {
  const headingWords = Array.from(content.matchAll(/^#+\s+(.+)$/gm))
    .flatMap((match) => match[1].split(/[^a-zA-Z0-9]+/))
    .map((part) => part.toLowerCase());

  return Array.from(new Set([slugify(name), 'skill', ...headingWords]))
    .filter(Boolean)
    .slice(0, 8);
}

function deriveSkillSummary(name: string, content: string, mode: ExposureMode, keywords: string[]): string {
  const paragraph = content
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .find((block) => block && !block.startsWith('#'));

  if (mode === 'keywords') {
    return `Use for ${keywords.slice(0, 6).join(', ')}.`;
  }

  if (paragraph) {
    return paragraph.length <= 220 ? paragraph : `${paragraph.slice(0, 217)}...`;
  }

  return `${name} is an imported skill.`;
}

export function buildSkillExposure(name: string, content: string, mode: ExposureMode): ExposureDraft {
  const keywords = deriveSkillKeywords(name, content);
  return {
    keywords,
    summary: deriveSkillSummary(name, content, mode, keywords),
  };
}

export async function importSkill(
  options: SkillImportOptions
): Promise<{ localId: string; descriptor: AaiJson; managedPath: string }> {
  const localId = deriveLocalId(
    options.path ? `skill:${options.path}` : `skill:${options.url ?? 'imported-skill'}`,
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

  const content = await readFile(join(managedSkillDir, 'SKILL.md'), 'utf-8');
  const name = deriveSkillName(options, content);

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
    exposure: buildSkillExposure(name, content, options.exposureMode),
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
