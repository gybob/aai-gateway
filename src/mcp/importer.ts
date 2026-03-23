import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { McpExecutor, McpListedTool } from '../executors/mcp.js';
import type { SecureStorage } from '../storage/secure-storage/interface.js';
import {
  getMcpRegistryEntry,
  upsertMcpRegistryEntry,
  type McpRegistryEntry,
} from '../storage/mcp-registry.js';
import { getManagedAppDir } from '../storage/paths.js';
import { getSkillRegistryEntry, upsertSkillRegistryEntry } from '../storage/skill-registry.js';
import type { AaiJson, McpConfig } from '../types/aai-json.js';
import { deriveLocalId, slugify } from '../utils/ids.js';

const SECRET_PREFIX = 'mcp-import-headers-';

export type ExposureMode = 'summary' | 'keywords';

export const IMPORT_LIMITS = {
  commandLength: 256,
  urlLength: 2048,
  pathLength: 2048,
  cwdLength: 2048,
  argCount: 64,
  argLength: 1024,
  envCount: 32,
  envKeyLength: 128,
  envValueLength: 2048,
  headerCount: 32,
  headerKeyLength: 128,
  headerValueLength: 4096,
} as const;

export const EXPOSURE_LIMITS = {
  keywordCount: 8,
  keywordLength: 32,
  summaryLength: 200,
} as const;

export interface ExposureDraft {
  keywords: string[];
  summary: string;
}

export interface McpImportConfigInput {
  transport?: 'streamable-http' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpImportPreviewOptions {
  config: McpConfig;
  headers?: Record<string, string>;
}

export interface McpImportOptions extends McpImportPreviewOptions {
  exposureMode: ExposureMode;
  keywords: string[];
  summary: string;
}

export interface McpImportPreview {
  localId: string;
  name: string;
  tools: McpListedTool[];
}

export interface McpImportedResult {
  entry: McpRegistryEntry;
  descriptor: AaiJson;
  tools: McpListedTool[];
}

export interface SkillImportSourceInput {
  path?: string;
  url?: string;
}

export interface SkillImportPreviewOptions extends SkillImportSourceInput {}

export interface SkillImportOptions extends SkillImportSourceInput {
  exposureMode: ExposureMode;
  keywords: string[];
  summary: string;
}

export interface SkillImportPreview {
  localId: string;
  name: string;
  description?: string;
  content: string;
}

interface SkillFrontMatter {
  name?: string;
  description?: string;
  body: string;
}

export function buildMcpImportConfig(input: McpImportConfigInput): McpConfig {
  validateOptionalStringLength(input.command, 'command', IMPORT_LIMITS.commandLength);
  validateOptionalStringLength(input.url, 'url', IMPORT_LIMITS.urlLength);
  validateOptionalStringLength(input.cwd, 'cwd', IMPORT_LIMITS.cwdLength);
  validateStringArrayLength(input.args, 'args', IMPORT_LIMITS.argCount, IMPORT_LIMITS.argLength);
  validateStringRecordLength(
    input.env,
    'env',
    IMPORT_LIMITS.envCount,
    IMPORT_LIMITS.envKeyLength,
    IMPORT_LIMITS.envValueLength
  );

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
    return {
      transport: input.transport ?? 'streamable-http',
      url,
    };
  }

  throw new Error('MCP import requires either command or url');
}

