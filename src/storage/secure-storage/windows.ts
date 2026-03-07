import type { SecureStorage } from './interface.js';
import { AaiError } from '../../errors/errors.js';

/**
 * Windows Secure Storage using Windows Credential Manager
 */
export class WindowsSecureStorage implements SecureStorage {
  async get(_account: string): Promise<string | null> {
    // TODO: Implement cmdkey for credential retrieval
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Windows secure storage is not yet implemented',
      { platform: 'windows' }
    );
  }

  async set(_account: string, _value: string): Promise<void> {
    // TODO: Implement cmdkey for credential storage
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Windows secure storage is not yet implemented',
      { platform: 'windows' }
    );
  }

  async delete(_account: string): Promise<void> {
    // TODO: Implement cmdkey for credential deletion
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Windows secure storage is not yet implemented',
      { platform: 'windows' }
    );
  }
}
