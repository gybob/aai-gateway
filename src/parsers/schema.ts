import { z } from 'zod';
import { AaiError } from '../errors/errors.js';
import type { AaiJson } from '../types/aai-json.js';

const LocalizedNameSchema = z
  .record(z.string())
  .and(z.object({ default: z.string().min(1) }));

const CommandConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const McpConfigSchema = z.discriminatedUnion('transport', [
  CommandConfigSchema.extend({
    transport: z.literal('stdio'),
  }),
  z.object({
    transport: z.literal('streamable-http'),
    url: z.string().url(),
  }),
  z.object({
    transport: z.literal('sse'),
    url: z.string().url(),
  }),
]);

const SkillConfigSchema = z.union([
  z.object({
    path: z.string().min(1),
  }),
  z.object({
    url: z.string().url(),
  }),
]);

const AccessSchema = z.discriminatedUnion('protocol', [
  z.object({
    protocol: z.literal('mcp'),
    config: McpConfigSchema,
  }),
  z.object({
    protocol: z.literal('skill'),
    config: SkillConfigSchema,
  }),
  z.object({
    protocol: z.literal('acp-agent'),
    config: CommandConfigSchema,
  }),
  z.object({
    protocol: z.literal('cli'),
    config: CommandConfigSchema,
  }),
]);

export const AaiJsonSchema = z.object({
  schemaVersion: z.literal('2.0'),
  version: z.string().min(1),
  app: z.object({
    name: LocalizedNameSchema,
    iconUrl: z.string().url().optional(),
  }),
  access: AccessSchema,
  exposure: z.object({
    keywords: z.array(z.string().min(1)).max(8),
    summary: z.string().min(1).max(500),
  }),
});

export function parseAaiJson(raw: unknown): AaiJson {
  const result = AaiJsonSchema.safeParse(raw);
  if (!result.success) {
    throw new AaiError('INVALID_REQUEST', `Invalid aai.json: ${result.error.message}`);
  }
  return result.data as AaiJson;
}
