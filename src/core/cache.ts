import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root of Graveyard Shift itself (two levels above src/core). */
export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Read-write cache for registry, advisory and repo lookups. */
export const CACHE_DIR = process.env.GRAVEYARD_CACHE ?? path.join(homedir(), '.cache', 'graveyard-shift');

/** Read-only snapshot shipped in the repo so the demo works with no network. */
export const FIXTURE_CACHE_DIR = path.join(TOOL_ROOT, 'fixtures', 'cache');

export function isOffline(): boolean {
  return process.env.GRAVEYARD_OFFLINE === '1';
}

interface Entry<T> {
  storedAt: number;
  value: T;
}

export function keyFile(dir: string, namespace: string, key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 80);
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 10);
  return path.join(dir, namespace, `${safe}-${hash}.json`);
}

async function readEntry<T>(file: string): Promise<Entry<T> | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Entry<T>;
  } catch {
    return undefined;
  }
}

/**
 * Returns a cached value, or calls `load` and stores the result.
 * Offline mode never calls `load`; it falls back to the shipped fixture cache.
 */
export async function cached<T>(
  namespace: string,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const file = keyFile(CACHE_DIR, namespace, key);
  const hit = await readEntry<T>(file);
  if (hit && (isOffline() || Date.now() - hit.storedAt < ttlMs)) return hit.value;

  if (isOffline()) {
    const fixture = await readEntry<T>(keyFile(FIXTURE_CACHE_DIR, namespace, key));
    if (fixture) return fixture.value;
    throw new Error(`offline and no cached ${namespace} data for ${key}`);
  }

  try {
    const value = await load();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ storedAt: Date.now(), value } satisfies Entry<T>));
    return value;
  } catch (err) {
    // Network trouble: a stale entry or the shipped snapshot beats nothing.
    if (hit) return hit.value;
    const fixture = await readEntry<T>(keyFile(FIXTURE_CACHE_DIR, namespace, key));
    if (fixture) return fixture.value;
    throw err;
  }
}

/** A cached value if one is fresh (or, offline, any cached or shipped value); never loads. */
export async function peek<T>(namespace: string, key: string, ttlMs: number): Promise<T | undefined> {
  const hit = await readEntry<T>(keyFile(CACHE_DIR, namespace, key));
  if (hit && (isOffline() || Date.now() - hit.storedAt < ttlMs)) return hit.value;
  if (isOffline()) return (await readEntry<T>(keyFile(FIXTURE_CACHE_DIR, namespace, key)))?.value;
  return undefined;
}

export async function store<T>(namespace: string, key: string, value: T): Promise<void> {
  const file = keyFile(CACHE_DIR, namespace, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ storedAt: Date.now(), value } satisfies Entry<T>));
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': 'graveyard-shift', accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText} for ${url}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

/** Runs async work with a concurrency cap, keeping input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
