/**
 * Central type exports for AAI Gateway
 *
 * This module consolidates all type definitions into a single entry point
 * for easier imports and better module organization.
 */

// AAI descriptor types
export type {
  LanguageTag,
  InternationalizedName,
  CommandConfig,
  McpStdioConfig,
  McpRemoteConfig,
  McpConfig,
  SkillPathConfig,
  SkillUrlConfig,
  SkillConfig,
  AcpAgentConfig,
  CliConfig,
  McpAccess,
  SkillAccess,
  AcpAgentAccess,
  CliAccess,
  Access,
  Exposure,
  AaiJson,
  RuntimeAppRecord,
  DetailedCapability,
} from './aai-json.js';

// Executor types
export type {
  ExecutorConfig,
  ExecutorDetail,
  ExecutionResult,
  McpExecutorConfig,
  McpExecutorDetail,
  SkillExecutorConfig,
  SkillExecutorDetail,
  AcpExecutorConfig,
  AcpExecutorDetail,
  CliExecutorConfig,
  CliExecutorDetail,
} from './executor.js';

// Discovery types
export type {
  DiscoveryOptions,
  DiscoverySource,
  DiscoveryCacheEntry,
} from './discovery.js';

// Storage types
export type {
  RegistryItem,
  Registry,
  CacheEntry,
} from './storage.js';

// CLI types
export type {
  Command,
  CommandOptions,
  ArgumentDef,
  ParsedArguments,
} from './cli.js';

// Error types (re-export)
export type {
  AaiErrorCode,
  ConsentRequiredData,
} from '../errors/errors.js';

// Utility functions from aai-json
export {
  getLocalizedName,
  isMcpAccess,
  isSkillAccess,
  isAcpAgentAccess,
  isCliAccess,
  isSkillPathConfig,
  isMcpStdioConfig,
} from './aai-json.js';
