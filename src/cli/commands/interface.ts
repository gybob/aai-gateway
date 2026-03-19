import type { Command, CommandOptions } from '../../types/index.js';

/**
 * Base class for CLI commands
 *
 * Extending this class provides a convenient way to implement commands
 * while ensuring type safety and consistency.
 */
export abstract class BaseCommand implements Command {
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Parse command arguments
   * @param args - Arguments to parse
   * @returns Parsed command options
   */
  abstract parse(args: string[]): CommandOptions;

  /**
   * Execute the command
   * @param options - Parsed command options
   */
  abstract execute(options: CommandOptions): Promise<void>;

  /**
   * Validate command options
   * @param options - Options to validate
   * @throws Error if validation fails
   */
  protected validate(options: CommandOptions): void {
    // Base validation - can be extended by subclasses
    if (typeof options.dev !== 'boolean') {
      throw new Error('options.dev must be a boolean');
    }
  }
}
