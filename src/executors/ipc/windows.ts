import type { IpcExecutor } from './interface.js';
import { AaiError } from '../../errors/errors.js';

/**
 * Windows IPC Executor using PowerShell COM automation
 */
export class WindowsIpcExecutor implements IpcExecutor {
  async execute(appId: string, toolName: string, _args: Record<string, unknown>): Promise<unknown> {
    // TODO: Implement PowerShell COM automation execution
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Windows IPC execution is not yet implemented',
      { platform: 'windows', appId, toolName }
    );
  }
}
