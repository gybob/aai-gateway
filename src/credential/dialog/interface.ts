/**
 * Credential dialog interface
 *
 * Platform-specific dialog for prompting users to enter credentials
 */

/**
 * Dialog info for API Key or Cookie auth
 */
export interface CredentialDialogInfo {
  authType: 'apiKey' | 'cookie';
  appName: string;
  appId: string;
  instructions?: string;
  inputLabel: string;
  inputPlaceholder?: string;
}

/**
 * Dialog info for App Credential auth (e.g., Feishu)
 */
export interface AppCredentialDialogInfo {
  authType: 'appCredential';
  appName: string;
  appId: string;
  instructions?: string;
}

/**
 * Result from credential dialog
 */
export interface CredentialDialogResult {
  action: 'submit' | 'cancel' | 'help';
  credential?: string;
}

/**
 * Result from app credential dialog
 */
export interface AppCredentialDialogResult {
  action: 'submit' | 'cancel' | 'help';
  appId?: string;
  appSecret?: string;
}

/**
 * Platform-specific credential dialog interface
 */
export interface CredentialDialog {
  /**
   * Show dialog for API Key or Cookie input
   */
  show(info: CredentialDialogInfo): Promise<CredentialDialogResult>;

  /**
   * Show dialog for App ID and App Secret input
   */
  showForAppCredential(info: AppCredentialDialogInfo): Promise<AppCredentialDialogResult>;
}
