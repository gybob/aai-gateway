import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { AaiError } from '../errors/errors.js';
import type { McpExecutor, McpListedTool } from '../executors/mcp.js';
import {
  getMcpRegistryEntry,
  upsertMcpRegistryEntry,
  type McpRegistryEntry,
} from '../storage/mcp-registry.js';
import { getManagedAppDir } from '../storage/paths.js';
import { getSkillRegistryEntry, upsertSkillRegistryEntry } from '../storage/skill-registry.js';
import type { AaiJson, McpConfig, SkillConfig } from '../types/aai-json.js';
import { isSkillPathConfig } from '../types/aai-json.js';
import {
  getDotenvPath,
  hasEnvPlaceholders,
  loadDotenv,
  substituteConfigEnvVars,
  findEnvPlaceholders,
} from '../utils/dotenv.js';
import { deriveAppId, slugify } from '../utils/ids.js';

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
  headers?: Record<string, string>;
}

export interface McpImportPreviewOptions {
  config: McpConfig;
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
      ...(input.headers && Object.keys(input.headers).length > 0 ? { headers: input.headers } : {}),
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
  });
  const name =
    requestedName ?? (await deriveImportName(executor, options.config, appId));
  return { appId, name, tools };
}

export async function importMcpServer(
  executor: McpExecutor,
  options: McpImportOptions
): Promise<McpImportedResult> {
  const warnings = buildSensitiveValueWarnings(options);
  const { resolvedConfig, missingVars } = await resolveImportedMcpRuntimeValues(options.config);

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

  return { entry, descriptor, tools: preview.tools, ...(warnings.length > 0 ? { warnings } : {}) };
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
  // Load environment variables from ~/.aai-gateway/.env
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

export function buildSensitiveValueWarnings(options: McpImportOptions): string[] {
  const env = options.config.transport === 'stdio' ? options.config.env : undefined;
  const headers = options.config.transport !== 'stdio' ? (options.config as { headers?: Record<string, string> }).headers : undefined;
  if (containsPlaintextSensitiveValues(env) || containsPlaintextSensitiveValues(headers)) {
    return [
      `Sensitive values were provided directly in this chat. Next time, use \${VAR_NAME} placeholders and store the real values in ${getDotenvPath()} instead of sending secrets in the conversation.`,
    ];
  }
  return [];
}

function containsPlaintextSensitiveValues(values?: Record<string, string>): boolean {
  if (!values) return false;
  return Object.entries(values).some(
    ([key, value]) => isSensitiveKey(key) && !hasEnvPlaceholders(value)
  );
}

// ============================================================
// Config query / export (getAppConfig)
// ============================================================

export type AppConfigExportFormat = 'aai' | 'mcp-json' | 'all';

export interface AppConfigExport {
  protocol: 'mcp' | 'skill';
  name: string;
  summary: string;
  config: McpConfig | SkillConfig;
  requiredEnvVars: string[];
  install: {
    aai?: Record<string, unknown>;
    mcpJson?: Record<string, unknown>;
  };
  skill?: {
    path: string;
    note: string;
  };
}

/** Mask plaintext sensitive values in an MCP config as ${VAR_NAME} placeholders. */
export function sanitizeMcpConfig(config: McpConfig): McpConfig {
  if (config.transport === 'stdio') {
    return config.env ? { ...config, env: sanitizeStringRecord(config.env) } : { ...config };
  }
  return config.headers ? { ...config, headers: sanitizeStringRecord(config.headers) } : { ...config };
}

function sanitizeStringRecord(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isSensitiveKey(key) && !hasEnvPlaceholders(value)) {
      result[key] = `\${${toEnvVarName(key)}}`;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function toEnvVarName(key: string): string {
  const cleaned = key.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || key.toUpperCase();
}

/** Collect all ${VAR} placeholders referenced anywhere in a config object. */
export function extractConfigEnvVars(config: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const v of findEnvPlaceholders(value)) found.add(v);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) walk(v);
    }
  };
  walk(config);
  return [...found].sort();
}

/** Convert a sanitized McpConfig into mcp:import input args (no transport field for stdio). */
export function mcpConfigToAaiImportArgs(config: McpConfig): Record<string, unknown> {
  if (config.transport === 'stdio') {
    const args: Record<string, unknown> = { command: config.command };
    if (config.args?.length) args.args = config.args;
    if (config.env) args.env = config.env;
    if (config.cwd) args.cwd = config.cwd;
    if (config.timeout !== undefined) args.timeout = config.timeout;
    return args;
  }
  const args: Record<string, unknown> = { url: config.url, transport: config.transport };
  if (config.headers) args.headers = config.headers;
  if (config.timeout !== undefined) args.timeout = config.timeout;
  return args;
}

/** Convert a sanitized McpConfig into a standard mcpServers entry value ({ command, args, ... } | { url, ... }). */
export function buildMcpServersEntry(config: McpConfig): Record<string, unknown> {
  if (config.transport === 'stdio') {
    const entry: Record<string, unknown> = { command: config.command };
    if (config.args?.length) entry.args = config.args;
    if (config.env) entry.env = config.env;
    if (config.cwd) entry.cwd = config.cwd;
    return entry;
  }
  const entry: Record<string, unknown> = { url: config.url };
  if (config.transport === 'sse') entry.type = 'sse';
  if (config.headers) entry.headers = config.headers;
  return entry;
}

