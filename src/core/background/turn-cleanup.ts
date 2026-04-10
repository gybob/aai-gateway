/**
 * Turn Cleanup Background Task
 *
 * Cleans up turns that were finished but not polled by clients.
 * Runs periodically to remove turns older than the retention period.
 */

import { getAcpExecutor } from '../../executors/acp.js';
import { logger } from '../../utils/logger.js';
import type { BackgroundTask } from './task-manager.js';

const TURN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export class TurnCleanupTask implements BackgroundTask {
  readonly name = 'turn-cleanup';

  async start(): Promise<void> {
    logger.debug(
      {
        retentionDays: TURN_RETENTION_MS / (24 * 60 * 60 * 1000),
        intervalHours: CLEANUP_INTERVAL_MS / (60 * 60 * 1000),
      },
      'Turn cleanup task starting'
    );

    // Run immediately on start
    this.run();

    // Then run periodically
    const executor = getAcpExecutor();
    if ('scheduleTurnCleanup' in executor && typeof executor.scheduleTurnCleanup === 'function') {
      executor.scheduleTurnCleanup(CLEANUP_INTERVAL_MS, TURN_RETENTION_MS);
    }
  }

  stop(): void {
    const executor = getAcpExecutor();
    if (
      'unscheduleTurnCleanup' in executor &&
      typeof executor.unscheduleTurnCleanup === 'function'
    ) {
      executor.unscheduleTurnCleanup();
    }
    logger.debug({ task: this.name }, 'Turn cleanup task stopped');
  }

  private run(): void {
    try {
      const executor = getAcpExecutor();
      if (
        'cleanupFinishedTurns' in executor &&
        typeof executor.cleanupFinishedTurns === 'function'
      ) {
        const cleaned = executor.cleanupFinishedTurns(TURN_RETENTION_MS);
        if (cleaned > 0) {
          logger.info({ task: this.name, cleanedTurns: cleaned }, 'Turn cleanup completed');
        }
      }
    } catch (err) {
      logger.error({ task: this.name, err }, 'Turn cleanup run failed');
    }
  }
}
