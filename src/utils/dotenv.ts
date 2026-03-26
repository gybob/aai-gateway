import { homedir } from 'node:os';
import { join } from 'node:path';

import { readFile } from 'node:fs/promises';

export interface DotenvResult {
  env: Record<string, string>;
  missing: string[];
}

/**
 * Load environment variables from ~/.aai/.env file
 */
export async function loadDotenv(): Promise<DotenvResult> {
  const dotenvPath = join(homedir(), '.aai', '.env');

  try {
    const content = await readFile(dotenvPath, 'utf-8');
    const env: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key) {
        env[key] = value;
      }
    }

    return { env, missing: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { env: {}, missing: [] };
    }
    throw error;
  }
}

/**
 * Substitute ${VAR_NAME} placeholders in a string with values from env
 */
export function substituteEnvVars(str: string, env: Record<string, string>): string {
  return str.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    const value = env[varName];
    if (value === undefined) {
      throw new Error(
        `Environment variable \${${varName}} is not defined in ~/.aai/.env`
      );
    }
    return value;
  });
}

/**
 * Find all ${VAR_NAME} placeholders in a string
 */
function findEnvPlaceholders(str: string): string[] {
  const matches: string[] = [];
  const regex = /\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(str)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

/**
 * Check if a string value has missing environment variables
 */
function checkMissingVars(value: string, env: Record<string, string>): string[] {
  const placeholders = findEnvPlaceholders(value);
  return placeholders.filter((varName) => env[varName] === undefined);
}

/**
 * Substitute ${VAR_NAME} placeholders in a config object
 * Returns the substituted config and list of missing variables
 */
export function substituteConfigEnvVars(
  config: Record<string, unknown>,
  env: Record<string, string>
): { result: Record<string, unknown>; missing: string[] } {
  const missing: string[] = [];
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(config)) {
    const value = config[key];
    if (typeof value === 'string') {
      const missingInValue = checkMissingVars(value, env);
      missing.push(...missingInValue);
      // Don't substitute if there are missing vars - let the caller handle the error
      result[key] = missingInValue.length > 0 ? value : substituteEnvVars(value, env);
    } else if (Array.isArray(value)) {
      // Handle arrays
      const newArray: unknown[] = [];
      for (const item of value) {
        if (typeof item === 'string') {
          const missingInItem = checkMissingVars(item, env);
          missing.push(...missingInItem);
          newArray.push(missingInItem.length > 0 ? item : substituteEnvVars(item, env));
        } else if (typeof item === 'object' && item !== null) {
          // Recursively handle nested objects in arrays
          const { result: subResult, missing: subMissing } = substituteConfigEnvVars(
            item as Record<string, unknown>,
            env
          );
          missing.push(...subMissing);
          newArray.push(subResult);
        } else {
          newArray.push(item);
        }
      }
      result[key] = newArray;
    } else if (typeof value === 'object' && value !== null) {
      // Recursively handle nested objects
      const { result: subResult, missing: subMissing } = substituteConfigEnvVars(
        value as Record<string, unknown>,
        env
      );
      missing.push(...subMissing);
      result[key] = subResult;
    } else {
      result[key] = value;
    }
  }

  return { result, missing };
}
