import type { CredentialDialog } from './interface.js';
import { MacOSCredentialDialog } from './macos.js';

/**
 * Create platform-specific credential dialog
 */
export function createCredentialDialog(): CredentialDialog {
  const platform = process.platform;

  switch (platform) {
    case 'darwin':
      return new MacOSCredentialDialog();
    // TODO: Add Windows and Linux support
    // case "win32":
    //   return new WindowsCredentialDialog();
    // case "linux":
    //   return new LinuxCredentialDialog();
    default:
      throw new Error(`Credential dialog not implemented for platform: ${platform}`);
  }
}

export {
  type CredentialDialog,
  type CredentialDialogInfo,
  type CredentialDialogResult,
  type AppCredentialDialogInfo,
  type AppCredentialDialogResult,
} from './interface.js';
