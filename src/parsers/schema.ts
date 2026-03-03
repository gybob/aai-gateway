import { z } from 'zod';
import { AaiError } from '../errors/errors.js';
import type { AaiJson } from '../types/aai-json.js';

// ========== Tool Schemas ==========

const ToolExecutionSchema = z.object({
  path: z.string(),
  method: z.string(),
  headers: z.record(z.string()).optional(),
});

const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
  returns: z.record(z.unknown()).optional(),
  execution: ToolExecutionSchema.optional(),
});

// ========== Auth Schemas ==========

const AuthInstructionsSchema = z.object({
  short: z.string(),
  detailed: z.string().optional(),
  helpUrl: z.string().optional(),
  screenshotUrl: z.string().optional(),
});

// OAuth2 Auth
const OAuth2AuthSchema = z.object({
  type: z.literal('oauth2'),
  oauth2: z.object({
    authorizationEndpoint: z.string(),
    tokenEndpoint: z.string(),
    scopes: z.array(z.string()),
    pkce: z.object({ method: z.literal('S256') }),
    refreshEndpoint: z.string().optional(),
    extraParams: z.record(z.string()).optional(),
  }),
});

// API Key Auth
const ApiKeyAuthSchema = z.object({
  type: z.literal('apiKey'),
  apiKey: z.object({
    location: z.enum(['header', 'query']),
    name: z.string(),
    prefix: z.string().optional(),
    obtainUrl: z.string(),
    instructions: AuthInstructionsSchema.optional(),
  }),
});

// App Credential Auth (e.g., Feishu)
const AppCredentialAuthSchema = z.object({
  type: z.literal('appCredential'),
  appCredential: z.object({
    tokenEndpoint: z.string(),
    tokenType: z.enum(['tenantAccessToken', 'appAccessToken', 'userAccessToken']),
    expiresIn: z.number(),
    instructions: AuthInstructionsSchema.optional(),
  }),
});

// Cookie Auth
const CookieAuthSchema = z.object({
  type: z.literal('cookie'),
  cookie: z.object({
    loginUrl: z.string(),
    requiredCookies: z.array(z.string()),
    domain: z.string(),
    instructions: z.string().optional(),
  }),
});

// Union of all auth types
const AuthSchema = z.discriminatedUnion('type', [
  OAuth2AuthSchema,
  ApiKeyAuthSchema,
  AppCredentialAuthSchema,
  CookieAuthSchema,
]);

// ========== Main Schema ==========

const ExecutionSchema = z.object({
  type: z.enum(['ipc', 'http']),
  baseUrl: z.string().optional(),
  defaultHeaders: z.record(z.string()).optional(),
});

const AppSchema = z.object({
  id: z.string(),
  name: z.record(z.string()),
  defaultLang: z.string(),
  description: z.string(),
  aliases: z.array(z.string()).optional(),
});

export const AaiJsonSchema = z.object({
  schemaVersion: z.literal('1.0'),
  version: z.string(),
  platform: z.enum(['macos', 'linux', 'windows', 'web']),
  app: AppSchema,
  execution: ExecutionSchema,
  auth: AuthSchema.optional(),
  tools: z.array(ToolSchema),
});

// ========== Parser ==========

export function parseAaiJson(raw: unknown): AaiJson {
  const result = AaiJsonSchema.safeParse(raw);
  if (!result.success) {
    throw new AaiError('INVALID_REQUEST', `Invalid aai.json: ${result.error.message}`);
  }
  return result.data as AaiJson;
}
