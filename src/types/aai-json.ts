export type LanguageTag = string;

export type InternationalizedName = {
  default: string;
} & Record<LanguageTag, string>;

export interface CommandConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpStdioConfig extends CommandConfig {
  transport: 'stdio';
  timeout?: number;
}

export interface McpRemoteConfig {
  transport: 'streamable-http' | 'sse';
  url: string;
  timeout?: number;
}

export type McpConfig = McpStdioConfig | McpRemoteConfig;

export interface SkillPathConfig {
  path: string;
  url?: never;
}

export interface SkillUrlConfig {
  url: string;
  path?: never;
}

export type SkillConfig = SkillPathConfig | SkillUrlConfig;

export interface AcpAgentConfig extends CommandConfig {}

export interface CliConfig extends CommandConfig {}

export interface McpAccess {
  protocol: 'mcp';
  config: McpConfig;
}

export interface SkillAccess {
  protocol: 'skill';
  config: SkillConfig;
}

export interface AcpAgentAccess {
  protocol: 'acp-agent';
  config: AcpAgentConfig;
}

export interface CliAccess {
  protocol: 'cli';
  config: CliConfig;
}

export type Access = McpAccess | SkillAccess | AcpAgentAccess | CliAccess;

export interface Exposure {
  keywords: string[];
  summary: string;
}

export interface CommandDiscoveryCheck {
  kind: 'command';
  command: string;
}

export interface FileDiscoveryCheck {
  kind: 'file';
  path: string;
}

export interface PathDiscoveryCheck {
  kind: 'path';
  path: string;
}

export type DiscoveryCheck =
  | CommandDiscoveryCheck
  | FileDiscoveryCheck
  | PathDiscoveryCheck;

export interface DiscoveryRule {
  checks: DiscoveryCheck[];
}

export interface AaiJson {
  schemaVersion: '2.0';
  version: string;
  app: {
    name: InternationalizedName;
    iconUrl?: string;
  };
  discovery?: DiscoveryRule;
  access: Access;
  exposure: Exposure;
}

export interface RuntimeAppRecord {
  localId: string;
  descriptor: AaiJson;
  source: 'desktop' | 'web' | 'mcp-import' | 'skill-import' | 'acp-agent' | 'cli';
  location?: string;
}

export interface DetailedCapability {
  title: string;
  body: string;
}

export function getLocalizedName(name: InternationalizedName, locale: LanguageTag): string {
  if (name[locale]) {
    return name[locale];
  }

  const family = locale.split('-')[0];
  const fallback = Object.keys(name).find((key) => key !== 'default' && key.startsWith(family));
  if (fallback && name[fallback]) {
    return name[fallback];
  }

  return name.default;
}

export function isMcpAccess(access: Access): access is McpAccess {
  return access.protocol === 'mcp';
}

export function isSkillAccess(access: Access): access is SkillAccess {
  return access.protocol === 'skill';
}

export function isAcpAgentAccess(access: Access): access is AcpAgentAccess {
  return access.protocol === 'acp-agent';
}

export function isCliAccess(access: Access): access is CliAccess {
  return access.protocol === 'cli';
}

export function isSkillPathConfig(config: SkillConfig): config is SkillPathConfig {
  return 'path' in config;
}

export function isMcpStdioConfig(config: McpConfig): config is McpStdioConfig {
  return config.transport === 'stdio';
}
