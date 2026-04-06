/**
 * MCP Argument Parsers
 *
 * Handles parsing and validation of MCP tool call arguments.
 * These are MCP-protocol-specific input normalization functions.
 */

import type { McpConfig } from '../types/aai-json.js';
import { AaiError } from '../errors/errors.js';
import {
  buildMcpImportConfig,
  buildSkillImportSource,
  normalizeSummaryInput,
} from './importer.js';

export interface ParsedMcpImportArgs {
  name?: string;
  config: McpConfig;
  metadata?: {
    summary: string;
    enableScope: 'current' | 'all';
  };
}

export interface ParsedSkillImportArgs {
  path: string;
}

export function parseMcpImportArguments(args: Record<string, unknown> | undefined): ParsedMcpImportArgs {
  try {
    // Normalize: when command is an array (common in standard MCP JSON configs),
    // split into command (first element) + args (remaining elements).
    let command = args?.command;
    let argsArray = args?.args;
    if (Array.isArray(command)) {
      const parts = command.filter((item): item is string => typeof item === 'string');
      if (parts.length > 0) {
        command = parts[0];
        if (parts.length > 1) {
          argsArray = [...parts.slice(1), ...(Array.isArray(argsArray) ? argsArray : [])];
        }
      }
    }

    // Normalize: accept "environment" as an alias for "env".
    const env = args?.env ?? args?.environment;

    // Normalize: accept "headers" for remote MCP imports.
    const headers = args?.headers;

    return {
      name: asOptionalString(args?.name),
      config: buildMcpImportConfig({
        transport:
          args?.transport === 'streamable-http' || args?.transport === 'sse'
            ? args.transport
            : undefined,
        url: asOptionalString(args?.url),
        command: asOptionalString(command),
        timeout: asOptionalPositiveInteger(args?.timeout, 'timeout'),
        args: asOptionalStringArray(argsArray, 'args'),
        env: asOptionalStringRecord(env, 'env'),
        cwd: asOptionalString(args?.cwd),
        headers: asOptionalStringRecord(headers, 'headers'),
      }),
      metadata: parseOptionalMcpImportMetadata(args),
    };
  } catch (err) {
    throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
  }
}

export function parseSkillImportArguments(args: Record<string, unknown> | undefined): ParsedSkillImportArgs {
  try {
    const source = buildSkillImportSource({
      path: asOptionalString(args?.path),
    });

    return { path: source.path! };
  } catch (err) {
    throw new AaiError('INVALID_REQUEST', err instanceof Error ? err.message : String(err));
  }
}

function parseOptionalMcpImportMetadata(args: Record<string, unknown> | undefined):
  | { summary: string; enableScope: 'current' | 'all' }
  | undefined {
  const hasSummary = args?.summary !== undefined;
  const hasEnableScope = args?.enableScope !== undefined;
  const providedCount = Number(hasSummary) + Number(hasEnableScope);

  if (providedCount === 0) return undefined;

  if (providedCount !== 2) {
    throw new Error(
      "MCP import requires 'summary' and 'enableScope' together. Omit both for inspection, or provide both for the final import."
    );
  }

  const summary = asOptionalString(args?.summary);
  const enableScope = parseEnableScope(args?.enableScope);

  if (!summary) {
    throw new Error("Import received an empty 'summary'");
  }

  return { ...normalizeSummaryInput(summary), enableScope };
}

function parseEnableScope(value: unknown): 'current' | 'all' {
  if (value === 'current' || value === 'all') return value;
  throw new Error("MCP import requires 'enableScope' to be either 'current' or 'all'");
}

