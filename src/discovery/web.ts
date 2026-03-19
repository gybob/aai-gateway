import { AaiError } from '../errors/errors.js';
import { parseAaiJson } from '../parsers/schema.js';
import {
  getDescriptorCache,
  getStaleDescriptorCache,
  setDescriptorCache,
} from '../storage/descriptor-cache.js';
import type { AaiJson } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';

const FETCH_TIMEOUT_MS = 10_000;

export async function fetchWebDescriptor(url: string): Promise<AaiJson> {
  const normalizedUrl = normalizeUrl(url);
  const { hostname } = new URL(normalizedUrl);
  const cached = await getDescriptorCache(hostname);
  if (cached) {
    return cached;
  }

  const aaiUrl = `${normalizedUrl.replace(/\/$/, '')}/.well-known/aai.json`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(aaiUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new AaiError('SERVICE_UNAVAILABLE', `Failed to fetch ${aaiUrl}: HTTP ${response.status}`);
    }

    const descriptor = parseAaiJson(await response.json());
    await setDescriptorCache(hostname, descriptor, aaiUrl);
    return descriptor;
  } catch (err) {
    const stale = await getStaleDescriptorCache(hostname);
    if (stale) {
      logger.warn({ url: normalizedUrl, err }, 'Using stale cached web descriptor');
      return stale;
    }

    if (AaiError.isAaiError(err)) {
      throw err;
    }

    throw new AaiError(
      'SERVICE_UNAVAILABLE',
      `Failed to fetch descriptor for ${normalizedUrl}: ${String(err)}`
    );
  }
}

export function normalizeUrl(input: string): string {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return input;
  }

  return `https://${input}`;
}
