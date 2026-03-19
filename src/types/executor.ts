import type { McpConfig } from './aai-json.js';

/**
 * Generic executor configuration interface
 * Protocol-specific configs extend this base
 */
export interface ExecutorConfig {
  [key: string]: unknown;
}

/**
 * Base command configuration shared by multiple protocols
 */
export interface BaseCommandConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Generic executor detail interface
 * Protocol-specific details extend this base
 */
export interface ExecutorDetail {
  [key: string]: unknown;
}

/**
 * Generic detail base class
 * Protocol-specific detail types should extend this
 */
export interface BaseDetail {
  [key: string]: unknown;
}

/**
 * Result of an executor operation
 */
export interface ExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * MCP-specific configuration
 */
export type McpExecutorConfig = McpConfig;

/**
 * MCP executor detail with tools list
 */
export interface McpExecutorDetail {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: unknown;
  }>;
}

/**
 * Skill executor configuration
 */
export interface SkillExecutorConfig extends ExecutorConfig {
  path?: string;
  url?: string;
}

/**
 * Skill executor detail
 */
export interface SkillExecutorDetail {
  manifest?: {
    name: string;
    description?: string;
    version?: string;
  };
  capabilities?: unknown;
}

/**
 * ACP agent executor configuration
 */
export interface AcpExecutorConfig extends BaseCommandConfig {}

/**
 * ACP agent executor detail
 */
export interface AcpExecutorDetail {
  sessionId?: string;
  capabilities?: unknown;
}

/**
 * CLI executor configuration
 */
export interface CliExecutorConfig extends BaseCommandConfig {}

/**
 * CLI executor detail
 */
export interface CliExecutorDetail {
  availableCommands?: string[];
}
