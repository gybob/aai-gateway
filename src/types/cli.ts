/**
 * Command interface
 * All CLI commands must implement this interface
 */
export interface Command {
  /** Unique command name */
  name: string;

  /** Command description for help text */
  description: string;

  /** Parse command arguments into options */
  parse(args: string[]): CommandOptions;

  /** Execute the command with parsed options */
  execute(options: CommandOptions): Promise<void>;
}

/**
 * Base command options
 * All commands extend this with their specific options
 */
export interface CommandOptions {
  dev: boolean;
  [key: string]: unknown;
}

/**
 * Argument definition for the parser
 */
export interface ArgumentDef {
  /** Argument name (without -- prefix) */
  name: string;

  /** Argument type */
  type: 'flag' | 'string' | 'array' | 'object';

  /** Whether this argument is required */
  required?: boolean;

  /** Default value if not provided */
  default?: unknown;

  /** Description for help text */
  description?: string;

  /** Short flag (e.g., 'h' for -h) */
  short?: string;
}

/**
 * Parsed argument result
 */
export interface ParsedArguments {
  /** Parsed arguments as key-value pairs */
  [key: string]: unknown;

  /** Positional arguments */
  positional: string[];
}
