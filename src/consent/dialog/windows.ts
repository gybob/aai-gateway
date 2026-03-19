import { AaiError } from '../../errors/errors.js';

import type { ConsentDialog, ConsentDialogInfo, ConsentDialogResult } from './interface.js';

/**
 * Windows Consent Dialog using PowerShell MessageBox
 */
export class WindowsConsentDialog implements ConsentDialog {
  async show(_info: ConsentDialogInfo): Promise<ConsentDialogResult> {
    // TODO: Implement PowerShell MessageBox dialog
    throw new AaiError(
      'NOT_IMPLEMENTED',
      'Windows consent dialog is not yet implemented',
      { platform: 'windows' }
    );
  }
}
