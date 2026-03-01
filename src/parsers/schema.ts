import { z } from "zod";
import { AaiError } from "../errors/errors.js";
import type { AaiJson } from "../types/aai-json.js";

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

const AuthSchema = z.object({
  type: z.literal("oauth2"),
  oauth2: z.object({
    authorization_endpoint: z.string(),
    token_endpoint: z.string(),
    scopes: z.array(z.string()),
    pkce: z.object({ method: z.literal("S256") }),
  }),
});

const ExecutionSchema = z.object({
  type: z.enum(["ipc", "http"]),
  base_url: z.string().optional(),
  default_headers: z.record(z.string()).optional(),
});

export const AaiJsonSchema = z.object({
  schema_version: z.literal("1.0"),
  version: z.string(),
  platform: z.enum(["macos", "linux", "windows", "web"]),
  app: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    aliases: z.array(z.string()).optional(),
  }),
  execution: ExecutionSchema,
  auth: AuthSchema.optional(),
  tools: z.array(ToolSchema),
});

export function parseAaiJson(raw: unknown): AaiJson {
  const result = AaiJsonSchema.safeParse(raw);
  if (!result.success) {
    throw new AaiError(
      "INVALID_REQUEST",
      `Invalid aai.json: ${result.error.message}`
    );
  }
  return result.data as AaiJson;
}
