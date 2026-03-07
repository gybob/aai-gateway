import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesktopDiscovery, DiscoveredDesktopApp, DiscoveryOptions } from './interface.js';
import type { AaiJson } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

const execAsync = promisify(exec);

/**
 * Linux Discovery - scan XDG desktop entries for AAI-enabled apps
 */
export class LinuxDiscovery implements DesktopDiscovery {
  /**
   * Scan for AAI-enabled desktop applications.
   * @param _options - Discovery options
   */
  async scan(_options?: DiscoveryOptions): Promise<DiscoveredDesktopApp[]> {
    const paths = await this.findDesktopFiles();

    const apps: DiscoveredDesktopApp[] = [];
    const locale = getSystemLocale();

    for (const desktopPath of paths) {
      try {
        const content = await readFile(desktopPath, 'utf-8');
        const aaiConfig = this.parseAAIConfig(content);
        
        if (!aaiConfig) continue;

        // Load aai.json from the config
        const aaiJsonPath = aaiConfig;
        const raw = await readFile(aaiJsonPath, 'utf-8');
        const descriptor: AaiJson = JSON.parse(raw);

        // Filter by platform
        if (descriptor.platform !== 'linux') continue;

        const localizedName = getLocalizedName(
          descriptor.app.name,
          locale,
          descriptor.app.defaultLang
        );

        apps.push({
          bundlePath: desktopPath,
          appId: descriptor.app.id,
          name: localizedName,
          description: descriptor.app.description,
          descriptor,
        });
      } catch (err) {
        logger.warn({ path: desktopPath, err }, 'Failed to parse desktop file');
      }
    }

    return apps;
  }

  private async findDesktopFiles(): Promise<string[]> {
    const paths: string[] = [];

    // XDG paths
    const xdgPaths = [
      '/usr/share/applications',
      '/usr/local/share/applications',
      join(process.env.HOME || '', '.local/share/applications'),
    ];

    try {
      // Use find command to locate .desktop files
      const { stdout } = await execAsync(
        `find ${xdgPaths.join(' ')} -name "*.desktop" 2>/dev/null || true`
      );

      const lines = stdout.split('\n').filter(Boolean);
      paths.push(...lines);
    } catch (err) {
      logger.warn({ err }, 'Failed to scan Linux paths');
    }

    return paths;
  }

  private parseAAIConfig(content: string): string | null {
    // Look for X-AAI-Config=... in desktop entry
    const match = content.match(/^X-AAI-Config=(.+)$/m);
    return match ? match[1].trim() : null;
  }
}
