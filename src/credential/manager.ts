import { AaiError } from '../errors/errors.js';
import { logger } from '../utils/logger.js';
import type { SecureStorage } from '../storage/secure-storage/interface.js';
import type { CredentialDialog } from './dialog/interface.js';
import type { AaiJson, ApiKeyAuth, AppCredentialAuth, CookieAuth } from '../types/aai-json.js';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

interface StoredCredential {
  type: 'apiKey' | 'cookie';
  value: string;
  createdAt: number;
}

interface StoredAppCredential {
  type: 'appCredential';
  appId: string;
  appSecret: string;
  accessToken?: string;
  expiresAt?: number;
  createdAt: number;
}

type StoredAuth = StoredCredential | StoredAppCredential;

/**
 * Manages credentials for different auth types (apiKey, cookie, appCredential)
 *
 * For OAuth2, use TokenManager instead.
 */
export class CredentialManager {
  constructor(
    private readonly storage: SecureStorage,
    private readonly dialog: CredentialDialog
  ) {}

  private credentialKey(appId: string): string {
    return `cred-${appId}`;
  }

  private async loadCredential(appId: string): Promise<StoredAuth | null> {
    const raw = await this.storage.get(this.credentialKey(appId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuth;
    } catch {
      return null;
    }
  }

  private async storeCredential(appId: string, cred: StoredAuth): Promise<void> {
    await this.storage.set(this.credentialKey(appId), JSON.stringify(cred));
  }

  /**
   * Get a valid credential for the app, prompting user if needed
   */
  async getCredential(descriptor: AaiJson): Promise<string> {
    if (!descriptor.auth) {
      throw new AaiError('AUTH_REQUIRED', `No auth config for ${descriptor.app.id}`);
    }

    const auth = descriptor.auth;
    const appId = descriptor.app.id;

    const locale = getSystemLocale();
    const appName = getLocalizedName(descriptor.app.name, locale, descriptor.app.defaultLang);

    switch (auth.type) {
      case 'apiKey':
        return this.getApiKeyCredential(appId, appName, auth);
      case 'cookie':
        return this.getCookieCredential(appId, appName, auth);
      case 'appCredential':
        return this.getAppCredentialToken(appId, appName, auth);
      default:
        throw new AaiError(
          'AUTH_REQUIRED',
          `Unsupported auth type: ${(auth as { type: string }).type}`
        );
    }
  }

  private async getApiKeyCredential(
    appId: string,
    appName: string,
    auth: ApiKeyAuth
  ): Promise<string> {
    const stored = await this.loadCredential(appId);

    if (stored && stored.type === 'apiKey' && stored.value) {
      return stored.value;
    }

    // Need to prompt user
    logger.info({ appId }, 'Prompting user for API key');

    const result = await this.dialog.show({
      authType: 'apiKey',
      appName,
      appId,
      instructions: auth.apiKey.instructions ?? {
        short: `Get your API key from ${auth.apiKey.obtainUrl}`,
        helpUrl: auth.apiKey.obtainUrl,
      },
      obtainUrl: auth.apiKey.obtainUrl,
      inputLabel: 'API Key',
      inputPlaceholder: 'Paste your API key here',
    });

    if (result.cancelled || !result.credential) {
      throw new AaiError('AUTH_DENIED', 'User cancelled API key input');
    }

    // Store for future use
    await this.storeCredential(appId, {
      type: 'apiKey',
      value: result.credential,
      createdAt: Date.now(),
    });

    return result.credential;
  }

  private async getCookieCredential(
    appId: string,
    appName: string,
    auth: CookieAuth
  ): Promise<string> {
    const stored = await this.loadCredential(appId);

    if (stored && stored.type === 'cookie' && stored.value) {
      return stored.value;
    }

    // Need to prompt user
    logger.info({ appId }, 'Prompting user for cookies');

    const cookieInstructions =
      auth.cookie.instructions ??
      `1. Login to ${appName} at ${auth.cookie.loginUrl}\n2. Open browser DevTools (F12)\n3. Go to Application > Cookies\n4. Copy the required cookies`;

    const result = await this.dialog.show({
      authType: 'cookie',
      appName,
      appId,
      instructions: {
        short: cookieInstructions,
        helpUrl: auth.cookie.loginUrl,
      },
      obtainUrl: auth.cookie.loginUrl,
      inputLabel: 'Cookies',
      inputPlaceholder: `e.g., ${auth.cookie.requiredCookies.join(', ')}`,
    });

    if (result.cancelled || !result.credential) {
      throw new AaiError('AUTH_DENIED', 'User cancelled cookie input');
    }

    // Store for future use
    await this.storeCredential(appId, {
      type: 'cookie',
      value: result.credential,
      createdAt: Date.now(),
    });

    return result.credential;
  }

  private async getAppCredentialToken(
    appId: string,
    appName: string,
    auth: AppCredentialAuth
  ): Promise<string> {
    const stored = await this.loadCredential(appId);

    // Check if we have valid cached token
    if (stored && stored.type === 'appCredential') {
      const hasToken = stored.accessToken && stored.expiresAt && Date.now() < stored.expiresAt;
      if (hasToken) {
        return stored.accessToken!;
      }

      // Try to refresh token using stored credentials
      if (stored.appId && stored.appSecret) {
        try {
          const token = await this.fetchAppCredentialToken(auth, stored.appId, stored.appSecret);

          // Update stored credential with new token
          await this.storeCredential(appId, {
            ...stored,
            accessToken: token,
            expiresAt: Date.now() + auth.appCredential.expiresIn * 1000,
          });

          return token;
        } catch (err) {
          logger.warn({ appId, err }, 'Failed to refresh app credential token');
          // Fall through to re-prompt
        }
      }
    }

    // Need to prompt user for app ID and secret
    logger.info({ appId }, 'Prompting user for app credentials');

    const result = await this.dialog.showForAppCredential({
      authType: 'appCredential',
      appName,
      appId,
      instructions: auth.appCredential.instructions ?? {
        short: `Get your App ID and App Secret from the developer console`,
        helpUrl: auth.appCredential.tokenEndpoint,
      },
      obtainUrl: auth.appCredential.tokenEndpoint,
    });

    if (result.cancelled || !result.appId || !result.appSecret) {
      throw new AaiError('AUTH_DENIED', 'User cancelled app credential input');
    }

    // Fetch token using app credentials
    const token = await this.fetchAppCredentialToken(auth, result.appId, result.appSecret);

    // Store credentials and token
    await this.storeCredential(appId, {
      type: 'appCredential',
      appId: result.appId,
      appSecret: result.appSecret,
      accessToken: token,
      expiresAt: Date.now() + auth.appCredential.expiresIn * 1000,
      createdAt: Date.now(),
    });

    return token;
  }

  private async fetchAppCredentialToken(
    auth: AppCredentialAuth,
    appId: string,
    appSecret: string
  ): Promise<string> {
    const { tokenEndpoint, tokenType } = auth.appCredential;

    const body: Record<string, string> = {
      app_id: appId,
      app_secret: appSecret,
    };

    // Some APIs use grant_type
    if (tokenType === 'tenantAccessToken') {
      body.grant_type = 'client_credential';
    }

    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AaiError('AUTH_DENIED', `Token fetch failed: HTTP ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      tenant_access_token?: string;
      app_access_token?: string;
      access_token?: string;
      expires_in?: number;
    };

    const token = data.tenant_access_token || data.app_access_token || data.access_token;
    if (!token) {
      throw new AaiError('AUTH_DENIED', 'No access token in response');
    }

    return token;
  }

  /**
   * Build authorization headers for HTTP requests
   */
  buildAuthHeaders(descriptor: AaiJson, credential: string): Record<string, string> {
    if (!descriptor.auth) {
      return {};
    }

    const auth = descriptor.auth;

    switch (auth.type) {
      case 'apiKey': {
        const { location, name, prefix } = auth.apiKey;
        const value = prefix ? `${prefix} ${credential}` : credential;

        if (location === 'header') {
          return { [name]: value };
        }
        // Query param handled by executor
        return {};
      }

      case 'cookie': {
        return { Cookie: credential };
      }

      case 'appCredential': {
        // Most app credential APIs use Bearer token
        return { Authorization: `Bearer ${credential}` };
      }

      case 'oauth2': {
        return { Authorization: `Bearer ${credential}` };
      }

      default:
        return {};
    }
  }

  /**
   * Clear stored credentials for an app
   */
  async clearCredentials(appId: string): Promise<void> {
    await this.storage.delete(this.credentialKey(appId));
  }
}
