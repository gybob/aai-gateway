import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const CACHE_FILE = join(homedir(), ".config", "aai-gateway", "name-cache.json");

type NameCache = Record<string, string>;

async function load(): Promise<NameCache> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as NameCache;
  } catch {
    return {};
  }
}

async function save(cache: NameCache): Promise<void> {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

export async function lookupName(name: string): Promise<string | null> {
  const cache = await load();
  return cache[name] ?? null;
}

export async function saveName(name: string, url: string): Promise<void> {
  const cache = await load();
  cache[name] = url;
  await save(cache);
}
