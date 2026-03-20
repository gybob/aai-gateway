import { mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  appId?: string;
  tool?: string;
  platform?: string;
  duration?: number;
  [key: string]: unknown;
}

const logLevel = (process.env.AAI_LOG_LEVEL as LogLevel) || 'info';

// MCP requires stdout to be reserved for JSON-RPC messages only.
// Logs must go to a file to avoid any interference with MCP protocol.
const logDir = join(homedir(), '.aai', 'logs');
const logFile = join(logDir, 'gateway.log');

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
    return pino.destination({ dest: logFile, sync: true });
  } catch {
    return pino.destination(2);
  }
}

export const logger = pino({
  level: logLevel,
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
