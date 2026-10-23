import { shareInFlight } from "./inFlight";

export type KisReadOptions = { backgroundKis?: boolean; kisWaitMs?: number };

/** Stale values survive refresh failures; cold readers have a bounded wait. */
export function createRevalidatingCache<T>(now = Date.now) {
  const values = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, Promise<T>>();
  return async (key: string, load: () => Promise<T>, fallback: () => T, usable: (value: T) => boolean,
    ttlMs: number | (() => number), options: KisReadOptions = {}): Promise<T> => {
    const cached = values.get(key);
    if (cached && now() < cached.expires) return structuredClone(cached.value);
    const refresh = shareInFlight(pending, key, async () => {
      let observed: T;
      try { observed = await load(); } catch { observed = fallback(); }
      const okay = usable(observed), value = okay ? observed : cached?.value ?? observed;
      values.set(key, { value, expires: now() + (okay ? typeof ttlMs === "function" ? ttlMs() : ttlMs : 60_000) });
      return value;
    });
    if (!options.backgroundKis) return refresh;
    if (cached) return structuredClone(cached.value);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([refresh, new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback()), Math.max(0, Math.min(1500, options.kisWaitMs ?? 1500)));
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
}
