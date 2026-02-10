import { connect } from 'tls';

import { logger } from '../utils/logger.js';

export interface AuthPromptInfo {
  appId: string;
  domain: string;
  sslValid?: boolean;
  scopes?: string[];
}

export function formatAuthPrompt(info: AuthPromptInfo): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`Authorization Required: ${info.appId}`);
  lines.push('━'.repeat(50));
  lines.push('');
  lines.push(`Domain: ${info.domain}`);

  if (info.sslValid !== undefined) {
    const status = info.sslValid ? '✓ Valid' : '⚠ Invalid';
    lines.push(`SSL Certificate: ${status}`);
  }

  if (info.scopes && info.scopes.length > 0) {
    lines.push('');
    lines.push('Requested Permissions:');
    info.scopes.forEach((scope) => {
      lines.push(`  • ${scope}`);
    });
  }

  lines.push('');
  lines.push('To authorize, run: aai-gateway authorize <appId>');
  lines.push('');

  return lines.join('\n');
}

export function checkSSL(hostname: string, port: number = 443): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(
      { host: hostname, port, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();

        if (!cert) {
          logger.warn({ hostname }, 'No certificate found');
          resolve(false);
          return;
        }

        const now = new Date();
        const validTo = new Date(cert.valid_to);

        const isValid = cert.valid_to !== undefined && validTo > now;
        logger.debug({ hostname, validTo, isValid }, 'SSL certificate checked');

        resolve(isValid);
      }
    );

    socket.on('error', (error) => {
      logger.warn({ hostname, error }, 'SSL check failed');
      resolve(false);
    });

    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 5000);
  });
}
