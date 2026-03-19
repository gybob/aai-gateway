import { AaiError } from '../../errors/errors.js';

import type { ConsentDialog, ConsentDialogInfo, ConsentDialogResult } from './interface.js';

/**
 * Linux Consent Dialog using zenity or kdialog
 */
export class LinuxConsentDialog implements ConsentDialog {
  async show(_info: ConsentDialogInfo): Promise<ConsentDialogResult> {
    // TODO: Implement zenity/kdialog dialog
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Linux consent dialog is not yet implemented',
      { platform: 'linux' }
    );
  }
}
