import { z } from 'zod';

export type Platform = 'macos' | 'windows' | 'linux' | 'web';
export type MacOSAutomation = 'applescript' | 'jxa';
export type WindowsAutomation = 'com';
export type LinuxAutomation = 'dbus';
export type WebAutomation = 'restapi';

const ToolParametersSchema = z.object({
  type: z.literal('object'),
  properties: z.record(
    z.object({
      type: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()).optional(),
      default: z.unknown().optional(),
    })
  ),
  required: z.array(z.string()).optional(),
});

const MacOSToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: ToolParametersSchema,
  script: z.string(),
  output_parser: z.string().optional(),
  timeout: z.number().optional(),
  cache_ttl: z.number().int().min(0).optional(),
});

const WindowsScriptActionSchema = z.object({
  action: z.enum(['create', 'call', 'set', 'get', 'return']),
  var: z.string().optional(),
  object: z.string().optional(),
  progid: z.string().optional(),
  method: z.string().optional(),
  property: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  args: z.array(z.unknown()).optional(),
});

const WindowsToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: ToolParametersSchema,
  script: z.array(WindowsScriptActionSchema),
  output_parser: z.string().optional(),
  timeout: z.number().optional(),
  cache_ttl: z.number().int().min(0).optional(),
});

const LinuxToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: ToolParametersSchema,
  method: z.string(),
  output_parser: z.string().optional(),
  timeout: z.number().optional(),
  cache_ttl: z.number().int().min(0).optional(),
});

const WebOAuth2AuthSchema = z.object({
  type: z.literal('oauth2'),
  auth_url: z.string(),
  token_url: z.string(),
  scopes: z.array(z.string()).optional(),
  token_placement: z.enum(['header', 'query']).default('header'),
  token_prefix: z.string().default('Bearer'),
});

const WebApiKeyAuthSchema = z.object({
  type: z.literal('api_key'),
  env_var: z.string(),
  key_name: z.string(),
  key_placement: z.enum(['header', 'query']).default('header'),
});

const WebBearerAuthSchema = z.object({
  type: z.literal('bearer'),
  env_var: z.string(),
  token_placement: z.enum(['header', 'query']).default('header'),
  token_prefix: z.string().default('Bearer'),
});

const WebAuthSchema = z.discriminatedUnion('type', [
  WebOAuth2AuthSchema,
  WebApiKeyAuthSchema,
  WebBearerAuthSchema,
]);

const WebToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: ToolParametersSchema,
  endpoint: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  body: z.record(z.unknown()).optional(),
  query_params: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  output_parser: z.enum(['json', 'text']).default('json'),
  timeout: z.number().optional(),
  cache_ttl: z.number().int().min(0).optional(),
});

const MacOSPlatformSchema = z.object({
  automation: z.enum(['applescript', 'jxa']),
  tools: z.array(MacOSToolSchema),
});

const WindowsPlatformSchema = z.object({
  automation: z.literal('com'),
  progid: z.string().optional(),
  tools: z.array(WindowsToolSchema),
});

const LinuxPlatformSchema = z.object({
  automation: z.literal('dbus'),
  service: z.string(),
  object: z.string(),
  interface: z.string(),
  tools: z.array(LinuxToolSchema),
});

const WebPlatformSchema = z.object({
  automation: z.literal('restapi'),
  base_url: z.string(),
  auth: WebAuthSchema,
  default_headers: z.record(z.string()).optional(),
  tools: z.array(WebToolSchema),
});

export const AaiJsonSchema = z.object({
  schema_version: z.string().regex(/^\d+\.\d+$/),
  appId: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  platforms: z
    .object({
      macos: MacOSPlatformSchema.optional(),
      windows: WindowsPlatformSchema.optional(),
      linux: LinuxPlatformSchema.optional(),
      web: WebPlatformSchema.optional(),
    })
    .refine((platforms) => Object.keys(platforms).length > 0, {
      message: 'At least one platform must be defined',
    }),
});

export type AaiJson = z.infer<typeof AaiJsonSchema>;
export type MacOSTool = z.infer<typeof MacOSToolSchema>;
export type WindowsTool = z.infer<typeof WindowsToolSchema>;
export type LinuxTool = z.infer<typeof LinuxToolSchema>;
export type WebTool = z.infer<typeof WebToolSchema>;
export type WebAuth = z.infer<typeof WebAuthSchema>;
export type WebPlatform = z.infer<typeof WebPlatformSchema>;
export type ToolParameters = z.infer<typeof ToolParametersSchema>;

export function validateAaiJson(data: unknown): AaiJson {
  return AaiJsonSchema.parse(data);
}

export function isValidAaiJson(data: unknown): data is AaiJson {
  return AaiJsonSchema.safeParse(data).success;
}
