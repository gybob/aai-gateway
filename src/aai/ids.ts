import { createHash } from 'node:crypto';

import type { ImportedMcpSource, PrimitiveSummary } from './types.js';
import { slugifyIntegrationId } from '../gateway/managed-store.js';

export function createIntegrationId(source: ImportedMcpSource, preferredName?: string): string {
  if (preferredName) {
    return slugifyIntegrationId(preferredName);
  }

  if (source.name) {
    return slugifyIntegrationId(source.name);
  }

  if (source.kind === 'stdio' && source.command) {
    return slugifyIntegrationId(source.command);
  }

  if (source.url) {
    return slugifyIntegrationId(source.url);
  }

  return `integration-${shortHash(JSON.stringify(source))}`;
}

export function createRuntimeId(integrationId: string, protocol: string): string {
  return `${integrationId}-${protocol}`;
}

export function createPrimitiveRef(kind: PrimitiveSummary['kind'], stableKey: string): string {
  return `${kind}:${shortHash(stableKey)}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
