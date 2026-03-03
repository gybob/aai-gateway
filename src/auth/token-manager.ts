import { AaiError } from '../errors/errors.js';
import { startOAuthFlow } from './oauth.js';
import type { SecureStorage } from '../storage/secure-storage/interface.js';
import type { AaiJson } from '../types/aai-json.js';

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
}

function accountKey(appId: string): string {
  return `token-${appId}`;
}

const EXPIRY_MARGIN_MS = 60_000; // refresh 60s before expiry

export class TokenManager {
  constructor(private readonly storage: SecureStorage) {}

  async storeTokens(appId: string, tokens: StoredTokens): Promise<void> {
    await this.storage.set(accountKey(appId), JSON.stringify(tokens));
  }

  private async loadTokens(appId: string): Promise<StoredTokens | null> {
    const raw = await this.storage.get(accountKey(appId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredTokens;
    } catch {
      return null;
    }
  }

  async getValidToken(appId: string, descriptor: AaiJson): Promise<string> {
    // Only handle OAuth2 auth type
    if (descriptor.auth && descriptor.auth.type !== 'oauth2') {
      throw new AaiError(
        'AUTH_REQUIRED',
        `TokenManager only supports OAuth2 auth, got: ${descriptor.auth.type}`
      );
    }

    const tokens = await this.loadTokens(appId);

    if (tokens) {
      const isExpired = Date.now() >= tokens.expiresAt - EXPIRY_MARGIN_MS;

      if (!isExpired) {
        return tokens.accessToken;
      }

      if (tokens.refreshToken && descriptor.auth?.type === 'oauth2') {
        try {
          const refreshed = await this.refreshToken(
            tokens.refreshToken,
            descriptor.auth.oauth2.tokenEndpoint
          );
          await this.storeTokens(appId, refreshed);
          return refreshed.accessToken;
        } catch {
          // refresh failed — fall through to full OAuth flow
        }
      }
    }

    if (!descriptor.auth) {
      throw new AaiError('AUTH_REQUIRED', `No auth config in descriptor for ${appId}`);
    }

    const newTokens = await startOAuthFlow(descriptor);
    await this.storeTokens(appId, newTokens);
    return newTokens.accessToken;
  }

  private async refreshToken(refreshToken: string, tokenEndpoint: string): Promise<StoredTokens> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new AaiError('AUTH_EXPIRED', `Token refresh failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      tokenType: data.token_type ?? 'Bearer',
    };
  }
}
