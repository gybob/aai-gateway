export type LanguageTag = string;
export type JsonObject = Record<string, unknown>;
export type JsonSchemaObject = Record<string, unknown>;

export interface AaiDescriptor {
  schemaVersion: '2.0';
  identity: Identity;
  provenance?: Provenance;
  discovery?: Discovery;
  disclosure?: ProgressiveDisclosure;
  runtimes: Runtime[];
  catalog: Catalog;
  hostInteraction?: HostInteraction;
  policy?: Policy;
  _meta?: JsonObject;
}

export interface Identity {
  id: string;
  name: Record<LanguageTag, string>;
  defaultLang: LanguageTag;
  title?: string;
  description?: string;
  version: string;
  websiteUrl?: string;
  icons?: Icon[];
  aliases?: string[];
  categories?: string[];
  tags?: string[];
}

export interface Provenance {
  publisher?: Publisher;
  sources?: SourceRecord[];
  integrity?: Integrity;
}

export interface Publisher {
  namespace: string;
  name?: string;
  verified?: boolean;
  websiteUrl?: string;
  contactEmail?: string;
}

export interface SourceRecord {
  kind: 'server-card' | 'registry' | 'manual' | 'generated' | 'local-scan';
  url?: string;
  filePath?: string;
  fetchedAt?: string;
  digestSha256?: string;
  note?: string;
}

export interface Integrity {
  signed?: boolean;
  signatureUrl?: string;
  digestSha256?: string;
}

export interface Discovery {
  mode: 'static' | 'live' | 'hybrid';
  serverCard?: {
    url: string;
    prefer?: boolean;
  };
  registry?: {
    manifestUrl?: string;
    apiUrl?: string;
    namespaceVerified?: boolean;
  };
  refresh?: {
    strategy?: 'lazy' | 'eager';
    ttlSeconds?: number;
    honorListChanged?: boolean;
    preloadCatalog?: boolean;
  };
}

export interface ProgressiveDisclosure {
  mode: 'required' | 'preferred' | 'disabled';
  modelSurface?: 'integration-only' | 'catalog-summary' | 'full-catalog';
  detailLoad?: 'on-demand' | 'prefetch-selected' | 'prefetch-all';
  executionSurface?: 'universal-exec' | 'direct-primitive' | 'either';
  maxVisibleItems?: number;
}

export interface Runtime {
  id: string;
  kind: 'rpc' | 'http-api' | 'ipc';
  label?: string;
  priority?: number;
  default?: boolean;
  protocol: 'mcp' | 'acp' | 'jsonrpc' | 'rest' | 'graphql' | 'native';
  transport:
    | StdioTransport
    | StreamableHttpTransport
    | SseTransport
    | HttpTransport
    | AppleEventsTransport
    | DbusTransport
    | ComTransport
    | UnixSocketTransport
    | NamedPipeTransport;
  auth?: AuthProfile;
  session?: SessionPolicy;
  capabilities?: RuntimeCapabilities;
  _meta?: JsonObject;
}

