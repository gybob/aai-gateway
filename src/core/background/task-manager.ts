/**
 * Background Task Framework
 *
 * Provides a unified interface for background tasks that run during AAI Gateway lifetime.
 * Tasks can:
 * - Run once at startup
 * - Run periodically at a specified interval
 * - Be gracefully stopped
 */

import { logger } from '../../utils/logger.js';

export interface BackgroundTask {
  readonly name: string;
  start(): Promise<void>;
  stop(): void;
}

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private intervals = new Map<string, NodeJS.Timeout>();
  private started = false;

  register(task: BackgroundTask): void {
    if (this.tasks.has(task.name)) {
      logger.warn({ task: task.name }, 'Background task already registered, skipping');
      return;
    }
    this.tasks.set(task.name, task);
    logger.debug({ task: task.name }, 'Background task registered');
  }

  async startAll(): Promise<void> {
    if (this.started) {
      logger.warn('Background task manager already started');
      return;
    }
    this.started = true;

    logger.info({ count: this.tasks.size }, 'Starting all background tasks');

    for (const [name, task] of this.tasks) {
      try {
        await task.start();
        logger.info({ task: name }, 'Background task started');
      } catch (err) {
        logger.error({ task: name, err }, 'Background task failed to start');
      }
    }
  }

  stopAll(): void {
    if (!this.started) {
      return;
    }

    logger.info({ count: this.tasks.size }, 'Stopping all background tasks');

    for (const [name, interval] of this.intervals) {
      clearInterval(interval);
      logger.debug({ task: name }, 'Background task interval cleared');
    }
    this.intervals.clear();

    for (const [name, task] of this.tasks) {
      try {
        task.stop();
        logger.debug({ task: name }, 'Background task stopped');
      } catch (err) {
        logger.error({ task: name, err }, 'Background task failed to stop');
      }
    }

    this.started = false;
    logger.info('All background tasks stopped');
  }

  schedulePeriodic(taskName: string, intervalMs: number, fn: () => void): void {
    const existing = this.intervals.get(taskName);
    if (existing) {
      clearInterval(existing);
    }

    const interval = setInterval(() => {
      try {
        fn();
      } catch (err) {
        logger.error({ task: taskName, err }, 'Background task periodic run failed');
      }
    }, intervalMs);

    this.intervals.set(taskName, interval);
    logger.debug({ task: taskName, intervalMs }, 'Background task scheduled for periodic run');
  }
}
