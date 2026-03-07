import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import type { DesktopDiscovery, DiscoveredDesktopApp, DiscoveryOptions } from './interface.js';
import type { AaiJson } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

const execAsync = promisify(exec);

/**
 * Windows Discovery - scan for aai.json files in Windows paths
 */
export class WindowsDiscovery implements DesktopDiscovery {
  /**
   * Scan for AAI-enabled desktop applications.
   * @param _options - Discovery options
   */
  async scan(_options?: DiscoveryOptions): Promise<DiscoveredDesktopApp[]> {
    const paths = await this.findAaiJsonFiles();

    const apps: DiscoveredDesktopApp[] = [];
    const locale = getSystemLocale();

    for (const aaiJsonPath of paths) {
      try {
        const raw = await readFile(aaiJsonPath, 'utf-8');
        const descriptor: AaiJson = JSON.parse(raw);

        // Filter by platform
        if (descriptor.platform !== 'windows') continue;

        // Get localized name
        const localizedName = getLocalizedName(
          descriptor.app.name,
          locale,
          descriptor.app.defaultLang
        );

        apps.push({
          bundlePath: aaiJsonPath,
          appId: descriptor.app.id,
          name: localizedName,
          description: descriptor.app.description,
          descriptor,
        });
      } catch (err) {
        logger.warn({ path: aaiJsonPath, err }, 'Failed to parse aai.json');
      }
    }

    return apps;
  }

  private async findAaiJsonFiles(): Promise<string[]> {
    const paths: string[] = [];

    // Scan standard Windows paths
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';

    try {
      // Use PowerShell to find aai.json files
      const { stdout } = await execAsync(
        `powershell -Command "Get-ChildItem -Path '${programFiles}','${programFilesX86}','${appData}','${localAppData}' -Filter aai.json -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName"`
      );

      const lines = stdout.split('\n').filter(Boolean);
      paths.push(...lines);
    } catch (err) {
      logger.warn({ err }, 'Failed to scan Windows paths');
    }

    return paths;
  }
}
