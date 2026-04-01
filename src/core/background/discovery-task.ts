/**
 * Discovery Background Task
 *
 * Scans for available apps on startup.
 */

import type { DiscoveryOptions } from '../../discovery/index.js';
import { logger } from '../../utils/logger.js';
import type { BackgroundTask } from './task-manager.js';
import type { AppRegistry } from '../app-registry.js';

export class DiscoveryBackgroundTask implements BackgroundTask {
  readonly name = 'discovery';

  constructor(
    private readonly appRegistry: AppRegistry,
    private readonly discoveryManager: import('../../discovery/manager.js').DiscoveryManager,
    private readonly options: DiscoveryOptions | undefined
  ) {}

  async start(): Promise<void> {
    try {
      const discoveredApps = await this.discoveryManager.scanAll(this.options);
      for (const app of discoveredApps) {
        this.appRegistry.set(app.appId, app);
      }
      logger.info({ count: discoveredApps.length }, 'Discovery completed');
    } catch (err) {
      logger.error({ err }, 'Discovery failed');
      throw err;
    }
  }

  stop(): void {}
}
