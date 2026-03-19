import type { ArgumentDef, ParsedArguments } from '../types/index.js';

/**
 * Argument Parser
 *
 * A flexible command-line argument parser that supports flags, strings, arrays, and objects.
 */
export class ArgumentParser {
  private definitions: Map<string, ArgumentDef> = new Map();

  /**
   * Define an argument
   * @param def - Argument definition
   */
  define(def: ArgumentDef): void {
    this.definitions.set(def.name, def);
  }

  /**
   * Get all defined argument names
   * @returns Array of argument names
   */
  getDefinedNames(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * Parse command-line arguments
   * @param args - Arguments to parse (usually process.argv.slice(2))
   * @returns Parsed arguments
   */
  parse(args: string[]): ParsedArguments {
    const result: Record<string, unknown> = {};
    const positional: string[] = [];

    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      const next = args[i + 1];

      // Check for flags (--flag, -s)
      if (arg.startsWith('--') || (arg.startsWith('-') && arg.length > 1)) {
        const def = this.parseFlagName(arg);
        if (!def) {
          i++;
          continue;
        }

        switch (def.type) {
          case 'flag':
            result[def.name] = true;
            i++;
            break;

          case 'string':
            if (next && !next.startsWith('-')) {
              result[def.name] = next;
              i += 2;
            } else if (def.default !== undefined) {
              result[def.name] = def.default;
              i++;
            } else {
              throw new Error(`Missing value for argument: ${arg}`);
            }
            break;

          case 'array':
            if (!result[def.name]) {
              result[def.name] = [];
            }
            if (next && !next.startsWith('-')) {
              (result[def.name] as string[]).push(next);
              i += 2;
            } else {
              i++;
            }
            break;

          case 'object':
            if (next && !next.startsWith('-')) {
              const [key, value] = this.parseKeyValue(next, arg);
              if (!result[def.name]) {
                result[def.name] = {};
              }
              (result[def.name] as Record<string, string>)[key] = value;
              i += 2;
            } else {
              i++;
            }
            break;
        }
      } else {
        // Positional argument
        positional.push(arg);
        i++;
      }
    }

    // Apply defaults for missing arguments
    for (const [name, def] of this.definitions.entries()) {
      if (!(name in result) && def.default !== undefined) {
        result[name] = def.default;
      }

      // Check required arguments
      if (def.required && !(name in result) && def.type !== 'array') {
        throw new Error(`Required argument missing: --${name}`);
      }
    }

    return { ...result, positional };
  }

  /**
   * Parse flag name from argument string
   * @param arg - Argument string (--flag or -f)
   * @returns Argument definition or undefined
   */
  private parseFlagName(arg: string): ArgumentDef | undefined {
    const name = arg.startsWith('--') ? arg.slice(2) : arg.slice(1);

    // Try long name first
    let def = this.definitions.get(name);
    if (def) return def;

    // Try short name
    for (const d of this.definitions.values()) {
      if (d.short === name) {
        return d;
      }
    }

    return undefined;
  }

  /**
   * Parse key-value pair
   * @param value - Value to parse (KEY=VALUE)
   * @param flag - Flag name for error messages
   * @returns [key, value] tuple
   */
  private parseKeyValue(value: string, flag: string): [string, string] {
    const index = value.indexOf('=');
    if (index === -1) {
      throw new Error(`${flag} expects KEY=VALUE`);
    }
    return [value.slice(0, index), value.slice(index + 1)];
  }
}