export function buildSkillImportSource(input: SkillImportSourceInput): SkillImportSourceInput {
  validateOptionalStringLength(input.path, 'path', IMPORT_LIMITS.pathLength);
  validateOptionalStringLength(input.url, 'url', IMPORT_LIMITS.urlLength);

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

export function validateImportHeaders(headers?: Record<string, string>): void {
  validateStringRecordLength(
    headers,
    'headers',
    IMPORT_LIMITS.headerCount,
    IMPORT_LIMITS.headerKeyLength,
    IMPORT_LIMITS.headerValueLength
  );
}

export function normalizeExposureInput(input: {
  keywords: string[];
  summary: string;
}): ExposureDraft {
  const keywords = Array.from(
    new Set(
      input.keywords
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
    )
  );
  const summary = input.summary.trim();

  if (summary.length === 0) {
    throw new Error('summary cannot be empty.');
  }

  if (summary.length > EXPOSURE_LIMITS.summaryLength) {
    throw new Error(
      `summary is too long. Maximum length is ${EXPOSURE_LIMITS.summaryLength} characters.`
    );
  }

  if (keywords.length === 0) {
    throw new Error('keywords cannot be empty.');
  }

  if (keywords.length > EXPOSURE_LIMITS.keywordCount) {
    throw new Error(
      `keywords has too many items. Maximum item count is ${EXPOSURE_LIMITS.keywordCount}.`
    );
  }

  for (const [index, keyword] of keywords.entries()) {
    if (keyword.length > EXPOSURE_LIMITS.keywordLength) {
      throw new Error(
        `keywords[${index}] is too long. Maximum length is ${EXPOSURE_LIMITS.keywordLength} characters.`
      );
    }
  }

  return { keywords, summary };
}

export async function discoverMcpImport(
  executor: McpExecutor,
  options: McpImportPreviewOptions
): Promise<McpImportPreview> {
  const localId = await deriveUniqueLocalImportId(options.config);
  const tools = await executor.listTools({
    localId,
    config: options.config,
    headers: options.headers,
  });
  const name = await deriveImportName(executor, options.config, options.headers, localId);
  return { localId, name, tools };
}

export async function importMcpServer(
  executor: McpExecutor,
  storage: SecureStorage,
  options: McpImportOptions
): Promise<McpImportedResult> {
  const preview = await discoverMcpImport(executor, options);
  const descriptor = buildImportedMcpDescriptor(
    preview.name,
    options.config,
    normalizeExposureInput({ keywords: options.keywords, summary: options.summary })
  );

  const entry = await upsertMcpRegistryEntry(
    {
      localId: preview.localId,
      protocol: 'mcp',
      config: options.config,
      exposureMode: options.exposureMode,
    },
    descriptor
  );

  if (options.headers && Object.keys(options.headers).length > 0) {
    await storeImportedMcpHeaders(storage, preview.localId, options.headers);
  }

  return { entry, descriptor, tools: preview.tools };
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

export async function discoverSkillImport(
  options: SkillImportPreviewOptions
): Promise<SkillImportPreview> {
  const source = buildSkillImportSource(options);
  const content = await readSkillSourceContent(source);
  const localId = await deriveUniqueSkillLocalId(source, content);
  const frontMatter = parseSkillFrontMatter(content);
  return {
    localId,
    name: deriveSkillName(source, content),
    description: frontMatter.description,
    content,
  };
}

export async function importSkill(
  options: SkillImportOptions
): Promise<{ localId: string; descriptor: AaiJson; managedPath: string }> {
  const preview = await discoverSkillImport(options);
  const source = buildSkillImportSource(options);
  const finalAppDir = getManagedAppDir(preview.localId);
  const finalManagedSkillDir = join(finalAppDir, 'skill');
  await mkdir(finalAppDir, { recursive: true });

  if (source.path) {
    await copyDirectory(source.path, finalManagedSkillDir);
  } else if (source.url) {
    await writeRemoteSkill(preview.content, finalManagedSkillDir);
  }

  const descriptor: AaiJson = {
    schemaVersion: '2.0',
    version: '1.0.0',
    app: {
      name: {
        default: preview.name,
        en: preview.name,
      },
    },
    access: {
      protocol: 'skill',
      config: {
        path: finalManagedSkillDir,
      },
    },
    exposure: normalizeExposureInput({
      keywords: options.keywords,
      summary: options.summary,
    }),
  };

  await writeFile(join(finalAppDir, 'aai.json'), JSON.stringify(descriptor, null, 2), 'utf-8');
  await upsertSkillRegistryEntry(
    {
      localId: preview.localId,
      protocol: 'skill',
      config: {
        path: finalManagedSkillDir,
      },
      exposureMode: options.exposureMode,
    },
    descriptor
  );

  return { localId: preview.localId, descriptor, managedPath: finalManagedSkillDir };
}

export function parseSkillFrontMatter(content: string): SkillFrontMatter {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return { body: content };
  }

  const [, rawFrontMatter, body] = match;
  const fields = new Map<string, string>();
  for (const line of rawFrontMatter.split('\n')) {
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.+)\s*$/);
    if (!fieldMatch) {
      continue;
    }

    const [, key, value] = fieldMatch;
    fields.set(key.toLowerCase(), value.trim().replace(/^['"]|['"]$/g, ''));
  }

  return {
    name: fields.get('name'),
    description: fields.get('description'),
    body,
  };
}

async function deriveImportName(
  executor: McpExecutor,
  config: McpConfig,
  headers: Record<string, string> | undefined,
  localId: string
): Promise<string> {
  const serverInfo = await executor.getServerInfo?.({
    localId,
    config,
    headers,
  });
  if (serverInfo?.name) {
    return serverInfo.name;
  }

  return config.transport === 'stdio' ? basename(config.command) : new URL(config.url).hostname;
}

function buildImportedMcpDescriptor(name: string, config: McpConfig, exposure: ExposureDraft): AaiJson {
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
      config,
    },
    exposure,
  };
}

