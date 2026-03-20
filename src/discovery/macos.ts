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

const STANDARD_APP_PATHS = ['/Applications', '~/Applications'];
const XCODE_DEV_PATHS = [
  '~/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug',
  '~/Library/Developer/Xcode/DerivedData/*/Build/Products/Release',
];
const SANDBOX_DESCRIPTOR_PATTERNS = [
  '~/Library/Containers/*/Data/Library/Application\\ Support/aai.json',
  '~/Library/Containers/*/Data/Library/Application\\ Support/aai-gateway/aai.json',
];
const DISCOVERY_TIMEOUT_MS = 5000;

function buildDiscoveryCommand(options?: DiscoveryOptions): string {
  const commands: string[] = [
    'setopt nullglob 2>/dev/null',
    `find ${STANDARD_APP_PATHS.join(' ')} -maxdepth 6 -path "*/Contents/Resources/aai.json" 2>/dev/null`,
    `print -rl -- ${SANDBOX_DESCRIPTOR_PATTERNS.join(' ')}`,
  ];

  if (options?.devMode) {
    commands.push(
      `find ${XCODE_DEV_PATHS.join(' ')} -maxdepth 6 -name "aai.json" 2>/dev/null`
    );
  }

  return commands.join('; ');
}

export class MacOSDiscovery implements DesktopDiscovery {
  async scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    const findCmd = buildDiscoveryCommand(options);
    let stdout = '';
    try {
      ({ stdout } = await execAsync(findCmd, {
        shell: '/bin/zsh',
        timeout: DISCOVERY_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      }));
    } catch (err: unknown) {
      stdout = (err as { stdout?: string }).stdout ?? '';
      logger.warn({ err }, 'macOS discovery command timed out or failed');
    }

    const paths = Array.from(
      new Set(
        stdout
      .split('\n')
      .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );

    const records: RuntimeAppRecord[] = [];
    for (const aaiJsonPath of paths) {
      try {
        const raw = await readFile(aaiJsonPath, 'utf-8');
        const descriptor = parseAaiJson(JSON.parse(raw));
        const availability = await evaluateDescriptorAvailability(descriptor);
        if (!availability.available) {
          continue;
        }
        records.push({
          localId: deriveLocalId(`desktop:${aaiJsonPath}`, 'desktop'),
          descriptor,
          source: 'desktop',
          location:
            availability.location ??
            (aaiJsonPath.endsWith('/Contents/Resources/aai.json')
              ? dirname(dirname(dirname(aaiJsonPath)))
              : dirname(aaiJsonPath)),
        });
      } catch (err) {
        logger.warn({ path: aaiJsonPath, err }, 'Failed to parse macOS descriptor');
      }
    }

    return records;
  }
}
