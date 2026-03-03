import { parseAaiJson } from '../parsers/schema.js';
import { AaiError } from '../errors/errors.js';
import {
  getDescriptorCache,
  setDescriptorCache,
  getStaleDescriptorCache,
} from '../storage/descriptor-cache.js';
import { logger } from '../utils/logger.js';
import type { AaiJson } from '../types/aai-json.js';
import { lookupWebAppRegistry } from './web-registry.js';

const FETCH_TIMEOUT_MS = 10_000;

export async function fetchWebDescriptor(url: string): Promise<AaiJson> {
  // First, check built-in registry
  const registryDescriptor = lookupWebAppRegistry(url);
  if (registryDescriptor) {
    logger.debug({ url }, 'Using built-in web app descriptor');
    return registryDescriptor;
  }

  const { hostname: host } = new URL(url);
  const cached = await getDescriptorCache(host);
  if (cached) return cached;

  const aaiUrl = `${url.replace(/\/$/, '')}/.well-known/aai.json`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(aaiUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new AaiError('SERVICE_UNAVAILABLE', `Failed to fetch ${aaiUrl}: HTTP ${res.status}`);
    }

    const raw = await res.json();
    // Try to parse, but fall back to registry if schema differs
    try {
      const descriptor = parseAaiJson(raw);
      await setDescriptorCache(host, descriptor, aaiUrl);
      return descriptor;
    } catch (parseErr) {
      logger.warn({ host, err: parseErr }, 'Failed to parse remote descriptor, checking registry');
      const registryFallback = lookupWebAppRegistry(host);
      if (registryFallback) {
        return registryFallback;
      }
      throw parseErr;
    }
  } catch (err) {
    if (AaiError.isAaiError(err)) {
      // On network error, fall back to stale cache
      const stale = await getStaleDescriptorCache(host);
      if (stale) {
        logger.warn({ host, err }, 'Using stale descriptor cache after fetch failure');
        return stale;
      }
      throw err;
    }
    // AbortError or network error
    const stale = await getStaleDescriptorCache(host);
    if (stale) {
      logger.warn({ host }, 'Using stale descriptor cache after fetch timeout/error');
      return stale;
    }
    throw new AaiError(
      'SERVICE_UNAVAILABLE',
      `Failed to fetch descriptor for ${url}: ${String(err)}`
    );
  }
}
