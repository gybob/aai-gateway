import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { parseAaiJson } from '../parsers/schema.js';
import type { RuntimeAppRecord } from '../types/aai-json.js';
import { deriveLocalId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';

import type { DesktopDiscovery, DiscoveryOptions } from './interface.js';

const execAsync = promisify(exec);

export class LinuxDiscovery implements DesktopDiscovery {
  async scan(_options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    const entries: RuntimeAppRecord[] = [];

    const descriptorPaths = await this.findDescriptorPaths();
    for (const aaiJsonPath of descriptorPaths) {
      try {
        const raw = await readFile(aaiJsonPath, 'utf-8');
        const descriptor = parseAaiJson(JSON.parse(raw));
        entries.push({
          localId: deriveLocalId(`desktop:${aaiJsonPath}`, 'desktop'),
          descriptor,
          source: 'desktop',
          location: dirname(aaiJsonPath),
        });
      } catch (err) {
        logger.warn({ path: aaiJsonPath, err }, 'Failed to parse Linux descriptor');
      }
    }

    return entries;
  }

  private async findDescriptorPaths(): Promise<string[]> {
    const searchRoots = [
      '/usr/share',
      '/usr/local/share',
      join(process.env.HOME ?? '', '.local/share'),
    ];

    try {
      const { stdout } = await execAsync(
        `find ${searchRoots.join(' ')} -maxdepth 4 -name aai.json 2>/dev/null || true`
      );
      return stdout
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean);
    } catch (err) {
      logger.warn({ err }, 'Failed to scan Linux descriptors');
      return [];
    }
  }
}
