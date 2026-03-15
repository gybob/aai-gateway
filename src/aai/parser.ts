import { z } from 'zod';

import { AaiError } from '../errors/errors.js';
import type { AaiDescriptor, CatalogSection, PrimitiveSummary } from './types.js';

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());
const JsonSchemaObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());
const ScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const IconSchema = z.object({
  src: z.string(),
  mimeType: z.string().optional(),
  sizes: z.array(z.string()).optional(),
  theme: z.enum(['light', 'dark']).optional(),
});

const InputFieldSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  default: ScalarSchema.optional(),
  choices: z.array(ScalarSchema).optional(),
});

const HeaderFieldSchema = InputFieldSchema;

const PrimitiveSummarySchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(['tool', 'prompt', 'resource', 'resource-template']),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  runtimeId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const ToolAnnotationsSchema = z.object({
  title: z.string().optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

const ToolBindingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mcp-tool'),
    toolName: z.string().optional(),
  }),
  z.object({
    type: z.literal('http'),
    path: z.string(),
    method: z.string(),
    headers: z.record(z.string()).optional(),
  }),
  z.object({
    type: z.literal('graphql'),
    document: z.string(),
    operationName: z.string().optional(),
  }),
  z.object({
    type: z.literal('ipc'),
    operation: z.string(),
  }),
]);

