import { readdir, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import type { AaiJson } from '../types/aai-json.js';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';
import { logger } from '../utils/logger.js';
import { getCliExecutor } from '../executors/cli.js';

export interface DiscoveredCliTool {
  appId: string;
  name: string;
  description: string;
  descriptor: AaiJson;
  command: string;
  commandPath: string;
}

const CLI_PATTERN = /^cli-anything-(.+)$/;

function getPathSeparator(): string {
  return process.platform === 'win32' ? ';' : ':';
}

export async function scanCliTools(): Promise<DiscoveredCliTool[]> {
  const discovered: DiscoveredCliTool[] = [];
  const pathEnv = process.env.PATH;

  if (!pathEnv) {
    logger.warn('PATH environment variable not set');
    return discovered;
  }

  const pathDirs = pathEnv.split(getPathSeparator()).filter(Boolean);
  const locale = getSystemLocale();
  const executor = getCliExecutor();

  const foundCommands = await scanPathForCliCommands(pathDirs);

  for (const { command, path: commandPath } of foundCommands) {
    try {
      const descriptor = await executor.getDescriptor(command);
      const localizedName = getLocalizedName(
        descriptor.app.name,
        locale,
        descriptor.app.defaultLang
      );

      discovered.push({
        appId: descriptor.app.id,
        name: localizedName,
        description: descriptor.app.description,
        descriptor,
        command,
        commandPath,
      });

      logger.info({ appId: descriptor.app.id, command }, 'CLI tool discovered');
    } catch (err) {
      logger.debug({ command, err }, 'Failed to get CLI tool descriptor');
    }
  }

  return discovered;
}

async function scanPathForCliCommands(
  pathDirs: string[]
): Promise<Array<{ command: string; path: string }>> {
  const found: Array<{ command: string; path: string }> = [];
  const isWindows = process.platform === 'win32';

  await Promise.all(
    pathDirs.map(async (dir) => {
      try {
        await access(dir, constants.R_OK);
        const files = await readdir(dir);

        for (const file of files) {
          const commandName = isWindows && file.endsWith('.exe') ? file.slice(0, -4) : file;

          if (CLI_PATTERN.test(commandName)) {
            found.push({
              command: commandName,
              path: join(dir, file),
            });
          }
        }
      } catch {
        // Directory doesn't exist or not readable, skip
      }
    })
  );

  return found;
}

export function lookupCliToolByAlias(
  tools: DiscoveredCliTool[],
  input: string
): DiscoveredCliTool | null {
  const normalizedInput = input.toLowerCase();

  for (const tool of tools) {
    // Check app ID
    if (tool.appId.toLowerCase() === normalizedInput) {
      return tool;
    }

    // Check command name
    if (tool.command.toLowerCase() === normalizedInput) {
      return tool;
    }

    // Check aliases
    if (tool.descriptor.app.aliases?.some((a) => a.toLowerCase() === normalizedInput)) {
      return tool;
    }

    // Check names
    for (const name of Object.values(tool.descriptor.app.name)) {
      if (name.toLowerCase() === normalizedInput) {
        return tool;
      }
    }
  }

  return null;
}
