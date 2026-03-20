import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type {
  CallToolRequest,
  CallToolResult,
  CreateTaskResult,
  RequestId,
  Task,
  TaskStatus,
} from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/index.js';

import { logger } from '../utils/logger.js';

import type { ExecutionObserver, ExecutionTaskStatus } from '../executors/events.js';

type PseudoTaskStatus = TaskStatus | 'queued';

interface ActiveTaskState {
  cancelled: boolean;
  progress: number;
}

export class McpTaskRunner {
  private readonly activeTasks = new Map<string, ActiveTaskState>();

  constructor(
    private readonly server: Server,
    readonly taskStore: InMemoryTaskStore = new InMemoryTaskStore()
  ) {}

  async createTask(
    requestId: RequestId,
    request: CallToolRequest
  ): Promise<CreateTaskResult> {
    const taskOptions = request.params.task as { ttl?: number; pollInterval?: number } | undefined;
    const task = await this.taskStore.createTask(
      {
        ttl: taskOptions?.ttl,
        pollInterval: taskOptions?.pollInterval,
      },
      requestId,
      request
    );

    this.activeTasks.set(task.taskId, { cancelled: false, progress: 0 });
    await this.notifyTaskStatus(task, 'queued');
    return { task };
  }

  async updateTask(taskId: string, status: PseudoTaskStatus, statusMessage?: string): Promise<Task> {
    if (status !== 'queued') {
      await this.taskStore.updateTaskStatus(taskId, status, statusMessage);
    }

    const task = await this.getTask(taskId);
    await this.notifyTaskStatus(task, status, statusMessage);
    return task;
  }

  async completeTask(taskId: string, result: CallToolResult): Promise<void> {
    const status = result.isError ? 'failed' : 'completed';
    const task = await this.getTask(taskId);
    if (isTerminalTaskStatus(task.status)) {
      return;
    }

    await this.taskStore.storeTaskResult(taskId, status, result);
    await this.notifyTaskStatus(await this.getTask(taskId));
  }

  async failTask(taskId: string, message: string): Promise<void> {
    await this.completeTask(taskId, {
      content: [{ type: 'text', text: message }],
      isError: true,
    });
  }

  async cancelTask(taskId: string): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!isTerminalTaskStatus(task.status)) {
      const active = this.activeTasks.get(taskId);
      if (active) {
        active.cancelled = true;
      }
      await this.taskStore.updateTaskStatus(taskId, 'cancelled', 'Cancelled by client (best effort)');
    }

    const updated = await this.getTask(taskId);
    await this.notifyTaskStatus(updated);
    return updated;
  }

  async getTask(taskId: string): Promise<Task> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task;
  }

  async getTaskResult(taskId: string): Promise<CallToolResult> {
    return (await this.taskStore.getTaskResult(taskId)) as CallToolResult;
  }

  async listTasks(cursor?: string): Promise<{ tasks: Task[]; nextCursor?: string }> {
    return this.taskStore.listTasks(cursor);
  }

  createObserver(
    taskId: string,
    progressToken?: string | number
  ): ExecutionObserver {
    return {
      onTaskStatus: async ({ status, message }) => {
        await this.updateTask(taskId, normalizeTaskStatus(status), message);
      },
      onMessage: async ({ message }) => {
        await this.updateTask(taskId, 'working', message);
      },
      onProgress: async ({ progress, message }) => {
        const active = this.activeTasks.get(taskId);
        if (!active || active.cancelled || progressToken === undefined) {
          return;
        }

        active.progress = progress ?? active.progress + 1;
        await this.server.notification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: active.progress,
            ...(message ? { message } : {}),
          },
        });
      },
    };
  }

  runTask(taskId: string, run: () => Promise<CallToolResult>): void {
    void (async () => {
      try {
        await this.updateTask(taskId, 'working');
        const result = await run();
        if (this.activeTasks.get(taskId)?.cancelled) {
          return;
        }
        await this.completeTask(taskId, result);
      } catch (err) {
        if (this.activeTasks.get(taskId)?.cancelled) {
          return;
        }
        logger.error({ err, taskId }, 'Task execution failed');
        await this.failTask(taskId, err instanceof Error ? err.message : String(err));
      } finally {
        this.activeTasks.delete(taskId);
      }
    })();
  }

  private async notifyTaskStatus(
    task: Task,
    statusOverride?: PseudoTaskStatus,
    statusMessage?: string
  ): Promise<void> {
    await this.server.notification({
      method: 'notifications/tasks/status',
      params: {
        ...task,
        status: statusOverride === 'queued' ? 'working' : (statusOverride ?? task.status),
        ...(statusMessage || statusOverride === 'queued'
          ? { statusMessage: statusMessage ?? 'queued' }
          : {}),
      },
    });
  }
}

function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function normalizeTaskStatus(status: ExecutionTaskStatus): PseudoTaskStatus {
  return status;
}
