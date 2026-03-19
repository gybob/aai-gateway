import { AaiError } from '../../errors/errors.js';

import type { SecureStorage } from './interface.js';

/**
 * Linux Secure Storage using libsecret/secret-tool
 */
export class LinuxSecureStorage implements SecureStorage {
  async get(_account: string): Promise<string | null> {
    // TODO: Implement secret-tool for credential retrieval
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Linux secure storage is not yet implemented',
      { platform: 'linux' }
    );
  }

  async set(_account: string, _value: string): Promise<void> {
    // TODO: Implement secret-tool for credential storage
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Linux secure storage is not yet implemented',
      { platform: 'linux' }
    );
  }

  async delete(_account: string): Promise<void> {
    // TODO: Implement secret-tool for credential deletion
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Linux secure storage is not yet implemented',
      { platform: 'linux' }
    );
  }
}
