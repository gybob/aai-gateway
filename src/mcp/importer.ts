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
import { deriveAppId, slugify } from '../utils/ids.js';
import {
  getDotenvPath,
  hasEnvPlaceholders,
  loadDotenv,
  substituteConfigEnvVars,
  substituteStringRecordEnvVars,
} from '../utils/dotenv.js';

const SECRET_PREFIX = 'mcp-import-headers-';

export const IMPORT_LIMITS = {
  nameLength: 128,
  commandLength: 256,
  urlLength: 2048,
  pathLength: 2048,
  timeoutMsMax: 2_147_483_647,
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
  summaryLength: 200,
} as const;

export interface SummaryDraft {
  summary: string;
}

export interface McpImportConfigInput {
  transport?: 'streamable-http' | 'sse';
  url?: string;
  command?: string;
  timeout?: number;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpImportPreviewOptions {
  config: McpConfig;
  headers?: Record<string, string>;
  name?: string;
}

export interface McpImportOptions extends McpImportPreviewOptions {
  summary: string;
}

export interface McpImportPreview {
  appId: string;
  name: string;
  tools: McpListedTool[];
}

export interface McpImportedResult {
  entry: McpRegistryEntry;
  descriptor: AaiJson;
  tools: McpListedTool[];
  warnings?: string[];
}

export interface SkillImportSourceInput {
  path?: string;
}

export interface SkillImportPreviewOptions extends SkillImportSourceInput {}

export interface SkillImportOptions extends SkillImportSourceInput {}

export interface SkillImportPreview {
  appId: string;
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
  validateOptionalTimeoutMs(input.timeout, 'timeout', IMPORT_LIMITS.timeoutMsMax);
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
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
      ...(input.args && input.args.length > 0 ? { args: input.args } : {}),
      ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    };
  }

  if (url) {
    return {
      transport: input.transport ?? 'streamable-http',
      url,
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
    };
  }

  throw new Error('MCP import requires either command or url');
}

