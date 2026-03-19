export { AaiGatewayServer, createGatewayServer } from './mcp/server.js';
export { AaiError } from './errors/errors.js';
export type { AaiErrorCode, ConsentRequiredData } from './errors/errors.js';
export { logger } from './utils/logger.js';
export { parseAaiJson } from './parsers/schema.js';
export type { AaiJson, RuntimeAppRecord } from './types/aai-json.js';
export { createDesktopDiscovery } from './discovery/index.js';
export { fetchWebDescriptor } from './discovery/web.js';
export { createSecureStorage } from './storage/secure-storage/index.js';
export type { SecureStorage } from './storage/secure-storage/interface.js';
export { ConsentManager } from './consent/manager.js';
export { createConsentDialog } from './consent/dialog/index.js';

// Phase 1 exports
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
  DiscoveryOptions,
  DiscoverySource,
  DiscoveryCacheEntry,
  RegistryItem,
  Registry,
  CacheEntry,
  Command,
  CommandOptions,
  ArgumentDef,
  ParsedArguments,
} from './types/index.js';

export { getExecutorRegistry, ExecutorRegistry } from './executors/registry.js';
export type { Executor } from './executors/interface.js';
export { FileRegistry } from './storage/registry.js';
export { SimpleCache } from './storage/cache.js';
