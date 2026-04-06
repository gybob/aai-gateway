import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { LogLevel } from './logger.js';

export interface AaiConfig {
  logLevel?: LogLevel;
}

export function getAaiHomeDir(): string {
  return process.env.AAI_HOME || join(homedir(), '.aai-gateway');
}

export function getAaiConfigPath(): string {
  return join(getAaiHomeDir(), 'config.json');
}

export function loadAaiConfig(): AaiConfig {
  const configPath = getAaiConfigPath();
  const homeDir = getAaiHomeDir();

  if (!existsSync(configPath)) {
    const defaultConfig: AaiConfig = {
      logLevel: 'info',
    };
    ensureAaiHomeDir(homeDir);
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AaiConfig>;

    const hasLogLevel = 'logLevel' in parsed && parsed.logLevel !== undefined;

    if (!hasLogLevel) {
      const updated = { ...parsed, logLevel: 'info' };
      writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
    }

    return {
      logLevel: normalizeLogLevel(parsed.logLevel),
    };
  } catch {
    return {};
  }
}

function ensureAaiHomeDir(homeDir: string): void {
  if (!existsSync(homeDir)) {
    mkdirSync(homeDir, { recursive: true });
  }
  const envPath = join(homeDir, '.env');
  if (!existsSync(envPath)) {
    writeFileSync(envPath, '# Store sensitive values here (API keys, tokens, etc.)\n# Reference them in MCP configs with ${VAR_NAME} placeholders.\n', 'utf-8');
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