export function buildSkillImportSource(input: SkillImportSourceInput): SkillImportSourceInput {
  validateOptionalStringLength(input.path, 'path', IMPORT_LIMITS.pathLength);

  const path = input.path && input.path.length > 0 ? input.path : undefined;

  if (!path) {
    throw new Error('Skill import requires a local path');
  }

  return { path };
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

export function normalizeSummaryInput(summaryInput: string): SummaryDraft {
  const summary = summaryInput.trim();

  if (summary.length === 0) {
    throw new Error('summary cannot be empty.');
  }

  if (summary.length > EXPOSURE_LIMITS.summaryLength) {
    throw new Error(
      `summary is too long. Maximum length is ${EXPOSURE_LIMITS.summaryLength} characters.`
    );
  }

  return { summary };
}

export async function discoverMcpImport(
  executor: McpExecutor,
  options: McpImportPreviewOptions
): Promise<McpImportPreview> {
  const requestedName = normalizeImportedAppName(options.name);
  const appId = await deriveUniqueMcpAppId(options.config, requestedName);
  const tools = await executor.listTools({
    appId,
    config: options.config,
    headers: options.headers,
  });
  const name =
    requestedName ?? (await deriveImportName(executor, options.config, options.headers, appId));
  return { appId, name, tools };
}

export async function importMcpServer(
  executor: McpExecutor,
  storage: SecureStorage,
  options: McpImportOptions
): Promise<McpImportedResult> {
  const warnings = buildSensitiveValueWarnings(options);
  const { resolvedConfig, resolvedHeaders, missingVars } = await resolveImportedMcpRuntimeValues(
    options.config,
    options.headers
  );

  if (missingVars.length > 0) {
    const uniqueMissing = [...new Set(missingVars)];
    throw new Error(
      `Missing environment variables in ${getDotenvPath()}: ${uniqueMissing
        .map((v) => `$\{${v}}`)
        .join(', ')}.`
    );
  }

  const preview = await discoverMcpImport(executor, {
    ...options,
    config: resolvedConfig,
    headers: resolvedHeaders,
  });
  const descriptor = buildImportedMcpDescriptor(
    preview.name,
    options.config,
    normalizeSummaryInput(options.summary)
  );

  const entry = await upsertMcpRegistryEntry(
    {
      appId: preview.appId,
      protocol: 'mcp',
      config: options.config,
    },
    descriptor
  );

  if (options.headers && Object.keys(options.headers).length > 0) {
    await storeImportedMcpHeaders(storage, preview.appId, options.headers);
  }

  return { entry, descriptor, tools: preview.tools, ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function storeImportedMcpHeaders(
  storage: SecureStorage,
  appId: string,
  headers: Record<string, string>
): Promise<void> {
  await storage.set(`${SECRET_PREFIX}${appId}`, JSON.stringify(headers));
}

export async function loadImportedMcpHeaders(
  storage: SecureStorage,
  appId: string
): Promise<Record<string, string>> {
  const raw = await storage.get(`${SECRET_PREFIX}${appId}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function deleteImportedMcpHeaders(
  storage: SecureStorage,
  appId: string
): Promise<void> {
  await storage.delete(`${SECRET_PREFIX}${appId}`);
}

export async function discoverSkillImport(
  options: SkillImportPreviewOptions
): Promise<SkillImportPreview> {
  const source = buildSkillImportSource(options);
  const content = await readSkillSourceContent(source);
  const appId = await deriveUniqueSkillAppId(source, content);
  const frontMatter = parseSkillFrontMatter(content);
  return {
    appId,
    name: deriveSkillName(source, content),
    description: frontMatter.description,
    content,
  };
}

export async function importSkill(
  options: SkillImportOptions
): Promise<{ appId: string; descriptor: AaiJson; managedPath: string }> {
  // Load environment variables from ~/.aai/.env
  const { env: dotenv, missing: missingInEnv } = await loadDotenv();

  // Substitute ${VAR_NAME} placeholders in path with values from .env
  let finalOptions = options;
  let missingVars: string[] = [...missingInEnv];

  if (Object.keys(dotenv).length > 0) {
    const pathOrUrl = options.path;
    if (pathOrUrl) {
      const { result: substituted, missing } = substituteConfigEnvVars(
        { source: pathOrUrl } as Record<string, unknown>,
        dotenv
      );
      const substitutedSource = substituted.source as string;
      missingVars = [...missingVars, ...missing];
      finalOptions = { ...options, path: substitutedSource };
    }
  }

  if (missingVars.length > 0) {
    const uniqueMissing = [...new Set(missingVars)];
    throw new Error(
      `Missing environment variables in ${getDotenvPath()}: ${uniqueMissing
        .map((v) => `$\{${v}}`)
        .join(', ')}.`
    );
  }

  const preview = await discoverSkillImport(finalOptions);
  const source = buildSkillImportSource(finalOptions);
  const finalAppDir = getManagedAppDir(preview.appId);
  const finalManagedSkillDir = join(finalAppDir, 'skill');
  await mkdir(finalAppDir, { recursive: true });

  await copyDirectory(source.path!, finalManagedSkillDir);

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
    exposure: normalizeSummaryInput(deriveSkillSummary(preview)),
  };

  await writeFile(join(finalAppDir, 'aai.json'), JSON.stringify(descriptor, null, 2), 'utf-8');
  await upsertSkillRegistryEntry(
    {
      appId: preview.appId,
      protocol: 'skill',
      config: {
        path: finalManagedSkillDir,
      },
    },
    descriptor
  );

  return { appId: preview.appId, descriptor, managedPath: finalManagedSkillDir };
}

export async function resolveImportedMcpRuntimeValues(
  config: McpConfig,
  headers?: Record<string, string>
): Promise<{
  resolvedConfig: McpConfig;
  resolvedHeaders: Record<string, string> | undefined;
  missingVars: string[];
}> {
  const { env: dotenv, missing: missingInEnv } = await loadDotenv();
  const configAsRecord: Record<string, unknown> = JSON.parse(JSON.stringify(config));
  const { result: substitutedConfig, missing: configMissing } = substituteConfigEnvVars(
    configAsRecord,
    dotenv
  );
  const { result: substitutedHeaders, missing: headerMissing } = substituteStringRecordEnvVars(
    headers,
    dotenv
  );

  const missingVars = [...missingInEnv, ...configMissing, ...headerMissing];
  return {
    resolvedConfig: substitutedConfig as unknown as McpConfig,
    resolvedHeaders: headers ? substitutedHeaders : undefined,
    missingVars,
  };
}

function buildSensitiveValueWarnings(options: McpImportOptions): string[] {
  const warnings: string[] = [];
  if (
    containsPlaintextSensitiveValues(getMcpConfigEnv(options.config)) ||
    containsPlaintextSensitiveValues(options.headers)
  ) {
    warnings.push(
      `Sensitive values were provided directly in this chat. Next time, use \${VAR_NAME} placeholders and store the real values in ${getDotenvPath()} instead of sending secrets in the conversation.`
    );
  }
  return warnings;
}

function getMcpConfigEnv(config: McpConfig): Record<string, string> | undefined {
  return config.transport === 'stdio' ? config.env : undefined;
}

function containsPlaintextSensitiveValues(values?: Record<string, string>): boolean {
  if (!values) {
    return false;
  }

  return Object.entries(values).some(([key, value]) => {
    if (!isSensitiveKey(key)) {
      return false;
    }
    return !hasEnvPlaceholders(value);
  });
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === 'authorization' ||
    normalized.includes('api-key') ||
    normalized.includes('apikey') ||
    normalized.endsWith('_api_key') ||
    normalized.endsWith('_token') ||
    normalized.endsWith('_secret') ||
    normalized.endsWith('_password')
  );
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
  appId: string
): Promise<string> {
  const serverInfo = await executor.getServerInfo?.({
    appId,
    config,
    headers,
  });
  if (serverInfo?.name) {
    return serverInfo.name;
  }

  return config.transport === 'stdio' ? basename(config.command) : new URL(config.url).hostname;
}

function buildImportedMcpDescriptor(name: string, config: McpConfig, exposure: SummaryDraft): AaiJson {
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

async function deriveUniqueMcpAppId(config: McpConfig, name?: string): Promise<string> {
  const preferred = deriveLocalImportId(config, name);
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
  return deriveAppId(name ? `${seed}:name:${name}` : seed, preferred);
}

function deriveLocalImportId(config: McpConfig, name?: string): string {
  if (name) {
    return slugify(name) || 'mcp';
  }

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

function normalizeImportedAppName(name: string | undefined): string | undefined {
  validateOptionalStringLength(name, 'name', IMPORT_LIMITS.nameLength);
  const normalized = name?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function deriveSkillName(options: SkillImportSourceInput, content: string): string {
  const frontMatter = parseSkillFrontMatter(content);
  if (frontMatter.name) return frontMatter.name;

  const titleMatch = frontMatter.body.match(/^#\s+(.+)$/m);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  if (options.path) return basename(options.path);
  return 'Imported Skill';
}

async function deriveUniqueSkillAppId(options: SkillImportSourceInput, content: string): Promise<string> {
  const preferred = `skill-${simplifyImportedName(deriveSkillName(options, content))}`;
  const existing = await getSkillRegistryEntry(preferred);
  if (!existing) {
    return preferred;
  }

  const seed = `skill:${options.path ?? 'imported-skill'}`;
  return deriveAppId(seed, preferred);
}

async function readSkillSourceContent(options: SkillImportSourceInput): Promise<string> {
  if (options.path) {
    return readFile(join(options.path, 'SKILL.md'), 'utf-8');
  }

  throw new Error('Skill import requires a local path');
}

async function copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.cp(sourceDir, targetDir, { recursive: true });
}

function deriveSkillSummary(preview: SkillImportPreview): string {
  const preferred = preview.description?.trim() || extractFirstParagraph(preview.content) || `Use ${preview.name} through AAI Gateway.`;
  return normalizeSummaryInput(preferred.slice(0, EXPOSURE_LIMITS.summaryLength)).summary;
}

function extractFirstParagraph(content: string): string {
  const frontMatter = parseSkillFrontMatter(content);
  const cleaned = frontMatter.body
    .replace(/^# .+$/m, '')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .find((block) => block.length > 0);
  return cleaned ?? '';
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

function validateOptionalTimeoutMs(
  value: number | undefined,
  field: string,
  maxValue: number
): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer in milliseconds.`);
  }

  if (value > maxValue) {
    throw new Error(`${field} is too large. Maximum value is ${maxValue}.`);
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
