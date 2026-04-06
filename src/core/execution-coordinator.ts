/**
 * Execution Coordinator
 *
 * Handles execution routing to appropriate executors
 * and inactivity timeout management.
 */

import type { AaiJson } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';
import { getAcpExecutor } from '../executors/acp.js';
import { getMcpExecutor } from '../executors/mcp.js';
import { legacyExecuteSkill as executeSkill } from '../executors/skill.js';
import { getSkillExecutor } from '../executors/skill.js';
import type { Executor } from '../executors/interface.js';
import type { ExecutionObserver } from '../executors/events.js';
import { isAcpAgentAccess, isMcpAccess, isSkillAccess } from '../types/aai-json.js';

const DOWNSTREAM_INACTIVITY_TIMEOUT_MS = 10 * 60_000;

export interface ExecutionRequest {
  appId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export class ExecutionCoordinator {
  async execute(
    appId: string,
    descriptor: AaiJson,
    toolName: string,
    args: Record<string, unknown>,
    observer?: ExecutionObserver
  ): Promise<unknown> {
    const access = descriptor.access;

    if (isMcpAccess(access)) {
      const executor = getMcpExecutor();
      return executor.callTool({ appId, config: access.config }, toolName, args, observer);
    }

    if (isSkillAccess(access)) {
      return executeSkill(access.config as any, toolName, args);
    }

    if (isAcpAgentAccess(access)) {
      const executor = getAcpExecutor();
      if (observer && executor.executeWithObserver) {
        return executor.executeWithObserver(appId, access.config, toolName, args, observer);
      }
      return executor.execute(appId, access.config, toolName, args);
    }

    throw new Error(`Unsupported protocol ${JSON.stringify(access)}`);
  }

  async executeWithInactivityTimeout(
    appId: string,
    descriptor: AaiJson,
    toolName: string,
    args: Record<string, unknown>,
    observer?: ExecutionObserver
  ): Promise<unknown> {
    const timeoutMs = DOWNSTREAM_INACTIVITY_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      let completed = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (callback: () => void) => {
        if (completed) return;
        completed = true;
        if (timer) clearTimeout(timer);
        callback();
      };

      const scheduleTimeout = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const error = new Error(
            `Downstream '${appId}' timed out after ${timeoutMs}ms without any activity`
          );
          void this.cleanupTimedOutExecution(appId, descriptor).finally(() => {
            finish(() => reject(error));
          });
        }, timeoutMs);
      };

      const activityObserver = this.wrapExecutionObserver(observer, scheduleTimeout);
      scheduleTimeout();

      this.execute(appId, descriptor, toolName, args, activityObserver).then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error))
      );
    });
  }

  getExecutor(protocol: string): Executor {
    switch (protocol) {
      case 'mcp':
        return getMcpExecutor();
      case 'skill':
        return getSkillExecutor();
      case 'acp-agent':
        return getAcpExecutor();
      default:
        throw new Error(`Protocol '${protocol}' does not support app capabilities`);
    }
  }

  private wrapExecutionObserver(
    observer: ExecutionObserver | undefined,
    onActivity: () => void
  ): ExecutionObserver {
    return {
      onMessage: async (event) => {
        onActivity();
        await observer?.onMessage?.(event);
      },
      onProgress: async (event) => {
        onActivity();
        await observer?.onProgress?.(event);
      },
      onTaskStatus: async (event) => {
        onActivity();
        await observer?.onTaskStatus?.(event);
      },
    };
  }

  private async cleanupTimedOutExecution(appId: string, descriptor: AaiJson): Promise<void> {
    const access = descriptor.access;
    try {
      if (isMcpAccess(access)) {
        await getMcpExecutor().close(appId);
        return;
      }
      if (isAcpAgentAccess(access)) {
        await getAcpExecutor().disconnect(appId);
      }
    } catch (err) {
      logger.warn({ appId, err }, 'Failed to clean up timed out downstream execution');
    }
  }
}
