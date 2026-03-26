import type { ExecutionResult } from '../types/index.js';

import type { Executor } from './interface.js';

export type ExecutionTaskStatus = 'queued' | 'working' | 'completed' | 'failed' | 'cancelled';

export interface ExecutionObserver {
  onProgress?(event: { progress?: number; message?: string }): void | Promise<void>;
  onMessage?(event: { message: string }): void | Promise<void>;
  onTaskStatus?(
    event: { status: ExecutionTaskStatus; message?: string }
  ): void | Promise<void>;
}

export interface TaskCapableExecutor
  extends Executor {
  executeWithObserver?(
    appId: string,
    config: unknown,
    operation: string,
    args: Record<string, unknown>,
    observer: ExecutionObserver
  ): Promise<ExecutionResult>;
}
