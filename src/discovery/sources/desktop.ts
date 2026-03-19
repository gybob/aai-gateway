import type { RuntimeAppRecord } from '../../types/aai-json.js';
import type { DiscoveryOptions, DiscoverySource } from '../../types/discovery.js';
import { getCurrentPlatform } from '../../utils/platform.js';
import { LinuxDiscovery } from '../linux.js';
import { MacOSDiscovery } from '../macos.js';
import { WindowsDiscovery } from '../windows.js';

/**
 * Desktop Discovery Source
 *
 * Discovers desktop apps by scanning standard app directories on the current platform.
 */
export class DesktopDiscoverySource implements DiscoverySource {
  readonly name = 'desktop';
  readonly priority = 100; // High priority

  private discovery: MacOSDiscovery | WindowsDiscovery | LinuxDiscovery;

  constructor() {
    const platform = getCurrentPlatform();
    switch (platform) {
      case 'macos':
        this.discovery = new MacOSDiscovery();
        break;
      case 'linux':
        this.discovery = new LinuxDiscovery();
        break;
      case 'windows':
        this.discovery = new WindowsDiscovery();
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  async scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    return this.discovery.scan(options);
  }

  shouldCache(): boolean {
    return true; // Desktop apps don't change frequently
  }

  getCacheKey(): string {
    return `discovery:desktop`;
  }
}
