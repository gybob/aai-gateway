import type { IpcExecutor } from './interface.js';
import { AaiError } from '../../errors/errors.js';

/**
 * Linux IPC Executor using DBus
 */
export class LinuxIpcExecutor implements IpcExecutor {
  async execute(appId: string, toolName: string, _args: Record<string, unknown>): Promise<unknown> {
    // TODO: Implement DBus invocation via gdbus
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Linux IPC execution is not yet implemented',
      { platform: 'linux', appId, toolName }
    );
  }
}