/**
 * Build a shareable, desensitized view of an app's configuration.
 * Secrets stored in plaintext are masked as ${VAR_NAME}; required env vars are listed.
 */
export function exportAppConfig(
  descriptor: AaiJson,
  format: AppConfigExportFormat = 'all'
): AppConfigExport {
  const name = descriptor.app.name.default;
  const summary = descriptor.exposure.summary;
  const access = descriptor.access;

  if (access.protocol === 'skill') {
    const config = access.config;
    if (!isSkillPathConfig(config)) {
      throw new AaiError('INVALID_REQUEST', 'getAppConfig does not support URL-based skills.');
    }
    const requiredEnvVars = extractConfigEnvVars(config as unknown as Record<string, unknown>);
    return {
      protocol: 'skill',
      name,
      summary,
      config,
      requiredEnvVars,
      install: {},
      skill: {
        path: config.path,
        note: 'Skills are local directories. To share, package this directory and have the recipient import it via skill:import pointing at their local copy.',
      },
    };
  }

  if (access.protocol !== 'mcp') {
    throw new AaiError(
      'INVALID_REQUEST',
      `getAppConfig does not support '${access.protocol}' apps.`
    );
  }
  const config = sanitizeMcpConfig(access.config);
  const requiredEnvVars = extractConfigEnvVars(config as unknown as Record<string, unknown>);

  const install: AppConfigExport['install'] = {};
  if (format === 'aai' || format === 'all') {
    install.aai = {
      tool: 'aai:exec',
      args: {
        tool: 'mcp:import',
        args: {
          ...mcpConfigToAaiImportArgs(config),
          name,
          summary,
        },
      },
    };
  }
  if (format === 'mcp-json' || format === 'all') {
    install.mcpJson = {
      mcpServers: {
        [name]: buildMcpServersEntry(config),
      },
    };
  }

  return { protocol: 'mcp', name, summary, config, requiredEnvVars, install };
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (
    normalized === 'authorization' ||
    normalized === 'api_key' ||
    normalized === 'apikey' ||
    normalized === 'token' ||
    normalized === 'secret' ||
    normalized === 'password'
  ) {
    return true;
  }
  return (
    normalized.includes('api-key') ||
    normalized.includes('apikey') ||
    normalized.includes('api_key') ||
    normalized.endsWith('_token') ||
    normalized.endsWith('_secret') ||
    normalized.endsWith('_password') ||
    normalized.endsWith('-token') ||
    normalized.endsWith('-secret') ||
    normalized.endsWith('-password')
  );
}

export async function resolveImportedMcpRuntimeValues(
  config: McpConfig
): Promise<{
  resolvedConfig: McpConfig;
  dotenv: Record<string, string>;
  missingVars: string[];
}> {
  const { env: dotenv, missing: missingInEnv } = await loadDotenv();
  const configAsRecord: Record<string, unknown> = JSON.parse(JSON.stringify(config));
  const { result: substitutedConfig, missing: configMissing } = substituteConfigEnvVars(
    configAsRecord,
    dotenv
  );

  const missingVars = [...missingInEnv, ...configMissing];
  return {
    resolvedConfig: substitutedConfig as unknown as McpConfig,
    dotenv,
    missingVars,
  };
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
  appId: string
): Promise<string> {
  const serverInfo = await executor.getServerInfo?.({
    appId,
    config,
  });
  if (serverInfo?.name) {
    return serverInfo.name;
  }

  return config.transport === 'stdio' ? basename(config.command) : new URL(config.url).hostname;
}

export function buildImportedMcpDescriptor(name: string, config: McpConfig, exposure: SummaryDraft): AaiJson {
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
  // Strip version suffix: @playwright/mcp@latest → @playwright/mcp
  const withoutVersion = trimmed.replace(/@[^/]*$/, '');

  let scopeName: string | undefined;
  let withoutScope: string;
  if (withoutVersion.startsWith('@')) {
    const parts = withoutVersion.split('/');
    scopeName = parts[0].slice(1); // "playwright"
    withoutScope = parts.slice(1).join('/');
  } else {
    withoutScope = withoutVersion;
  }

  const lastSegment = withoutScope.split('/').filter(Boolean).pop() ?? withoutScope;
  const normalized = lastSegment
    .replace(/^modelcontextprotocol-/, '')
    .replace(/^mcp-server-/, 'server-')
    .replace(/^mcp-/, '');

  const slug = slugify(normalized);

  // If the result is too generic (e.g. "mcp" from @playwright/mcp), use scope name instead
  if ((!slug || slug === 'mcp' || slug === 'app') && scopeName) {
    return slugify(scopeName) || 'mcp';
  }

  return slug || 'mcp';
}

export function normalizeImportedAppName(name: string | undefined): string | undefined {
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
