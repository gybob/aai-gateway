import type { ExecutorConfig, ExecutorDetail } from '../types/index.js';
import type { Executor } from './interface.js';
import { McpExecutor } from './mcp.js';
import { SkillExecutor } from './skill.js';
import { AcpExecutor } from './acp.js';
import { CliExecutor } from './cli.js';
import { logger } from '../utils/logger.js';

/**
 * Executor Registry
 *
 * Central registry for all executor implementations.
 * Allows registration and retrieval of executors by protocol name.
 */
export class ExecutorRegistry {
  private executors = new Map<string, Executor<ExecutorConfig, ExecutorDetail>>();

  constructor() {
    // Register built-in executors
    this.registerMcp();
    this.registerSkill();
    this.registerAcp();
    this.registerCli();
  }

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
  ): Promise<unknown> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    const result = await executor.execute(localId, config, operation, args);
    return result.data;
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

  /**
   * Register built-in MCP executor
   */
  private registerMcp(): void {
    const executor = new McpExecutor();
    // @ts-expect-error - Intentional type conversion for executor registration
    this.register('mcp', executor as Executor<ExecutorConfig, ExecutorDetail>);
  }

  /**
   * Register built-in Skill executor
   */
  private registerSkill(): void {
    const executor = new SkillExecutor();
    // @ts-expect-error - Intentional type conversion for executor registration
    this.register('skill', executor as Executor<ExecutorConfig, ExecutorDetail>);
  }

  /**
   * Register built-in ACP executor
   */
  private registerAcp(): void {
    const executor = new AcpExecutor();
    // @ts-expect-error - Intentional type conversion for executor registration
    this.register('acp-agent', executor as Executor<ExecutorConfig, ExecutorDetail>);
  }

  /**
   * Register built-in CLI executor
   */
  private registerCli(): void {
    const executor = new CliExecutor();
    // @ts-expect-error - Intentional type conversion for executor registration
    this.register('cli', executor as Executor<ExecutorConfig, ExecutorDetail>);
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

/**
 * Reset the global executor registry (for testing)
 */
export function resetExecutorRegistry(): void {
  globalRegistry = undefined;
}
