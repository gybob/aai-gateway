import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

import { logger } from '../utils/logger.js';
import type { WebAuth } from '../parsers/schema.js';

export interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type?: string;
}

export class TokenManager {
  private tokensDir: string;
  private tokens: Map<string, TokenData> = new Map();

  constructor() {
    this.tokensDir = join(homedir(), '.aai', 'tokens');
  }

  async init(): Promise<void> {
    if (!existsSync(this.tokensDir)) {
      await mkdir(this.tokensDir, { recursive: true });
      logger.debug({ path: this.tokensDir }, 'Tokens directory created');
    }
  }

  async getToken(appId: string): Promise<TokenData | null> {
    if (this.tokens.has(appId)) {
      return this.tokens.get(appId)!;
    }

    const tokenPath = join(this.tokensDir, `${appId}.json`);
    if (!existsSync(tokenPath)) {
      return null;
    }

    try {
      const content = await readFile(tokenPath, 'utf-8');
      const data = JSON.parse(content) as TokenData;
      this.tokens.set(appId, data);
      return data;
    } catch (error) {
      logger.warn({ appId, error }, 'Failed to read token file');
      return null;
    }
  }

  async saveToken(appId: string, tokenData: TokenData): Promise<void> {
    this.tokens.set(appId, tokenData);
    const tokenPath = join(this.tokensDir, `${appId}.json`);

    try {
      await mkdir(dirname(tokenPath), { recursive: true });
      await writeFile(tokenPath, JSON.stringify(tokenData, null, 2), 'utf-8');
      logger.debug({ appId }, 'Token saved');
    } catch (error) {
      logger.error({ appId, error }, 'Failed to save token');
      throw error;
    }
  }

  async deleteToken(appId: string): Promise<void> {
    this.tokens.delete(appId);
    const tokenPath = join(this.tokensDir, `${appId}.json`);

    try {
      await writeFile(tokenPath, '', 'utf-8');
      logger.debug({ appId }, 'Token deleted');
    } catch (error) {
      logger.warn({ appId, error }, 'Failed to delete token');
    }
  }

  isExpired(token: TokenData): boolean {
    const now = Date.now();
    const expires = token.expires_at;
    return now >= expires - 60000;
  }

  async resolveAuth(appId: string, authConfig: WebAuth): Promise<{ header?: string; query?: Record<string, string> } | null> {
    await this.init();

    if (authConfig.type === 'api_key') {
      const apiKey = process.env[authConfig.env_var];
      if (!apiKey) {
        logger.warn({ appId, envVar: authConfig.env_var }, 'API key not found in environment');
        return null;
      }

      if (authConfig.key_placement === 'header') {
        return { header: `${authConfig.key_name}: ${apiKey}` };
      } else {
        return { query: { [authConfig.key_name]: apiKey } };
      }
    }

    if (authConfig.type === 'bearer') {
      const bearerToken = process.env[authConfig.env_var];
      if (!bearerToken) {
        logger.warn({ appId, envVar: authConfig.env_var }, 'Bearer token not found in environment');
        return null;
      }

      if (authConfig.token_placement === 'header') {
        return { header: `${authConfig.token_prefix} ${bearerToken}` };
      } else {
        return { query: { access_token: bearerToken } };
      }
    }

    if (authConfig.type === 'oauth2') {
      const token = await this.getToken(appId);
      if (!token) {
        return null;
      }

      if (this.isExpired(token) && token.refresh_token) {
        logger.info({ appId }, 'Token expired, attempting refresh');
        return null;
      }

      if (this.isExpired(token)) {
        logger.warn({ appId }, 'Token expired and no refresh token available');
        await this.deleteToken(appId);
        return null;
      }

      const tokenValue = token.token_type === 'bearer' ? `${authConfig.token_prefix} ${token.access_token}` : token.access_token;

      if (authConfig.token_placement === 'header') {
        return { header: tokenValue };
      } else {
        return { query: { access_token: token.access_token } };
      }
    }

    return null;
  }
}