const ToolDefSchema = z.object({
  ref: z.string().optional(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  icons: z.array(IconSchema).optional(),
  inputSchema: JsonSchemaObjectSchema,
  outputSchema: JsonSchemaObjectSchema.optional(),
  annotations: ToolAnnotationsSchema.optional(),
  execution: z
    .object({
      taskSupport: z.enum(['forbidden', 'optional', 'required']).optional(),
    })
    .optional(),
  runtimeId: z.string().optional(),
  binding: ToolBindingSchema.optional(),
  _meta: JsonObjectSchema.optional(),
});

const PromptArgumentSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

const PromptDefSchema = z.object({
  ref: z.string().optional(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  icons: z.array(IconSchema).optional(),
  arguments: z.array(PromptArgumentSchema).optional(),
  runtimeId: z.string().optional(),
  _meta: JsonObjectSchema.optional(),
});

const CommonAnnotationsSchema = z.object({
  audience: z.array(z.enum(['user', 'assistant'])).optional(),
  priority: z.number().optional(),
  lastModified: z.string().optional(),
});

const ResourceDefSchema = z.object({
  ref: z.string().optional(),
  name: z.string(),
  title: z.string().optional(),
  uri: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  icons: z.array(IconSchema).optional(),
  size: z.number().optional(),
  annotations: CommonAnnotationsSchema.optional(),
  runtimeId: z.string().optional(),
  _meta: JsonObjectSchema.optional(),
});

const ResourceTemplateDefSchema = z.object({
  ref: z.string().optional(),
  name: z.string(),
  title: z.string().optional(),
  uriTemplate: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  icons: z.array(IconSchema).optional(),
  annotations: CommonAnnotationsSchema.optional(),
  runtimeId: z.string().optional(),
  _meta: JsonObjectSchema.optional(),
});

const CatalogSectionSchema = (detailSchema: z.ZodTypeAny) =>
  z.object({
    mode: z.enum(['none', 'snapshot', 'live', 'hybrid']),
    sourceRuntimeId: z.string().optional(),
    listChanged: z.boolean().optional(),
    subscribe: z.boolean().optional(),
    summary: z.array(PrimitiveSummarySchema).optional(),
    snapshot: z.array(detailSchema).optional(),
  });

const AuthProfileSchema = z.object({
  type: z.enum([
    'none',
    'env',
    'header',
    'query',
    'oauth2',
    'oauth2-protected-resource',
    'basic',
    'cookie',
    'custom',
  ]),
  instructions: z.string().optional(),
  inputs: z.array(InputFieldSchema).optional(),
  oauth2: z
    .object({
      issuerUrl: z.string().optional(),
      authorizationServerUrl: z.string().optional(),
      authorizationEndpoint: z.string().optional(),
      tokenEndpoint: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      audience: z.string().optional(),
      pkce: z.boolean().optional(),
    })
    .optional(),
});

const RuntimeCapabilitiesSchema = z.object({
  logging: z.boolean().optional(),
  completions: z.boolean().optional(),
  prompts: z.object({ listChanged: z.boolean().optional() }).optional(),
  resources: z
    .object({
      subscribe: z.boolean().optional(),
      listChanged: z.boolean().optional(),
    })
    .optional(),
  tools: z.object({ listChanged: z.boolean().optional() }).optional(),
  tasks: z
    .object({
      list: z.boolean().optional(),
      cancel: z.boolean().optional(),
      requests: z
        .object({
          toolsCall: z.boolean().optional(),
          resourcesRead: z.boolean().optional(),
          promptsGet: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  serverRequests: z
    .object({
      roots: z.boolean().optional(),
      sampling: z.boolean().optional(),
      elicitation: z
        .object({
          form: z.boolean().optional(),
          url: z.boolean().optional(),
        })
        .optional(),
      ping: z.boolean().optional(),
    })
    .optional(),
});

const RuntimeSchema = z.object({
  id: z.string(),
  kind: z.enum(['rpc', 'http-api', 'ipc']),
  label: z.string().optional(),
  priority: z.number().optional(),
  default: z.boolean().optional(),
  protocol: z.enum(['mcp', 'acp', 'jsonrpc', 'rest', 'graphql', 'native']),
  transport: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('stdio'),
      command: z.string(),
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
    }),
    z.object({
      type: z.literal('streamable-http'),
      url: z.string(),
      variables: z.array(InputFieldSchema).optional(),
      headers: z.array(HeaderFieldSchema).optional(),
    }),
    z.object({
      type: z.literal('sse'),
      url: z.string(),
      variables: z.array(InputFieldSchema).optional(),
      headers: z.array(HeaderFieldSchema).optional(),
    }),
    z.object({
      type: z.literal('http'),
      baseUrl: z.string(),
      variables: z.array(InputFieldSchema).optional(),
      headers: z.array(HeaderFieldSchema).optional(),
    }),
    z.object({
      type: z.literal('apple-events'),
      bundleId: z.string(),
    }),
    z.object({
      type: z.literal('dbus'),
      bus: z.enum(['session', 'system']).optional(),
      service: z.string(),
      objectPath: z.string(),
      interface: z.string(),
    }),
    z.object({
      type: z.literal('com'),
      progId: z.string(),
    }),
    z.object({
      type: z.literal('unix-socket'),
      path: z.string(),
    }),
    z.object({
      type: z.literal('named-pipe'),
      path: z.string(),
    }),
  ]),
  auth: AuthProfileSchema.optional(),
  session: z
    .object({
      mode: z.enum(['stateless', 'sticky']).optional(),
      resumable: z.boolean().optional(),
      idleTtlSeconds: z.number().optional(),
      reuseProcess: z.boolean().optional(),
    })
    .optional(),
  capabilities: RuntimeCapabilitiesSchema.optional(),
  _meta: JsonObjectSchema.optional(),
});

export const AaiDescriptorSchema: z.ZodType<AaiDescriptor> = z
  .object({
    schemaVersion: z.literal('2.0'),
    identity: z.object({
      id: z.string(),
      name: z.record(z.string()),
      defaultLang: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      version: z.string(),
      websiteUrl: z.string().optional(),
      icons: z.array(IconSchema).optional(),
      aliases: z.array(z.string()).optional(),
      categories: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    }),
    provenance: z
      .object({
        publisher: z
          .object({
            namespace: z.string(),
            name: z.string().optional(),
            verified: z.boolean().optional(),
            websiteUrl: z.string().optional(),
            contactEmail: z.string().optional(),
          })
          .optional(),
        sources: z
          .array(
            z.object({
              kind: z.enum(['server-card', 'registry', 'manual', 'generated', 'local-scan']),
              url: z.string().optional(),
              filePath: z.string().optional(),
              fetchedAt: z.string().optional(),
              digestSha256: z.string().optional(),
              note: z.string().optional(),
            }),
          )
          .optional(),
        integrity: z
          .object({
            signed: z.boolean().optional(),
            signatureUrl: z.string().optional(),
            digestSha256: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    discovery: z
      .object({
        mode: z.enum(['static', 'live', 'hybrid']),
        serverCard: z.object({ url: z.string(), prefer: z.boolean().optional() }).optional(),
        registry: z
          .object({
            manifestUrl: z.string().optional(),
            apiUrl: z.string().optional(),
            namespaceVerified: z.boolean().optional(),
          })
          .optional(),
        refresh: z
          .object({
            strategy: z.enum(['lazy', 'eager']).optional(),
            ttlSeconds: z.number().optional(),
            honorListChanged: z.boolean().optional(),
            preloadCatalog: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    disclosure: z
      .object({
        mode: z.enum(['required', 'preferred', 'disabled']),
        modelSurface: z.enum(['integration-only', 'catalog-summary', 'full-catalog']).optional(),
        detailLoad: z.enum(['on-demand', 'prefetch-selected', 'prefetch-all']).optional(),
        executionSurface: z.enum(['universal-exec', 'direct-primitive', 'either']).optional(),
        maxVisibleItems: z.number().int().positive().optional(),
      })
      .optional(),
    runtimes: z.array(RuntimeSchema).min(1),
    catalog: z.object({
      tools: CatalogSectionSchema(ToolDefSchema),
      prompts: CatalogSectionSchema(PromptDefSchema).optional(),
      resources: CatalogSectionSchema(ResourceDefSchema).optional(),
      resourceTemplates: CatalogSectionSchema(ResourceTemplateDefSchema).optional(),
    }),
    hostInteraction: z
      .object({
        roots: z
          .object({
            enabled: z.boolean(),
            mode: z.enum(['none', 'fixed', 'user-selected', 'workspace']).optional(),
            listChanged: z.boolean().optional(),
            snapshot: z.array(z.object({ uri: z.string(), name: z.string().optional(), _meta: JsonObjectSchema.optional() })).optional(),
          })
          .optional(),
        sampling: z
          .object({
            enabled: z.boolean(),
            mode: z.enum(['deny', 'confirm', 'allow']).optional(),
            allowedModalities: z.array(z.enum(['text', 'image', 'audio'])).optional(),
            humanApproval: z.boolean().optional(),
          })
          .optional(),
        elicitation: z
          .object({
            enabled: z.boolean(),
            modes: z.array(z.enum(['form', 'url'])).optional(),
            humanApproval: z.boolean().optional(),
          })
          .optional(),
        logging: z
          .object({
            enabled: z.boolean(),
            defaultLevel: z
              .enum(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'])
              .optional(),
          })
          .optional(),
        progress: z.object({ enabled: z.boolean() }).optional(),
        tasks: z.object({ enabled: z.boolean(), defaultTtlMs: z.number().optional() }).optional(),
      })
      .optional(),
    policy: z
      .object({
        consent: z
          .object({
            perCaller: z.boolean().optional(),
            scope: z.enum(['runtime', 'primitive']).optional(),
            requireFor: z.array(z.string()).optional(),
          })
          .optional(),
        audit: z
          .object({
            logRequests: z.boolean().optional(),
            logResponses: z.boolean().optional(),
            redactSecrets: z.boolean().optional(),
          })
          .optional(),
        cache: z
          .object({
            descriptorTtlSeconds: z.number().optional(),
            catalogTtlSeconds: z.number().optional(),
          })
          .optional(),
        limits: z
          .object({
            requestTimeoutMs: z.number().optional(),
            maxConcurrentRequests: z.number().optional(),
            maxContentBytes: z.number().optional(),
            maxImageBytes: z.number().optional(),
            maxAudioBytes: z.number().optional(),
          })
          .optional(),
        trust: z
          .object({
            allowUnverifiedPublishers: z.boolean().optional(),
            allowedOrigins: z.array(z.string()).optional(),
            iconFetchPolicy: z.enum(['same-origin-only', 'allow-https', 'data-uri-only']).optional(),
          })
          .optional(),
      })
      .optional(),
    _meta: JsonObjectSchema.optional(),
  })
  .superRefine((descriptor, ctx) => {
    validateCatalogRefs(descriptor, ctx);
    validateRuntimeReferences(descriptor, ctx);
  });

function validateCatalogRefs(descriptor: AaiDescriptor, ctx: z.RefinementCtx): void {
  const summaryKinds = new Map<string, PrimitiveSummary['kind']>();
  const summaryNames = new Map<string, string>();
  const detailKinds = new Map<string, PrimitiveSummary['kind']>();
  const detailNames = new Map<string, string>();

  const collectSummary = (section: CatalogSection<unknown> | undefined): void => {
    for (const item of section?.summary ?? []) {
      const seenKind = summaryKinds.get(item.ref);
      if (seenKind && seenKind !== item.kind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Primitive ref '${item.ref}' is reused across summary items with different kinds`,
        });
      }
      summaryKinds.set(item.ref, item.kind);
      summaryNames.set(item.ref, item.name);
    }
  };

  const collectDetails = <T extends { ref?: string; name: string }>(
    kind: PrimitiveSummary['kind'],
    entries: T[] | undefined,
  ): void => {
    for (const item of entries ?? []) {
      if (!item.ref) {
        continue;
      }

      const seenKind = detailKinds.get(item.ref);
      if (seenKind && seenKind !== kind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Primitive ref '${item.ref}' is reused across detailed items with different kinds`,
        });
      }
      detailKinds.set(item.ref, kind);
      detailNames.set(item.ref, item.name);
    }
  };

  collectSummary(descriptor.catalog.tools);
  collectSummary(descriptor.catalog.prompts);
  collectSummary(descriptor.catalog.resources);
  collectSummary(descriptor.catalog.resourceTemplates);

  collectDetails('tool', descriptor.catalog.tools.snapshot);
  collectDetails('prompt', descriptor.catalog.prompts?.snapshot);
  collectDetails('resource', descriptor.catalog.resources?.snapshot);
  collectDetails('resource-template', descriptor.catalog.resourceTemplates?.snapshot);

  for (const [ref, kind] of detailKinds) {
    const summaryKind = summaryKinds.get(ref);
    if (summaryKind && summaryKind !== kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Primitive ref '${ref}' has mismatched kinds between summary and detail`,
      });
    }
    const summaryName = summaryNames.get(ref);
    const detailName = detailNames.get(ref);
    if (summaryName && detailName && summaryName !== detailName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Primitive ref '${ref}' has mismatched names between summary and detail`,
      });
    }
  }
}

function validateRuntimeReferences(descriptor: AaiDescriptor, ctx: z.RefinementCtx): void {
  const runtimeIds = new Set(descriptor.runtimes.map((runtime) => runtime.id));
  if (runtimeIds.size !== descriptor.runtimes.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Runtime IDs must be unique',
    });
  }

  const assertRuntime = (runtimeId: string | undefined, label: string): void => {
    if (runtimeId && !runtimeIds.has(runtimeId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} references unknown runtimeId '${runtimeId}'`,
      });
    }
  };

  assertRuntime(descriptor.catalog.tools.sourceRuntimeId, 'catalog.tools');
  assertRuntime(descriptor.catalog.prompts?.sourceRuntimeId, 'catalog.prompts');
  assertRuntime(descriptor.catalog.resources?.sourceRuntimeId, 'catalog.resources');
  assertRuntime(descriptor.catalog.resourceTemplates?.sourceRuntimeId, 'catalog.resourceTemplates');

  for (const summary of descriptor.catalog.tools.summary ?? []) {
    assertRuntime(summary.runtimeId, `summary '${summary.ref}'`);
  }
  for (const summary of descriptor.catalog.prompts?.summary ?? []) {
    assertRuntime(summary.runtimeId, `summary '${summary.ref}'`);
  }
  for (const summary of descriptor.catalog.resources?.summary ?? []) {
    assertRuntime(summary.runtimeId, `summary '${summary.ref}'`);
  }
  for (const summary of descriptor.catalog.resourceTemplates?.summary ?? []) {
    assertRuntime(summary.runtimeId, `summary '${summary.ref}'`);
  }

  for (const tool of descriptor.catalog.tools.snapshot ?? []) {
    assertRuntime(tool.runtimeId, `tool '${tool.name}'`);
  }
  for (const prompt of descriptor.catalog.prompts?.snapshot ?? []) {
    assertRuntime(prompt.runtimeId, `prompt '${prompt.name}'`);
  }
  for (const resource of descriptor.catalog.resources?.snapshot ?? []) {
    assertRuntime(resource.runtimeId, `resource '${resource.name}'`);
  }
  for (const template of descriptor.catalog.resourceTemplates?.snapshot ?? []) {
    assertRuntime(template.runtimeId, `resource template '${template.name}'`);
  }
}

export function parseAaiDescriptor(raw: unknown): AaiDescriptor {
  const result = AaiDescriptorSchema.safeParse(raw);
  if (!result.success) {
    throw new AaiError('DESCRIPTOR_ERROR', `Invalid AAI descriptor: ${result.error.message}`);
  }
  return result.data;
}