export interface StdioTransport {
  type: 'stdio';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface StreamableHttpTransport {
  type: 'streamable-http';
  url: string;
  variables?: InputField[];
  headers?: HeaderField[];
}

export interface SseTransport {
  type: 'sse';
  url: string;
  variables?: InputField[];
  headers?: HeaderField[];
}

export interface HttpTransport {
  type: 'http';
  baseUrl: string;
  variables?: InputField[];
  headers?: HeaderField[];
}

export interface AppleEventsTransport {
  type: 'apple-events';
  bundleId: string;
}

export interface DbusTransport {
  type: 'dbus';
  bus?: 'session' | 'system';
  service: string;
  objectPath: string;
  interface: string;
}

export interface ComTransport {
  type: 'com';
  progId: string;
}

export interface UnixSocketTransport {
  type: 'unix-socket';
  path: string;
}

export interface NamedPipeTransport {
  type: 'named-pipe';
  path: string;
}

export interface InputField {
  name: string;
  title?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string | number | boolean;
  choices?: Array<string | number | boolean>;
}

export interface HeaderField extends InputField {}

export interface AuthProfile {
  type:
    | 'none'
    | 'env'
    | 'header'
    | 'query'
    | 'oauth2'
    | 'oauth2-protected-resource'
    | 'basic'
    | 'cookie'
    | 'custom';
  instructions?: string;
  inputs?: InputField[];
  oauth2?: {
    issuerUrl?: string;
    authorizationServerUrl?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    scopes?: string[];
    audience?: string;
    pkce?: boolean;
  };
}

export interface SessionPolicy {
  mode?: 'stateless' | 'sticky';
  resumable?: boolean;
  idleTtlSeconds?: number;
  reuseProcess?: boolean;
}

export interface RuntimeCapabilities {
  logging?: boolean;
  completions?: boolean;
  prompts?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  tools?: { listChanged?: boolean };
  tasks?: {
    list?: boolean;
    cancel?: boolean;
    requests?: {
      toolsCall?: boolean;
      resourcesRead?: boolean;
      promptsGet?: boolean;
    };
  };
  serverRequests?: {
    roots?: boolean;
    sampling?: boolean;
    elicitation?: { form?: boolean; url?: boolean };
    ping?: boolean;
  };
}

export interface Catalog {
  tools: CatalogSection<ToolDef>;
  prompts?: CatalogSection<PromptDef>;
  resources?: CatalogSection<ResourceDef>;
  resourceTemplates?: CatalogSection<ResourceTemplateDef>;
}

export interface CatalogSection<T> {
  mode: 'none' | 'snapshot' | 'live' | 'hybrid';
  sourceRuntimeId?: string;
  listChanged?: boolean;
  subscribe?: boolean;
  summary?: PrimitiveSummary[];
  snapshot?: T[];
}

export interface PrimitiveSummary {
  ref: string;
  kind: 'tool' | 'prompt' | 'resource' | 'resource-template';
  name: string;
  title?: string;
  description?: string;
  runtimeId?: string;
  tags?: string[];
}

export interface ToolDef {
  ref?: string;
  name: string;
  title?: string;
  description?: string;
  icons?: Icon[];
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  annotations?: ToolAnnotations;
  execution?: {
    taskSupport?: 'forbidden' | 'optional' | 'required';
  };
  runtimeId?: string;
  binding?: ToolBinding;
  _meta?: JsonObject;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export type ToolBinding =
  | { type: 'mcp-tool'; toolName?: string }
  | { type: 'http'; path: string; method: string; headers?: Record<string, string> }
  | { type: 'graphql'; document: string; operationName?: string }
  | { type: 'ipc'; operation: string };

export interface PromptDef {
  ref?: string;
  name: string;
  title?: string;
  description?: string;
  icons?: Icon[];
  arguments?: PromptArgument[];
  runtimeId?: string;
  _meta?: JsonObject;
}

export interface PromptArgument {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
}

export interface ResourceDef {
  ref?: string;
  name: string;
  title?: string;
  uri: string;
  description?: string;
  mimeType?: string;
  icons?: Icon[];
  size?: number;
  annotations?: CommonAnnotations;
  runtimeId?: string;
  _meta?: JsonObject;
}

export interface ResourceTemplateDef {
  ref?: string;
  name: string;
  title?: string;
  uriTemplate: string;
  description?: string;
  mimeType?: string;
  icons?: Icon[];
  annotations?: CommonAnnotations;
  runtimeId?: string;
  _meta?: JsonObject;
}

export interface CommonAnnotations {
  audience?: Array<'user' | 'assistant'>;
  priority?: number;
  lastModified?: string;
}

export interface Icon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: 'light' | 'dark';
}

export interface HostInteraction {
  roots?: {
    enabled: boolean;
    mode?: 'none' | 'fixed' | 'user-selected' | 'workspace';
    listChanged?: boolean;
    snapshot?: RootDef[];
  };
  sampling?: {
    enabled: boolean;
    mode?: 'deny' | 'confirm' | 'allow';
    allowedModalities?: Array<'text' | 'image' | 'audio'>;
    humanApproval?: boolean;
  };
  elicitation?: {
    enabled: boolean;
    modes?: Array<'form' | 'url'>;
    humanApproval?: boolean;
  };
  logging?: {
    enabled: boolean;
    defaultLevel?: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
  };
  progress?: {
    enabled: boolean;
  };
  tasks?: {
    enabled: boolean;
    defaultTtlMs?: number;
  };
}

export interface RootDef {
  uri: string;
  name?: string;
  _meta?: JsonObject;
}

export interface Policy {
  consent?: {
    perCaller?: boolean;
    scope?: 'runtime' | 'primitive';
    requireFor?: string[];
  };
  audit?: {
    logRequests?: boolean;
    logResponses?: boolean;
    redactSecrets?: boolean;
  };
  cache?: {
    descriptorTtlSeconds?: number;
    catalogTtlSeconds?: number;
  };
  limits?: {
    requestTimeoutMs?: number;
    maxConcurrentRequests?: number;
    maxContentBytes?: number;
    maxImageBytes?: number;
    maxAudioBytes?: number;
  };
  trust?: {
    allowUnverifiedPublishers?: boolean;
    allowedOrigins?: string[];
    iconFetchPolicy?: 'same-origin-only' | 'allow-https' | 'data-uri-only';
  };
}

export interface ManagedIntegrationRecord {
  descriptor: AaiDescriptor;
  metadata: ManagedIntegrationMetadata;
}

export interface ManagedIntegrationMetadata {
  integrationId: string;
  importedAt: string;
  updatedAt: string;
  sourceType: 'mcp-config' | 'manual';
  sourceHash: string;
  converterVersion: string;
  notes?: string;
}

export interface ImportedMcpSource {
  kind: 'stdio' | 'streamable-http' | 'sse';
  name?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  sourcePath?: string;
  rawConfig?: JsonObject;
}

export interface ImportedPrimitiveCatalog {
  tools: ToolDef[];
  prompts: PromptDef[];
  resources: ResourceDef[];
  resourceTemplates: ResourceTemplateDef[];
  capabilities?: RuntimeCapabilities;
}

export interface ImportMcpOptions {
  integrationId?: string;
  displayName?: string;
  version?: string;
  dryRun?: boolean;
}

export function getIdentityText(
  values: Record<LanguageTag, string>,
  defaultLang: LanguageTag,
  preferredLang?: LanguageTag
): string {
  if (preferredLang && values[preferredLang]) {
    return values[preferredLang];
  }

  if (preferredLang) {
    const family = preferredLang.split('-')[0];
    const familyMatch = Object.entries(values).find(([lang]) => lang.split('-')[0] === family);
    if (familyMatch) {
      return familyMatch[1];
    }
  }

  return values[defaultLang] ?? Object.values(values)[0] ?? '';
}

export function getIntegrationDisplayName(
  descriptor: AaiDescriptor,
  preferredLang?: LanguageTag
): string {
  return descriptor.identity.title ??
    getIdentityText(descriptor.identity.name, descriptor.identity.defaultLang, preferredLang);
}

export function listAllPrimitiveSummaries(descriptor: AaiDescriptor): PrimitiveSummary[] {
  return [
    ...(descriptor.catalog.tools.summary ?? []),
    ...(descriptor.catalog.prompts?.summary ?? []),
    ...(descriptor.catalog.resources?.summary ?? []),
    ...(descriptor.catalog.resourceTemplates?.summary ?? []),
  ];
}

export function listAllPrimitiveRefs(descriptor: AaiDescriptor): string[] {
  return listAllPrimitiveSummaries(descriptor).map((item) => item.ref);
}
