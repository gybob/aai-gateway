/**
 * ACP Pre-warm Background Task
 *
 * Pre-initializes all discovered ACP agents so the first prompt doesn't pay
 * the full initialization + session-creation penalty.
 *
 * Depends on: discovery
 */

import { logger } from '../../utils/logger.js';
import type { BackgroundTask } from './task-manager.js';
import type { AppRegistry } from '../app-registry.js';

export class AcpPrewarmBackgroundTask implements BackgroundTask {
  readonly name = 'acp-prewarm';
  readonly dependencies: string[] = [];

  constructor(private readonly appRegistry: AppRegistry) {}

  async start(): Promise<void> {
    const acpApps = this.appRegistry.getByProtocol('acp-agent');

    if (acpApps.length === 0) {
      logger.debug('No ACP agents to pre-warm');
      return;
    }

    logger.info({ count: acpApps.length }, 'Pre-warming ACP agents');

    for (const app of acpApps) {
      const { getAcpExecutor } = await import('../../executors/acp.js');
      const config = app.descriptor.access.config as import('../../types/index.js').AcpAgentConfig;
      void getAcpExecutor()
        .connect(app.appId, config)
        .then(() => {
          logger.info({ appId: app.appId }, 'ACP agent pre-warm completed');
        })
        .catch((err) => {
          logger.warn({ appId: app.appId, err }, 'ACP agent pre-warm failed (will retry lazily)');
        });
    }
  }

  stop(): void {}
}
