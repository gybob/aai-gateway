import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAaiJson } from '../parsers/schema.js';
import type { RuntimeAppRecord } from '../types/aai-json.js';
import { getManagedAppsRoot } from './paths.js';

export async function loadManagedDescriptors(): Promise<RuntimeAppRecord[]> {
  try {
    const root = getManagedAppsRoot();
    const entries = await readdir(root, { withFileTypes: true });
    const records: RuntimeAppRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      try {
        const descriptorPath = join(root, entry.name, 'aai.json');
        const descriptor = parseAaiJson(JSON.parse(await readFile(descriptorPath, 'utf-8')));
        records.push({
          localId: entry.name,
          descriptor,
          source:
            descriptor.access.protocol === 'mcp'
              ? 'mcp-import'
              : descriptor.access.protocol === 'skill'
                ? 'skill-import'
                : descriptor.access.protocol === 'acp-agent'
                  ? 'acp-agent'
                  : 'cli',
          location: descriptorPath,
        });
      } catch {
        // ignore non-app directories
      }
    }

    return records;
  } catch {
    return [];
  }
}
