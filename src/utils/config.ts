import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { LogLevel } from './logger.js';

export interface AaiConfig {
  logLevel?: LogLevel;
}

export function getAaiHomeDir(): string {
  return process.env.AAI_HOME || join(homedir(), '.aai');
}

export function getAaiConfigPath(): string {
  return join(getAaiHomeDir(), 'config.json');
}

export function loadAaiConfig(): AaiConfig {
  const configPath = getAaiConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      logLevel: normalizeLogLevel(parsed.logLevel),
    };
  } catch {
    return {};
  }
}

function normalizeLogLevel(value: unknown): LogLevel | undefined {
  switch (value) {
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    case 'fatal':
      return value;
    default:
      return undefined;
  }
}
