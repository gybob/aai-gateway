import { getCurrentPlatform } from '../utils/platform.js';
import { MacOSDiscovery } from './macos.js';
import { WindowsDiscovery } from './windows.js';
import { LinuxDiscovery } from './linux.js';
import type { DesktopDiscovery } from './interface.js';

export type { DesktopDiscovery, DiscoveredDesktopApp, DiscoveryOptions } from './interface.js';

/**
 * Create a desktop discovery instance for the current platform.
 */
export function createDesktopDiscovery(): DesktopDiscovery {
  switch (getCurrentPlatform()) {
    case 'macos':
      return new MacOSDiscovery();
    case 'linux':
      return new LinuxDiscovery();
    case 'windows':
      return new WindowsDiscovery();
  }
}
