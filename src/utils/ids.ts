import { createHash } from 'node:crypto';

export function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'app';
}

export function deriveLocalId(seed: string, fallback = 'app'): string {
  const slug = slugify(seed) || fallback;
  const hash = createHash('sha1').update(seed).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}
