import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluateDescriptorAvailability } from '../discovery/checks.js';
import { parseAaiJson } from '../parsers/schema.js';
import type { RuntimeAppRecord } from '../types/aai-json.js';

import { getManagedAppsRoot } from './paths.js';

export interface ManagedEntry {
  id: string;
  appId: string;
  protocol: 'mcp' | 'skill' | 'cli' | 'acp-agent';
  descriptorPath: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Managed Registry
 *
 * Manages gateway-managed app descriptors (imported MCP servers, skills, CLI apps, etc.).
 * This registry is based on the file system structure rather than a separate registry file.
 */
export class ManagedRegistry {
  /**
   * Scan the managed apps directory and return all valid app records
   */
  async scan(): Promise<RuntimeAppRecord[]> {
    try {
      const records: RuntimeAppRecord[] = [];
      const root = getManagedAppsRoot();
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        return [];
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        try {
          const descriptorPath = join(root, entry.name, 'aai.json');
          const descriptor = parseAaiJson(JSON.parse(await readFile(descriptorPath, 'utf-8')));
          const availability = await evaluateDescriptorAvailability(descriptor);
          if (!availability.available) {
            continue;
          }
          const protocol = descriptor.access.protocol;

          let source: RuntimeAppRecord['source'];
          switch (protocol) {
            case 'mcp':
              source = 'mcp-import';
              break;
            case 'skill':
              source = 'skill-import';
              break;
            case 'acp-agent':
              source = 'acp-agent';
              break;
            case 'cli':
              source = 'cli';
              break;
            default:
              continue;
          }

          records.push({
            appId: entry.name,
            descriptor,
            source,
            location: availability.location ?? descriptorPath,
          });
        } catch {
          // Skip non-app directories or invalid descriptors
        }
      }

      return records;
    } catch {
      return [];
    }
  }

  /**
   * Get a specific managed app by appId
   */
  async get(appId: string): Promise<RuntimeAppRecord | null> {
    const records = await this.scan();
    return records.find((r) => r.appId === appId) ?? null;
  }

  /**
   * Delete a managed app by appId
   * @deprecated This method is not implemented yet. Use the specific registries (McpRegistry, SkillRegistry) for deletion.
   */
  async delete(_appId: string): Promise<boolean> {
    // This would need to interact with the specific registries
    // For now, we'll return false to indicate it's not implemented
    return false;
  }

  /**
   * Check if a managed app exists
   */
  async has(appId: string): Promise<boolean> {
    const app = await this.get(appId);
    return app !== null;
  }
}

/**
 * Create a singleton Managed registry instance
 */
let managedRegistryInstance: ManagedRegistry | null = null;
export function getManagedRegistry(): ManagedRegistry {
  if (!managedRegistryInstance) {
    managedRegistryInstance = new ManagedRegistry();
  }
  return managedRegistryInstance;
}

// Backward compatibility exports
export async function loadManagedDescriptors(): Promise<RuntimeAppRecord[]> {
  return getManagedRegistry().scan();
}
