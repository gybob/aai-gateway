import { ArgumentParser } from '../parser.js';
import type { Command } from '../../types/index.js';
import { ServeCommand } from './serve.js';
import { ScanCommand } from './scan.js';

/**
 * Command registry
 *
 * Central registry for all CLI commands.
 */
class CommandRegistry {
  private commands = new Map<string, Command>();

  /**
   * Register a command
   * @param command - Command to register
   */
  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  /**
   * Get a command by name
   * @param name - Command name
   * @returns Command or undefined
   */
  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /**
   * Check if a command exists
   * @param name - Command name
   * @returns true if command exists
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Get all registered commands
   * @returns Array of commands
   */
  list(): Command[] {
    return Array.from(this.commands.values());
  }
}

// Global registry instance
const registry = new CommandRegistry();

/**
 * Register all commands
 * @param parser - Argument parser to register argument definitions with
 * @returns Command registry
 */
export function registerCommands(parser: ArgumentParser): CommandRegistry {
  // Register all commands
  registry.register(new ServeCommand());
  registry.register(new ScanCommand());

  // Define common arguments
  parser.define({
    name: 'dev',
    type: 'flag',
    description: 'Enable development mode',
  });

  return registry;
}

/**
 * Get the global command registry
 * @returns Command registry
 */
export function getCommandRegistry(): CommandRegistry {
  return registry;
}

/**
 * Register a command (used by command modules)
 * @param command - Command to register
 */
export function registerCommand(command: Command): void {
  registry.register(command);
}
