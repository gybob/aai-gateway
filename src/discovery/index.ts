import { getCurrentPlatform } from '../utils/platform.js';

import type { DesktopDiscovery } from './interface.js';
import { LinuxDiscovery } from './linux.js';
import { MacOSDiscovery } from './macos.js';
import { DiscoveryManager } from './manager.js';
import { DesktopDiscoverySource, AgentDiscoverySource, ManagedDiscoverySource } from './sources/index.js';
import { WindowsDiscovery } from './windows.js';

export type { DesktopDiscovery, DiscoveryOptions } from './interface.js';
export type { DiscoverySource } from '../types/discovery.js';
export { DiscoveryManager } from './manager.js';
export { DesktopDiscoverySource, AgentDiscoverySource, ManagedDiscoverySource } from './sources/index.js';

/**
 * Create a desktop discovery instance for the current platform.
 * @deprecated Use DesktopDiscoverySource with DiscoveryManager instead
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

/**
 * Create a configured DiscoveryManager with all standard sources
 */
export function createDiscoveryManager(): {
  manager: DiscoveryManager;
  sources: {
    desktop: DesktopDiscoverySource;
    agents: AgentDiscoverySource;
    managed: ManagedDiscoverySource;
  };
} {
  const desktop = new DesktopDiscoverySource();
  const agents = new AgentDiscoverySource();
  const managed = new ManagedDiscoverySource();

  const manager = new DiscoveryManager();
  manager.register(desktop);
  manager.register(agents);
  manager.register(managed);

  return { manager, sources: { desktop, agents, managed } };
}
