import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { inFlightKey, shareInFlight } from "./inFlight";

declare const process: { cwd(): string };
export type CacheEntry<T> = { builtAt: number; data: T };

/** Only public market payloads are persisted; keys contain hashed scopes, never credentials. */
export function createMarketDataCache<T>(name: string, validate: (value: unknown) => value is T, directory?: string, maxAgeMs = 14 * 86_400_000, normalize: (value: T, builtAt: number) => T = value => value) {
  const memory = new Map<string, CacheEntry<T>>(), pending = new Map<string, Promise<T>>();
  const reads = new Map<string, Promise<CacheEntry<T> | null>>();
  const failedAt = new Map<string, number>();
  const root = () => directory ?? join(process.cwd(), "server", "cache", "market-v1");
  const path = (key: string) => join(root(), `${name}-${inFlightKey([key])}.json`);
  async function read(key: string, persistent = false): Promise<CacheEntry<T> | null> {
    const existing = memory.get(key);
    if (existing && Date.now() - existing.builtAt <= maxAgeMs) return structuredClone(existing);
    if (existing) memory.delete(key);
    if (!persistent) return null;
    let reading = reads.get(key);
    if (!reading) {
      reading = (async () => {
        try {
          const text = await readFile(path(key), "utf8");
          if (text.length > 8_000_000) return null;
          const parsed = JSON.parse(text);
          if (parsed.version !== 2 || !Number.isFinite(parsed.builtAt) || parsed.builtAt <= 0 || parsed.builtAt > Date.now() + 60_000 || Date.now() - parsed.builtAt > maxAgeMs || !validate(parsed.data)) return null;
          // Repair legacy payload order without changing freshness or writing to disk.
          const entry: CacheEntry<T> = { builtAt: parsed.builtAt, data: normalize(parsed.data, parsed.builtAt) };
          memory.set(key, entry);
          return entry;
        } catch { return null; }
      })();
      reads.set(key, reading);
      void reading.finally(() => reads.delete(key));
    }
    const entry = await reading;
    return entry ? structuredClone(entry) : null;
  }
  async function write(key: string, data: T, persistent = false): Promise<T> {
    if (!validate(data)) throw new Error("Invalid market cache value.");
    const builtAt = Date.now();
    const entry = { builtAt, data: normalize(structuredClone(data), builtAt) };
    memory.set(key, entry); failedAt.delete(key);
    if (persistent) {
      try {
        await mkdir(root(), { recursive: true });
        const temporary = `${path(key)}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: 2, ...entry }), "utf8");
        await rename(temporary, path(key));
      } catch { /* Read-only filesystems retain the successful in-memory observation. */ }
    }
    return structuredClone(entry.data);
  }
  async function refresh(key: string, load: () => Promise<T>, persistent = false): Promise<T> {
    return shareInFlight(pending, key, async () => {
      try { return await write(key, await load(), persistent); }
      catch (error) { failedAt.set(key, Date.now()); throw error; }
    });
  }
  function revalidate(key: string, load: () => Promise<T>, persistent = false): void {
    // Failure backoff avoids retrying upstream on every stale cache hit.
    if (Date.now() - (failedAt.get(key) ?? -Infinity) < 30_000) return;
    void refresh(key, load, persistent).catch(() => {});
  }
  return { read, write, refresh, revalidate };
}
