import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { parseAaiJson } from '../parsers/schema.js';
import type { RuntimeAppRecord } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';
import { deriveLocalId } from '../utils/ids.js';
import type { DesktopDiscovery, DiscoveryOptions } from './interface.js';

const execAsync = promisify(exec);

const STANDARD_APP_PATHS = ['/Applications', '~/Applications'];
const XCODE_DEV_PATHS = [
  '~/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug',
  '~/Library/Developer/Xcode/DerivedData/*/Build/Products/Release',
];
const SANDBOX_CONTAINER_PATHS = ['~/Library/Containers/*/Data/Library/Application\\ Support'];

export class MacOSDiscovery implements DesktopDiscovery {
  async scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    const searchPaths = [...STANDARD_APP_PATHS, ...SANDBOX_CONTAINER_PATHS];
    if (options?.devMode) {
      searchPaths.push(...XCODE_DEV_PATHS);
    }

    const pathsArg = searchPaths.join(' ');
    const findCmd = [
      'setopt nullglob 2>/dev/null;',
      `find ${pathsArg} -maxdepth 6 \\( -path "*/Contents/Resources/aai.json" -o -name "aai.json" \\) 2>/dev/null`,
    ].join(' ');

    let stdout = '';
    try {
      ({ stdout } = await execAsync(findCmd, { shell: '/bin/zsh' }));
    } catch (err: unknown) {
      stdout = (err as { stdout?: string }).stdout ?? '';
    }

    const paths = stdout
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const records: RuntimeAppRecord[] = [];
    for (const aaiJsonPath of paths) {
      try {
        const raw = await readFile(aaiJsonPath, 'utf-8');
        const descriptor = parseAaiJson(JSON.parse(raw));
        records.push({
          localId: deriveLocalId(`desktop:${aaiJsonPath}`, 'desktop'),
          descriptor,
          source: 'desktop',
          location:
            aaiJsonPath.endsWith('/Contents/Resources/aai.json')
              ? dirname(dirname(dirname(aaiJsonPath)))
              : dirname(aaiJsonPath),
        });
      } catch (err) {
        logger.warn({ path: aaiJsonPath, err }, 'Failed to parse macOS descriptor');
      }
    }

    return records;
  }
}
