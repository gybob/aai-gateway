/**
 * Seed Pre-built Descriptors
 *
 * Writes pre-built ACP agent descriptors into the managed apps directory
 * on every startup (always overwrites to ensure latest version).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AaiJson } from '../types/aai-json.js';
import { getManagedAppDir } from '../storage/paths.js';
import { logger } from '../utils/logger.js';

interface PrebuiltDescriptor {
  appId: string;
  descriptor: AaiJson;
}

async function loadPrebuiltDescriptors(): Promise<PrebuiltDescriptor[]> {
  const modules = import.meta.glob('../discovery/descriptors/*-agent.ts', { eager: true });
  const descriptors: PrebuiltDescriptor[] = [];

  for (const [path, mod] of Object.entries(modules)) {
    const module = mod as { appId?: string; descriptor?: AaiJson };
    if (module.appId && module.descriptor) {
      descriptors.push({ appId: module.appId, descriptor: module.descriptor });
    } else {
      logger.warn({ path }, 'Pre-built descriptor module missing appId or descriptor export');
    }
  }

  return descriptors;
}

export async function seedPrebuiltDescriptors(): Promise<number> {
  const descriptors = await loadPrebuiltDescriptors();
  let seeded = 0;

  for (const { appId, descriptor } of descriptors) {
    try {
      const appDir = getManagedAppDir(appId);
      await mkdir(appDir, { recursive: true });
      await writeFile(
        join(appDir, 'aai.json'),
        JSON.stringify(descriptor, null, 2),
        'utf-8'
      );
      seeded++;
      logger.debug({ appId }, 'Pre-built descriptor seeded');
    } catch (err) {
      logger.error({ appId, err }, 'Failed to seed pre-built descriptor');
    }
  }

  logger.info({ count: seeded }, 'Pre-built descriptors seeded');
  return seeded;
}
