import type {
  ExecutionResult,
  ExecutorConfig,
  ExecutorDetail,
  McpConfig,
  SkillConfig,
  AcpAgentConfig,
  CliConfig,
} from '../types/index.js';

/**
 * Unified Executor Interface
 *
 * All executor implementations must implement this interface.
 * It provides a consistent way to manage connections, discover capabilities,
 * and execute operations across different protocol families.
 *
 * @template TConfig - Configuration type for this executor
 * @template TDetail - Detail/capability type for this executor
 */
export interface Executor<TConfig extends ExecutorConfig, TDetail extends ExecutorDetail> {
  /** Protocol identifier (e.g., 'mcp', 'skill', 'acp-agent', 'cli') */
  readonly protocol: string;

  /**
   * Connect to the target system
   * @param localId - Unique identifier for this connection
   * @param config - Executor-specific configuration
   */
  connect(localId: string, config: TConfig): Promise<void>;

  /**
   * Disconnect from the target system
   * @param localId - Unique identifier for the connection to close
   */
  disconnect(localId: string): Promise<void>;

  /**
   * Load detailed capability information from the target
   * @param config - Executor-specific configuration
   * @returns Detailed capabilities/capabilities metadata
   */
  loadDetail(config: TConfig): Promise<TDetail>;

  /**
   * Execute an operation on the target system
   * @param localId - Unique identifier for the connection
   * @param config - Executor-specific configuration
   * @param operation - Operation name (e.g., tool name, command name)
   * @param args - Operation arguments
   * @returns Execution result
   */
  execute(
    localId: string,
    config: TConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult>;

  /**
   * Check if the executor connection is healthy
   * @param localId - Unique identifier for the connection
   * @returns true if healthy, false otherwise
   */
  health(localId: string): Promise<boolean>;
}

// Protocol-specific type aliases for convenience
export type McpExecutor = Executor<McpConfig & ExecutorConfig, ExecutorDetail>;
export type SkillExecutor = Executor<SkillConfig & ExecutorConfig, ExecutorDetail>;
export type AcpExecutor = Executor<AcpAgentConfig & ExecutorConfig, ExecutorDetail>;
export type CliExecutor = Executor<CliConfig & ExecutorConfig, ExecutorDetail>;
