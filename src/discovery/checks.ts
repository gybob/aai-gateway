import { exec } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { AaiJson } from '../types/aai-json.js';

const execAsync = promisify(exec);

export interface DiscoveryCheckResult {
  available: boolean;
  location: string | null;
}

export async function evaluateDescriptorAvailability(
  descriptor: AaiJson
): Promise<DiscoveryCheckResult> {
  const checks = descriptor.discovery?.checks;
  if (!checks || checks.length === 0) {
    return { available: true, location: null };
  }

  let location: string | null = null;

  for (const check of checks) {
    switch (check.kind) {
      case 'command': {
        const commandPath = await resolveCommandPath(check.command);
        if (!commandPath) {
          return { available: false, location: null };
        }

        if (!location) {
          location = commandPath;
        }
        break;
      }
      case 'file': {
        const filePath = await resolveFilePath(check.path);
        if (!filePath) {
          return { available: false, location: null };
        }

        if (!location) {
          location = filePath;
        }
        break;
      }
      case 'path': {
        const pathLocation = await resolveDirectoryPath(check.path);
        if (!pathLocation) {
          return { available: false, location: null };
        }

        if (!location) {
          location = pathLocation;
        }
        break;
      }
    }
  }

  return { available: true, location };
}

async function resolveCommandPath(command: string): Promise<string | null> {
  try {
    const query = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
    const { stdout } = await execAsync(query);
    return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

async function resolveFilePath(path: string): Promise<string | null> {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function resolveDirectoryPath(path: string): Promise<string | null> {
  try {
    const pathStat = await stat(path);
    if (pathStat.isDirectory()) {
      await access(path);
      return path;
    }
    return null;
  } catch {
    return null;
  }
}
