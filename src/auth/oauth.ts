import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AaiError } from '../errors/errors.js';
import type { AaiJson } from '../types/aai-json.js';

const execFileAsync = promisify(execFile);

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function getRedirectPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      server.close(() => resolve(addr.port));
    });
  });
}

function waitForCallback(port: number, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Authorization complete. You may close this tab.</h2></body></html>');

      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const code = url.searchParams.get('code');
      if (code) {
        server.close();
        resolve(code);
      } else {
        server.close();
        reject(new AaiError('AUTH_DENIED', 'No code in OAuth callback'));
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new AaiError('TIMEOUT', 'OAuth callback timed out'));
    }, timeoutMs);

    server.listen(port, '127.0.0.1');
    server.once('close', () => clearTimeout(timer));
  });
}

export async function startOAuthFlow(descriptor: AaiJson): Promise<TokenResponse> {
  if (!descriptor.auth) {
    throw new AaiError('AUTH_REQUIRED', 'Descriptor has no auth configuration');
  }

  if (descriptor.auth.type !== 'oauth2') {
    throw new AaiError('AUTH_REQUIRED', 'Descriptor auth is not OAuth2');
  }

  const { authorizationEndpoint, tokenEndpoint, scopes } = descriptor.auth.oauth2;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const port = await getRedirectPort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('scope', scopes.join(' '));

  // open browser
  try {
    await execFileAsync('open', [authUrl.toString()]);
  } catch {
    throw new AaiError(
      'INTERNAL_ERROR',
      `Failed to open browser for OAuth. Visit: ${authUrl.toString()}`
    );
  }

  const code = await waitForCallback(port);

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AaiError('AUTH_DENIED', `Token exchange failed: HTTP ${res.status}: ${body}`);
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
