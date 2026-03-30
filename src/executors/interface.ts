import type { ExecutionResult } from '../types/index.js';
import type { AppCapabilities } from '../types/capabilities.js';

/**
 * Unified Executor Interface
 *
 * All executor implementations must implement this interface.
 * It provides a consistent way to manage connections, discover capabilities,
 * and execute operations across different protocol families.
 */
export interface Executor {
  /** Protocol identifier (e.g., 'mcp', 'skill', 'acp-agent', 'cli') */
  readonly protocol: string;

  /**
   * Connect to the target system
   * @param appId - Unique identifier for this connection
   * @param config - Executor-specific configuration
   */
  connect(appId: string, config: unknown): Promise<void>;

  /**
   * Disconnect from the target system
   * @param appId - Unique identifier for the connection to close
   */
  disconnect(appId: string): Promise<void>;

  /**
   * Load app-level capabilities (tool list with full schemas)
   * @param appId - Unique identifier for this app
   * @param config - Executor-specific configuration
   * @returns App capabilities with tool schemas
   */
  loadAppCapabilities(appId: string, config: unknown): Promise<AppCapabilities>;

  /**
   * Execute an operation on the target system
   * @param appId - Unique identifier for the connection
   * @param config - Executor-specific configuration
   * @param operation - Operation name (e.g., tool name, command name)
   * @param args - Operation arguments
   * @returns Execution result
   */
  execute(
    appId: string,
    config: unknown,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult>;

  /**
   * Check if the executor connection is healthy
   * @param appId - Unique identifier for the connection
   * @returns true if healthy, false otherwise
   */
  health(appId: string): Promise<boolean>;
}
