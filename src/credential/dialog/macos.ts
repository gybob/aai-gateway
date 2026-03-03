import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  CredentialDialog,
  CredentialDialogInfo,
  CredentialDialogResult,
  AppCredentialDialogInfo,
  AppCredentialDialogResult,
} from './interface.js';

const execFileAsync = promisify(execFile);

/**
 * Supported languages
 */
type Language = 'en' | 'zh';

/**
 * Localized strings
 */
const i18n = {
  en: {
    // API Key dialog
    enterApiKey: (appName: string) => `Enter API Key for ${appName}`,
    authentication: (appName: string) => `${appName} Authentication`,
    // App Credential dialogs
    enterAppId: (appName: string) => `Enter App ID for ${appName}`,
    appIdTitle: (appName: string) => `${appName} - App ID`,
    enterAppSecret: (appName: string) => `Enter App Secret for ${appName}`,
    appSecretTitle: (appName: string) => `${appName} - App Secret`,
    // Buttons
    ok: 'OK',
    cancel: 'Cancel',
    help: 'Help',
  },
  zh: {
    // API Key dialog
    enterApiKey: (appName: string) => `请输入 ${appName} 的 API 密钥`,
    authentication: (appName: string) => `${appName} 身份验证`,
    // App Credential dialogs
    enterAppId: (appName: string) => `请输入 ${appName} 的 App ID`,
    appIdTitle: (appName: string) => `${appName} - App ID`,
    enterAppSecret: (appName: string) => `请输入 ${appName} 的 App Secret`,
    appSecretTitle: (appName: string) => `${appName} - App Secret`,
    // Buttons
    ok: '确定',
    cancel: '取消',
    help: '帮助',
  },
};

/**
 * Get system language
 */
async function getSystemLanguage(): Promise<Language> {
  try {
    const { stdout } = await execFileAsync('defaults', ['read', '-g', 'AppleLocale']);
    const locale = stdout.trim().toLowerCase();

    // Check for Chinese locales
    if (locale.startsWith('zh') || locale === 'zh_cn' || locale === 'zh_tw' || locale === 'zh_hk') {
      return 'zh';
    }

    return 'en';
  } catch {
    // Fallback: try osascript
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'user locale of (get system info)',
      ]);
      const locale = stdout.trim().toLowerCase();

      if (locale.startsWith('zh')) {
        return 'zh';
      }
    } catch {
      // Ignore
    }

    return 'en';
  }
}

/**
 * macOS credential dialog using osascript
 */
export class MacOSCredentialDialog implements CredentialDialog {
  private lang: Language | null = null;

  private async getLang(): Promise<Language> {
    if (!this.lang) {
      this.lang = await getSystemLanguage();
    }
    return this.lang;
  }

  private t() {
    return i18n[this.lang ?? 'en'];
  }

  async show(info: CredentialDialogInfo): Promise<CredentialDialogResult> {
    this.lang = await this.getLang();
    const t = this.t();

    const buttons = info.instructions.helpUrl
      ? `"${t.help}", "${t.cancel}", "${t.ok}"`
      : `"${t.cancel}", "${t.ok}"`;

    const promptText = info.instructions.short;
    const dialogMessage = `${t.enterApiKey(info.appName)}\\n\\n${promptText}`;

    const script = `
      display dialog "${dialogMessage}" default answer "${info.inputPlaceholder ?? ''}" buttons {${buttons}} default button "${t.ok}" with title "${t.authentication(info.appName)}" with icon note
    `;

    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script]);

      // Parse result: "button returned:OK, text returned:<value>"
      const textMatch = stdout.match(/text returned:(.+)/);
      const buttonMatch = stdout.match(/button returned:(.+)/);

      if (buttonMatch?.[1]?.trim() === t.help) {
        // Open help URL and recurse
        await execFileAsync('open', [info.instructions.helpUrl!]);
        return this.show(info);
      }

      if (buttonMatch?.[1]?.trim() === t.cancel || !textMatch) {
        return { credential: '', cancelled: true };
      }

      const credential = textMatch[1].trim();
      if (!credential) {
        return { credential: '', cancelled: true };
      }

      return { credential, cancelled: false };
    } catch {
      // User clicked Cancel or closed dialog
      return { credential: '', cancelled: true };
    }
  }

  async showForAppCredential(info: AppCredentialDialogInfo): Promise<AppCredentialDialogResult> {
    this.lang = await this.getLang();
    const t = this.t();

    const buttons = info.instructions.helpUrl
      ? `"${t.help}", "${t.cancel}", "${t.ok}"`
      : `"${t.cancel}", "${t.ok}"`;

    // Show App ID dialog first
    const appIdScript = `
      display dialog "${t.enterAppId(info.appName)}\\n\\n${info.instructions.short}" default answer "" buttons {${buttons}} default button "${t.ok}" with title "${t.appIdTitle(info.appName)}" with icon note
    `;

    let appId: string;
    try {
      const { stdout: appIdResult } = await execFileAsync('osascript', ['-e', appIdScript]);

      const appIdMatch = appIdResult.match(/text returned:(.+)/);
      const buttonMatch = appIdResult.match(/button returned:(.+)/);

      if (buttonMatch?.[1]?.trim() === t.help) {
        await execFileAsync('open', [info.instructions.helpUrl!]);
        return this.showForAppCredential(info);
      }

      if (buttonMatch?.[1]?.trim() === t.cancel || !appIdMatch) {
        return { appId: '', appSecret: '', cancelled: true };
      }

      appId = appIdMatch[1].trim();
      if (!appId) {
        return { appId: '', appSecret: '', cancelled: true };
      }
    } catch {
      return { appId: '', appSecret: '', cancelled: true };
    }

    // Show App Secret dialog
    const appSecretScript = `
      display dialog "${t.enterAppSecret(info.appName)}" default answer "" buttons {${buttons}} default button "${t.ok}" with title "${t.appSecretTitle(info.appName)}" with icon caution
    `;

    try {
      const { stdout: secretResult } = await execFileAsync('osascript', ['-e', appSecretScript]);

      const secretMatch = secretResult.match(/text returned:(.+)/);
      const buttonMatch = secretResult.match(/button returned:(.+)/);

      if (buttonMatch?.[1]?.trim() === t.help) {
        await execFileAsync('open', [info.instructions.helpUrl!]);
        // Return to first dialog
        return this.showForAppCredential(info);
      }

      if (buttonMatch?.[1]?.trim() === t.cancel || !secretMatch) {
        return { appId: '', appSecret: '', cancelled: true };
      }

      const appSecret = secretMatch[1].trim();
      if (!appSecret) {
        return { appId: '', appSecret: '', cancelled: true };
      }

      return { appId, appSecret, cancelled: false };
    } catch {
      return { appId: '', appSecret: '', cancelled: true };
    }
  }
}
