import type {
  ExecutionResult,
  ExecutorConfig,
  ExecutorDetail,
} from '../types/index.js';
import type { Executor } from './interface.js';
import { logger } from '../utils/logger.js';

/**
 * Executor Registry
 *
 * Central registry for all executor implementations.
 * Allows registration and retrieval of executors by protocol name.
 */
export class ExecutorRegistry {
  private executors = new Map<string, Executor<ExecutorConfig, ExecutorDetail>>();

  /**
   * Register an executor for a protocol
   * @param protocol - Protocol identifier (e.g., 'mcp', 'skill')
   * @param executor - Executor implementation
   */
  register<TConfig extends ExecutorConfig, TDetail extends ExecutorDetail>(
    protocol: string,
    executor: Executor<TConfig, TDetail>
  ): void {
    if (this.executors.has(protocol)) {
      logger.warn({ protocol }, 'Overwriting existing executor');
    }
    this.executors.set(protocol, executor);
  }

  /**
   * Get an executor by protocol name
   * @param protocol - Protocol identifier
   * @returns Executor instance or undefined if not found
   */
  get(protocol: string): Executor<ExecutorConfig, ExecutorDetail> | undefined {
    return this.executors.get(protocol);
  }

  /**
   * Check if an executor is registered for a protocol
   * @param protocol - Protocol identifier
   * @returns true if registered, false otherwise
   */
  has(protocol: string): boolean {
    return this.executors.has(protocol);
  }

  /**
   * Execute an operation using the appropriate executor
   * @param protocol - Protocol identifier
   * @param localId - Unique identifier for the connection
   * @param config - Executor-specific configuration
   * @param operation - Operation name
   * @param args - Operation arguments
   * @returns Execution result
   */
  async execute(
    protocol: string,
    localId: string,
    config: ExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.execute(localId, config, operation, args);
  }

  /**
   * Connect using the appropriate executor
   * @param protocol - Protocol identifier
   * @param localId - Unique identifier for the connection
   * @param config - Executor-specific configuration
   */
  async connect(
    protocol: string,
    localId: string,
    config: ExecutorConfig
  ): Promise<void> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.connect(localId, config);
  }

  /**
   * Disconnect using the appropriate executor
   * @param protocol - Protocol identifier
   * @param localId - Unique identifier for the connection
   */
  async disconnect(protocol: string, localId: string): Promise<void> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.disconnect(localId);
  }

  /**
   * Get detailed capabilities using the appropriate executor
   * @param protocol - Protocol identifier
   * @param config - Executor-specific configuration
   * @returns Detailed capabilities
   */
  async loadDetail(
    protocol: string,
    config: ExecutorConfig
  ): Promise<ExecutorDetail> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.loadDetail(config);
  }

  /**
   * Check health using the appropriate executor
   * @param protocol - Protocol identifier
   * @param localId - Unique identifier for the connection
   * @returns true if healthy, false otherwise
   */
  async health(protocol: string, localId: string): Promise<boolean> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.health(localId);
  }
}

// Global singleton
let globalRegistry: ExecutorRegistry | undefined;

/**
 * Get the global executor registry
 * @returns Global registry instance
 */
export function getExecutorRegistry(): ExecutorRegistry {
  if (!globalRegistry) {
    globalRegistry = new ExecutorRegistry();
  }
  return globalRegistry;
}