// ============================================================
// Primitive type helpers
// ============================================================

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer in milliseconds`);
  }
  return value;
}

export function asOptionalStringArray(value: unknown, field: string): string[] | undefined {
  const normalized = tryParseJsonString(value);
  if (normalized === undefined) return undefined;
  if (!Array.isArray(normalized)) {
    throw new AaiError('INVALID_REQUEST', `${field} must be an array of strings`);
  }
  if (normalized.find((item) => typeof item !== 'string') !== undefined) {
    throw new AaiError('INVALID_REQUEST', `${field} must contain only strings`);
  }
  return normalized as string[];
}

export function asOptionalStringRecord(value: unknown, field: string): Record<string, string> | undefined {
  const normalized = tryParseJsonString(value);
  if (normalized === undefined) return undefined;
  if (!isStringRecord(normalized)) {
    throw new AaiError('INVALID_REQUEST', `${field} must be an object with string values`);
  }
  return normalized;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function tryParseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length === 0 || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function normalizeArgumentsWithSchema(value: unknown, schema: Record<string, unknown>): unknown {
  const normalized = parseJsonStringForExpectedType(value, schema);
  const type = schema.type as string | undefined;

  if (
    type === 'object' &&
    normalized &&
    typeof normalized === 'object' &&
    !Array.isArray(normalized)
  ) {
    const properties = schema.properties as Record<string, unknown> | undefined;
    const additionalProperties = schema.additionalProperties;
    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(normalized as Record<string, unknown>)) {
      const propertySchema = properties?.[key];
      if (propertySchema && typeof propertySchema === 'object' && !Array.isArray(propertySchema)) {
        result[key] = normalizeArgumentsWithSchema(item, propertySchema as Record<string, unknown>);
        continue;
      }
      if (
        additionalProperties &&
        typeof additionalProperties === 'object' &&
        !Array.isArray(additionalProperties)
      ) {
        result[key] = normalizeArgumentsWithSchema(
          item,
          additionalProperties as Record<string, unknown>
        );
        continue;
      }
      result[key] = item;
    }
    return result;
  }

  if (type === 'array' && Array.isArray(normalized)) {
    const itemSchema = schema.items;
    if (itemSchema && typeof itemSchema === 'object' && !Array.isArray(itemSchema)) {
      return normalized.map((item) =>
        normalizeArgumentsWithSchema(item, itemSchema as Record<string, unknown>)
      );
    }
  }

  return normalized;
}

function parseJsonStringForExpectedType(value: unknown, schema: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value;
  const expectedType = schema.type as string | undefined;
  const trimmed = value.trim();

  if (expectedType === 'object' && trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { return value; }
  }
  if (expectedType === 'array' && trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { return value; }
  }
  return value;
}

// ============================================================
// Log summarization helpers
// ============================================================

export function summarizeExecArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = { keys: Object.keys(args) };

  if (typeof args.sessionId === 'string') summary.sessionId = args.sessionId;
  if (typeof args.turnId === 'string') summary.turnId = args.turnId;

  if (typeof args.text === 'string') {
    summary.textLength = args.text.length;
    summary.textPreview = truncateLogPreview(args.text);
  } else if (typeof args.message === 'string') {
    summary.messageLength = args.message.length;
    summary.messagePreview = truncateLogPreview(args.message);
  } else if (Array.isArray(args.prompt)) {
    summary.promptBlocks = args.prompt.length;
  }

  if (typeof args.cwd === 'string') summary.cwd = args.cwd;
  return summary;
}

export function summarizeExecResult(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  if (typeof record.turnId === 'string') summary.turnId = record.turnId;
  if (typeof record.sessionId === 'string') summary.sessionId = record.sessionId;
  if (typeof record.done === 'boolean') summary.done = record.done;
  if (typeof record.cancelled === 'boolean') summary.cancelled = record.cancelled;
  if (typeof record.status === 'string') summary.status = record.status;
  if (typeof record.error === 'string') summary.error = truncateLogPreview(record.error);
  if (Array.isArray(record.content)) {
    summary.contentBlocks = record.content.length;
    const textPreview = previewStructuredContent(record.content);
    if (textPreview) summary.textPreview = textPreview;
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

export function summarizeRawImportArgs(
  args: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!args) return {};
  return {
    keys: Object.keys(args),
    ...(typeof args.name === 'string' ? { name: args.name } : {}),
    ...(typeof args.command === 'string' ? { command: args.command } : {}),
    ...(Array.isArray(args.args) ? { argvLength: args.args.length } : {}),
    ...(typeof args.cwd === 'string' ? { cwd: args.cwd } : {}),
    ...(typeof args.url === 'string' ? { url: args.url } : {}),
    ...(typeof args.transport === 'string' ? { transport: args.transport } : {}),
    ...(typeof args.path === 'string' ? { path: args.path } : {}),
    ...(typeof args.enableScope === 'string' ? { enableScope: args.enableScope } : {}),
    ...(typeof args.summary === 'string' ? { summaryLength: args.summary.length } : {}),
    ...(args.env && typeof args.env === 'object' && !Array.isArray(args.env)
      ? { envKeys: Object.keys(args.env as Record<string, unknown>) }
      : {}),
  };
}

export function summarizeMcpImportRequest(options: ParsedMcpImportArgs): Record<string, unknown> {
  return {
    ...(options.name ? { name: options.name } : {}),
    config: summarizeMcpConfig(options.config),
    ...(options.metadata
      ? { summaryLength: options.metadata.summary.length, enableScope: options.metadata.enableScope }
      : {}),
  };
}

export function summarizeSkillImportRequest(options: ParsedSkillImportArgs): Record<string, unknown> {
  return { path: options.path };
}

function summarizeMcpConfig(config: McpConfig): Record<string, unknown> {
  switch (config.transport) {
    case 'stdio':
      return {
        transport: config.transport,
        command: config.command,
        argvLength: config.args?.length ?? 0,
        ...(config.cwd ? { cwd: config.cwd } : {}),
        ...(config.env ? { envKeys: Object.keys(config.env) } : {}),
        ...(config.timeout ? { timeout: config.timeout } : {}),
      };
    case 'streamable-http':
    case 'sse':
      return {
        transport: config.transport,
        url: config.url,
        ...(config.timeout ? { timeout: config.timeout } : {}),
      };
  }
}

function truncateLogPreview(value: string, maxChars = 160): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function previewStructuredContent(content: unknown[], maxChars = 160): string | undefined {
  const text = content
    .filter(
      (item): item is { type?: unknown; text?: unknown } =>
        !!item && typeof item === 'object' && !Array.isArray(item)
    )
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('');
  return text.length > 0 ? truncateLogPreview(text, maxChars) : undefined;
}
