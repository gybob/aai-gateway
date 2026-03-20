import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { parseAaiJson } from '../parsers/schema.js';
import type { RuntimeAppRecord } from '../types/aai-json.js';
import { deriveLocalId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';

import { evaluateDescriptorAvailability } from './checks.js';
import type { DesktopDiscovery, DiscoveryOptions } from './interface.js';

const execAsync = promisify(exec);

export class WindowsDiscovery implements DesktopDiscovery {
  async scan(_options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    const paths = await this.findDescriptorPaths();
    const entries: RuntimeAppRecord[] = [];

    for (const aaiJsonPath of paths) {
      try {
        const raw = await readFile(aaiJsonPath, 'utf-8');
        const descriptor = parseAaiJson(JSON.parse(raw));
        const availability = await evaluateDescriptorAvailability(descriptor);
        if (!availability.available) {
          continue;
        }
        entries.push({
          localId: deriveLocalId(`desktop:${aaiJsonPath}`, 'desktop'),
          descriptor,
          source: 'desktop',
          location: availability.location ?? dirname(aaiJsonPath),
        });
      } catch (err) {
        logger.warn({ path: aaiJsonPath, err }, 'Failed to parse Windows descriptor');
      }
    }

    return entries;
  }

  private async findDescriptorPaths(): Promise<string[]> {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';

    try {
      const { stdout } = await execAsync(
        `powershell -Command "Get-ChildItem -Path '${programFiles}','${programFilesX86}','${localAppData}' -Filter aai.json -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName"`
      );
      return stdout
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean);
    } catch (err) {
      logger.warn({ err }, 'Failed to scan Windows descriptors');
      return [];
    }
  }
}