async function deriveUniqueLocalImportId(config: McpConfig): Promise<string> {
  const preferred = deriveLocalImportId(config);
  const existing = await getMcpRegistryEntry(preferred);
  if (!existing) {
    return preferred;
  }

  if (JSON.stringify(existing.config) === JSON.stringify(config)) {
    return preferred;
  }

  const seed =
    config.transport === 'stdio'
      ? `mcp:${config.command}:${(config.args ?? []).join(' ')}`
      : `mcp:${config.transport}:${config.url}`;
  return deriveLocalId(seed, preferred);
}

function deriveLocalImportId(config: McpConfig): string {
  const seed =
    config.transport === 'stdio'
      ? deriveStdioImportSlug(config.command, config.args)
      : deriveRemoteImportSlug(config.url);
  return slugify(seed) || 'mcp';
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

function deriveSkillName(options: SkillImportSourceInput, content: string): string {
  const frontMatter = parseSkillFrontMatter(content);
  if (frontMatter.name) return frontMatter.name;

  const titleMatch = frontMatter.body.match(/^#\s+(.+)$/m);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  if (options.path) return basename(options.path);
  if (options.url) return new URL(options.url).hostname;
  return 'Imported Skill';
}

async function deriveUniqueSkillLocalId(options: SkillImportSourceInput, content: string): Promise<string> {
  const preferred = `skill-${simplifyImportedName(deriveSkillName(options, content))}`;
  const existing = await getSkillRegistryEntry(preferred);
  if (!existing) {
    return preferred;
  }

  const seed = options.path ? `skill:${options.path}` : `skill:${options.url ?? 'imported-skill'}`;
  return deriveLocalId(seed, preferred);
}

async function readSkillSourceContent(options: SkillImportSourceInput): Promise<string> {
  if (options.path) {
    return readFile(join(options.path, 'SKILL.md'), 'utf-8');
  }

  if (options.url) {
    return fetchRemoteSkill(options.url);
  }

  throw new Error('Skill import requires either path or url');
}

async function copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.cp(sourceDir, targetDir, { recursive: true });
}

async function fetchRemoteSkill(skillRootUrl: string): Promise<string> {
  const skillUrl = `${skillRootUrl.replace(/\/$/, '')}/SKILL.md`;
  const response = await fetch(skillUrl);
  if (!response.ok) {
    throw new Error(`Failed to download remote skill: ${skillUrl} (${response.status})`);
  }

  return response.text();
}

async function writeRemoteSkill(content: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, 'SKILL.md'), content, 'utf-8');
}

function validateOptionalStringLength(
  value: string | undefined,
  field: string,
  maxLength: number
): void {
  if (value === undefined) {
    return;
  }

  if (value.length > maxLength) {
    throw new Error(`${field} is too long. Maximum length is ${maxLength} characters.`);
  }
}

function validateStringArrayLength(
  values: string[] | undefined,
  field: string,
  maxItems: number,
  maxItemLength: number
): void {
  if (!values) {
    return;
  }

  if (values.length > maxItems) {
    throw new Error(`${field} has too many items. Maximum item count is ${maxItems}.`);
  }

  for (const [index, value] of values.entries()) {
    if (value.length > maxItemLength) {
      throw new Error(`${field}[${index}] is too long. Maximum length is ${maxItemLength} characters.`);
    }
  }
}

function validateStringRecordLength(
  record: Record<string, string> | undefined,
  field: string,
  maxItems: number,
  maxKeyLength: number,
  maxValueLength: number
): void {
  if (!record) {
    return;
  }

  const entries = Object.entries(record);
  if (entries.length > maxItems) {
    throw new Error(`${field} has too many entries. Maximum entry count is ${maxItems}.`);
  }

  for (const [key, value] of entries) {
    if (key.length > maxKeyLength) {
      throw new Error(
        `${field} key '${key.slice(0, 32)}' is too long. Maximum key length is ${maxKeyLength} characters.`
      );
    }

    if (value.length > maxValueLength) {
      throw new Error(
        `${field} value for '${key.slice(0, 32)}' is too long. Maximum value length is ${maxValueLength} characters.`
      );
    }
  }
}
