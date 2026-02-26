import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AaiJson } from "../types/aai-json.js";

const CACHE_DIR = join(homedir(), ".cache", "aai-gateway");
const TTL_SECONDS = 86400; // 24h

interface CacheMeta {
  fetched_at: string;
  ttl_seconds: number;
  source_url: string;
}

function hostDir(host: string): string {
  // sanitize host to safe directory name
  return join(CACHE_DIR, host.replace(/[^a-zA-Z0-9._-]/g, "_"));
}

export async function getDescriptorCache(host: string): Promise<AaiJson | null> {
  const dir = hostDir(host);
  try {
    const [raw, metaRaw] = await Promise.all([
      readFile(join(dir, "aai.json"), "utf-8"),
      readFile(join(dir, "aai.json.meta"), "utf-8"),
    ]);
    const meta: CacheMeta = JSON.parse(metaRaw);
    const age = (Date.now() - new Date(meta.fetched_at).getTime()) / 1000;
    if (age > meta.ttl_seconds) return null;
    return JSON.parse(raw) as AaiJson;
  } catch {
    return null;
  }
}

export async function setDescriptorCache(
  host: string,
  descriptor: AaiJson,
  sourceUrl: string
): Promise<void> {
  const dir = hostDir(host);
  await mkdir(dir, { recursive: true });
  const meta: CacheMeta = {
    fetched_at: new Date().toISOString(),
    ttl_seconds: TTL_SECONDS,
    source_url: sourceUrl,
  };
  await Promise.all([
    writeFile(join(dir, "aai.json"), JSON.stringify(descriptor), "utf-8"),
    writeFile(join(dir, "aai.json.meta"), JSON.stringify(meta), "utf-8"),
  ]);
}

export async function getStaleDescriptorCache(host: string): Promise<AaiJson | null> {
  const dir = hostDir(host);
  try {
    const raw = await readFile(join(dir, "aai.json"), "utf-8");
    return JSON.parse(raw) as AaiJson;
  } catch {
    return null;
  }
}
