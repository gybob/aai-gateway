import { mkdirSync, existsSync, renameSync, statSync } from 'fs';
import { join } from 'path';

import pino from 'pino';

import { getAaiHomeDir, loadAaiConfig } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  appId?: string;
  tool?: string;
  platform?: string;
  duration?: number;
  [key: string]: unknown;
}

const config = loadAaiConfig();
const logLevel = (process.env.AAI_LOG_LEVEL as LogLevel) || config.logLevel || 'info';

// MCP requires stdout to be reserved for JSON-RPC messages only.
// Logs must go to a file to avoid any interference with MCP protocol.
const logDir = join(getAaiHomeDir(), 'logs');
const activeLogFile = join(logDir, 'gateway.log');

// Ensure log directory exists
try {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
} catch {
  // Ignore errors if we can't create log dir
}

function createLoggerDestination(): pino.DestinationStream {
  try {
    rotateDailyLogIfNeeded();
    return pino.destination({ dest: activeLogFile, sync: true });
  } catch {
    return pino.destination(2);
  }
}

export const logger = pino({
  level: logLevel,
  messageKey: 'message',
  timestamp: () => `,"time":"${formatLocalTimestamp()}"`,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: 'aai-gateway',
  },
}, createLoggerDestination());

export function createChildLogger(context: LogContext): pino.Logger {
  return logger.child(context);
}

export function logToolCall(
  appId: string,
  tool: string,
  platform: string,
  duration: number,
  success: boolean,
  error?: string
): void {
  const logFn = success ? logger.info.bind(logger) : logger.error.bind(logger);
  logFn(
    {
      appId,
      tool,
      platform,
      duration,
      success,
      error,
    },
    success ? 'Tool executed successfully' : 'Tool execution failed'
  );
}

export function logAppDiscovery(appId: string, path: string): void {
  logger.info({ appId, path }, 'Application discovered');
}

export function logConfigLoad(path: string, success: boolean, error?: string): void {
  if (success) {
    logger.info({ path }, 'Configuration loaded');
  } else {
    logger.error({ path, error }, 'Failed to load configuration');
  }
}

function getCurrentDateStamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rotateDailyLogIfNeeded(today = new Date()): void {
  if (!existsSync(activeLogFile)) {
    return;
  }

  const stat = statSync(activeLogFile);
  const lastModifiedDay = getCurrentDateStamp(stat.mtime);
  const currentDay = getCurrentDateStamp(today);
  if (lastModifiedDay === currentDay) {
    return;
  }

  const archivePath = getArchivePath(lastModifiedDay);
  renameSync(activeLogFile, archivePath);
}

function getArchivePath(dateStamp: string): string {
  const basePath = join(logDir, `gateway-${dateStamp}.log`);
  if (!existsSync(basePath)) {
    return basePath;
  }

  let suffix = 1;
  while (true) {
    const candidate = join(logDir, `gateway-${dateStamp}-${suffix}.log`);
    if (!existsSync(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function formatLocalTimestamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetMins = String(absOffset % 60).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${offsetHours}:${offsetMins}`;
}
