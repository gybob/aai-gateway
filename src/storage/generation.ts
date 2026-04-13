/**
 * Generation File
 *
 * Cross-process change detection for the app registry.
 * Each gateway process bumps the generation after tools-changing operations.
 * Other processes watch this file and reload when it changes.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join, dirname } from 'node:path';

import { getManagedAppsRoot } from './paths.js';
import { logger } from '../utils/logger.js';

function getGenerationFilePath(): string {
  return join(getManagedAppsRoot(), '.generation');
}

export async function readGeneration(): Promise<number> {
  try {
    const content = await readFile(getGenerationFilePath(), 'utf-8');
    const value = parseInt(content.trim(), 10);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export async function bumpGeneration(): Promise<number> {
  const filePath = getGenerationFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  const current = await readGeneration();
  const next = current + 1;
  await writeFile(filePath, String(next), 'utf-8');
  logger.debug({ generation: next }, 'Generation bumped');
  return next;
}

/**
 * Watch the generation file for changes made by other processes.
 * Calls `onChange` when the generation number increases beyond `initialGeneration`.
 * Returns a cleanup function to stop watching.
 */
export function watchGeneration(
  initialGeneration: number,
  onChange: (newGeneration: number) => void
): () => void {
  const filePath = getGenerationFilePath();
  let lastSeen = initialGeneration;
  let watcher: FSWatcher | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    watcher = watch(filePath, () => {
      // Debounce rapid writes (e.g. multiple operations in quick succession)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const current = await readGeneration();
          if (current > lastSeen) {
            lastSeen = current;
            onChange(current);
          }
        } catch (err) {
          logger.debug({ err }, 'Failed to read generation during watch');
        }
      }, 100);
    });

    logger.debug('Generation file watcher started');
  } catch (err) {
    logger.debug({ err }, 'Failed to start generation file watcher (file may not exist yet)');
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher?.close();
    logger.debug('Generation file watcher stopped');
  };
}
