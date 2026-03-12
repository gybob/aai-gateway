import { AaiError } from '../../errors/errors.js';
import type { NativeExecution } from '../../types/aai-json.js';
import { AppleEventsExecutor } from './apple-events.js';
import { ComExecutor } from './com.js';
import { DbusExecutor } from './dbus.js';
import type { NativeExecutor } from './interface.js';

export type { NativeExecutor } from './interface.js';

export function createNativeExecutor(type: NativeExecution['type']): NativeExecutor {
  switch (type) {
    case 'apple-events':
      return new AppleEventsExecutor();
    case 'dbus':
      return new DbusExecutor();
    case 'com':
      return new ComExecutor();
    default:
      throw new AaiError('NOT_IMPLEMENTED', `Unsupported native execution type: ${type}`);
  }
}
