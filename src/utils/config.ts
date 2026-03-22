import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { LogLevel } from './logger.js';

export interface AaiConfig {
  logLevel?: LogLevel;
  server?: {
    host?: string;
    port?: number;
    path?: string;
  };
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
      server: normalizeServerConfig(parsed.server),
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

function normalizeServerConfig(
  value: unknown
): AaiConfig['server'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const host = typeof record.host === 'string' && record.host.length > 0 ? record.host : undefined;
  const path =
    typeof record.path === 'string' && record.path.length > 0 ? record.path : undefined;
  const port = normalizePort(record.port);

  if (host === undefined && path === undefined && port === undefined) {
    return undefined;
  }

  return { host, path, port };
}

function normalizePort(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }

  if (value < 1 || value > 65535) {
    return undefined;
  }

  return value;
}
