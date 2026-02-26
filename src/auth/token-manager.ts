import { AaiError } from "../errors/errors.js";
import { startOAuthFlow } from "./oauth.js";
import type { SecureStorage } from "../storage/secure-storage/interface.js";
import type { AaiJson } from "../types/aai-json.js";

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type: string;
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
    const tokens = await this.loadTokens(appId);

    if (tokens) {
      const isExpired = Date.now() >= tokens.expires_at - EXPIRY_MARGIN_MS;

      if (!isExpired) {
        return tokens.access_token;
      }

      if (tokens.refresh_token && descriptor.auth) {
        try {
          const refreshed = await this.refreshToken(
            tokens.refresh_token,
            descriptor.auth.oauth2.token_endpoint
          );
          await this.storeTokens(appId, refreshed);
          return refreshed.access_token;
        } catch {
          // refresh failed — fall through to full OAuth flow
        }
      }
    }

    if (!descriptor.auth) {
      throw new AaiError("AUTH_REQUIRED", `No auth config in descriptor for ${appId}`);
    }

    const newTokens = await startOAuthFlow(descriptor);
    await this.storeTokens(appId, newTokens);
    return newTokens.access_token;
  }

  private async refreshToken(
    refreshToken: string,
    tokenEndpoint: string
  ): Promise<StoredTokens> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new AaiError("AUTH_EXPIRED", `Token refresh failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
      token_type: data.token_type ?? "Bearer",
    };
  }
}
