import { createServer } from 'http';
import { randomBytes } from 'crypto';

import { logger } from '../utils/logger.js';
import type { WebAuth } from '../parsers/schema.js';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export class OAuthFlowHandler {
  private readonly timeoutMs = 120000;

  async executeOAuthFlow(appId: string, authConfig: WebAuth): Promise<TokenResponse> {
    if (authConfig.type !== 'oauth2') {
      throw new Error('Auth config is not OAuth2 type');
    }

    const clientIdEnv = `AAI_${appId.toUpperCase().replace(/\./g, '_')}_CLIENT_ID`;
    const clientSecretEnv = `AAI_${appId.toUpperCase().replace(/\./g, '_')}_CLIENT_SECRET`;

    const clientId = process.env[clientIdEnv];
    const clientSecret = process.env[clientSecretEnv];

    if (!clientId || !clientSecret) {
      throw new Error(
        `OAuth credentials not found. Please set ${clientIdEnv} and ${clientSecretEnv} environment variables.`
      );
    }

    const port = this.getRandomPort();
    const redirectUri = `http://localhost:${port}/callback`;
    const state = randomBytes(16).toString('hex');

    logger.info({ appId, clientId, redirectUri }, 'Starting OAuth flow');

    const authUrl = this.buildAuthUrl(authConfig.auth_url, clientId, redirectUri, state, authConfig.scopes);

    const tokenPromise = this.waitForCallback(port, state);
    await this.openBrowser(authUrl);

    const { code, returnedState } = await tokenPromise;

    if (returnedState !== state) {
      throw new Error('OAuth state mismatch - possible CSRF attack');
    }

    return this.exchangeCodeForToken(authConfig.token_url, clientId, clientSecret, code, redirectUri);
  }

  private buildAuthUrl(
    baseUrl: string,
    clientId: string,
    redirectUri: string,
    state: string,
    scopes?: string[]
  ): string {
    const url = new URL(baseUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);

    if (scopes && scopes.length > 0) {
      url.searchParams.set('scope', scopes.join(' '));
    }

    return url.toString();
  }

  private waitForCallback(
    port: number,
    _expectedState: string
  ): Promise<{ code: string; returnedState: string }> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url || '', `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Authorization Failed</title></head>
              <body>
                <h1>Authorization Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          reject(new Error(`OAuth error: ${error}`));
          server.close();
          return;
        }

        if (code && state) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Authorization Success</title></head>
              <body>
                <h1>Authorization Successful</h1>
                <p>You can close this window and return to your terminal.</p>
              </body>
            </html>
          `);
          server.close();
          resolve({ code, returnedState: state });
        }
      });

      server.listen(port, () => {
        logger.debug({ port }, 'OAuth callback server listening');
      });

      setTimeout(() => {
        server.close();
        reject(new Error('OAuth flow timed out'));
      }, this.timeoutMs);
    });
  }

  private async exchangeCodeForToken(
    tokenUrl: string,
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ): Promise<TokenResponse> {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as TokenResponse;

    return data;
  }

  private getRandomPort(): number {
    return Math.floor(Math.random() * 10000) + 30000;
  }

  private async openBrowser(url: string): Promise<void> {
    const { spawn } = await import('child_process');

    let command: string;
    let args: string[];

    const platform = process.platform;

    if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    logger.debug({ command, args }, 'Browser opened');
  }
}
