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
  instructions: {
    short: string;
    helpUrl?: string;
  };
  obtainUrl: string;
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
  instructions: {
    short: string;
    helpUrl?: string;
  };
  obtainUrl: string;
}

/**
 * Result from credential dialog
 */
export interface CredentialDialogResult {
  credential: string;
  cancelled: boolean;
}

/**
 * Result from app credential dialog
 */
export interface AppCredentialDialogResult {
  appId: string;
  appSecret: string;
  cancelled: boolean;
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
