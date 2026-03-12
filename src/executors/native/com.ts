import { AaiError } from '../../errors/errors.js';
import type { NativeExecutor } from './interface.js';

/**
 * Windows native executor using COM automation.
 */
export class ComExecutor implements NativeExecutor {
  async execute(appId: string, toolName: string, _args: Record<string, unknown>): Promise<unknown> {
    throw new AaiError('NOT_IMPLEMENTED', 'COM execution is not yet implemented', {
      platform: 'windows',
      appId,
      toolName,
    });
  }
}
