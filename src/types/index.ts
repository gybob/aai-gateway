/**
 * Central type exports for AAI Gateway
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
  McpAccess,
  SkillAccess,
  AcpAgentAccess,
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
} from './executor.js';

// Storage types
export type {
  RegistryItem,
  Registry,
  CacheEntry,
} from './storage.js';

// Error types (re-export)
export type {
  AaiErrorCode,
} from '../errors/errors.js';

// Utility functions from aai-json
export {
  getLocalizedName,
  isMcpAccess,
  isSkillAccess,
  isAcpAgentAccess,
  isSkillPathConfig,
  isMcpStdioConfig,
} from './aai-json.js';
