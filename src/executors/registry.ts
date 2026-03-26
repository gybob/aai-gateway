import type { ExecutorConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

import { AcpExecutor } from './acp.js';
import { CliExecutor } from './cli.js';
import type { Executor } from './interface.js';
import { McpExecutor } from './mcp.js';
import { SkillExecutor } from './skill.js';


/**
 * Executor Registry
 *
 * Central registry for all executor implementations.
 * Allows registration and retrieval of executors by protocol name.
 */
export class ExecutorRegistry {
  private executors = new Map<string, Executor>();

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
  register(
    protocol: string,
    executor: Executor
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
  get(protocol: string): Executor | undefined {
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
   * @param appId - Unique identifier for the connection
   * @param config - Executor-specific configuration
   * @param operation - Operation name
   * @param args - Operation arguments
   * @returns Execution result
   */
  async execute(
    protocol: string,
    appId: string,
    config: ExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    const result = await executor.execute(appId, config, operation, args);
    return result.data;
  }

  /**
   * Connect using the appropriate executor
   * @param protocol - Protocol identifier
   * @param appId - Unique identifier for the connection
   * @param config - Executor-specific configuration
   */
  async connect(
    protocol: string,
    appId: string,
    config: ExecutorConfig
  ): Promise<void> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.connect(appId, config);
  }

  /**
   * Disconnect using the appropriate executor
   * @param protocol - Protocol identifier
   * @param appId - Unique identifier for the connection
   */
  async disconnect(protocol: string, appId: string): Promise<void> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.disconnect(appId);
  }

  /**
   * Check health using the appropriate executor
   * @param protocol - Protocol identifier
   * @param appId - Unique identifier for the connection
   * @returns true if healthy, false otherwise
   */
  async health(protocol: string, appId: string): Promise<boolean> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.health(appId);
  }

  /**
   * Register built-in MCP executor
   */
  private registerMcp(): void {
    const executor = new McpExecutor();
    this.register('mcp', executor);
  }

  /**
   * Register built-in Skill executor
   */
  private registerSkill(): void {
    const executor = new SkillExecutor();
    this.register('skill', executor);
  }

  /**
   * Register built-in ACP executor
   */
  private registerAcp(): void {
    const executor = new AcpExecutor();
    this.register('acp-agent', executor);
  }

  /**
   * Register built-in CLI executor
   */
  private registerCli(): void {
    const executor = new CliExecutor();
    this.register('cli', executor);
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
