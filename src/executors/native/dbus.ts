import { AaiError } from '../../errors/errors.js';
import type { NativeExecutor } from './interface.js';

/**
 * Linux native executor using DBus.
 */
export class DbusExecutor implements NativeExecutor {
  async execute(appId: string, toolName: string, _args: Record<string, unknown>): Promise<unknown> {
    throw new AaiError('NOT_IMPLEMENTED', 'DBus execution is not yet implemented', {
      platform: 'linux',
      appId,
      toolName,
    });
  }
}
