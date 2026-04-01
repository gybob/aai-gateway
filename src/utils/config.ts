import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { LogLevel } from './logger.js';

export interface AaiConfig {
  logLevel?: LogLevel;
  toolApproval?: boolean;
}

export function getAaiHomeDir(): string {
  return process.env.AAI_HOME || join(homedir(), '.aai');
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
      toolApproval: false,
    };
    ensureAaiHomeDir(homeDir);
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AaiConfig>;

    const hasLogLevel = 'logLevel' in parsed && parsed.logLevel !== undefined;
    const hasToolApproval = 'toolApproval' in parsed && parsed.toolApproval !== undefined;

    const updated = { ...parsed };
    let needsWrite = false;

    if (!hasLogLevel) {
      updated.logLevel = 'info';
      needsWrite = true;
    }

    if (!hasToolApproval) {
      updated.toolApproval = false;
      needsWrite = true;
    }

    if (needsWrite) {
      writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
    }

    return {
      logLevel: normalizeLogLevel(parsed.logLevel),
      toolApproval: parsed.toolApproval ?? false,
    };
  } catch {
    return {};
  }
}

function ensureAaiHomeDir(homeDir: string): void {
  if (!existsSync(homeDir)) {
    mkdirSync(homeDir, { recursive: true });
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
