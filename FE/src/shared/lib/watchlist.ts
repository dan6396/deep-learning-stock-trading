import { useSyncExternalStore } from "react";

export const WATCHLIST_KEY = "kospi-watchlist.v1";
export function sanitizeWatchlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((code): code is string => typeof code === "string").map(code => code.trim()).filter(code => /^\d{6}$/.test(code) && code !== "000000"))];
}
function decode(value: string | null): string[] { try { return sanitizeWatchlist(JSON.parse(value ?? "[]")); } catch { return []; } }
type Snapshot = { codes: readonly string[]; sessionOnly: boolean };
const empty: Snapshot = { codes: [], sessionOnly: false };

/** Same-tab subscribers share memory; storage events reconcile changes from other tabs. */
export function createWatchlistStore(storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage, events: Pick<Window, "addEventListener" | "removeEventListener"> | null = typeof window === "undefined" ? null : window) {
  let snapshot: Snapshot | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const getSnapshot = () => {
    if (!snapshot) { try { snapshot = { codes: decode(storage().getItem(WATCHLIST_KEY)), sessionOnly: false }; } catch { snapshot = { codes: [], sessionOnly: true }; } }
    return snapshot;
  };
  const receive = (event: Event) => {
    const change = event as StorageEvent;
    try { if (change.storageArea !== null && change.storageArea !== undefined && change.storageArea !== storage()) return; } catch { return; }
    if (change.key === WATCHLIST_KEY || change.key === null) publish({ codes: decode(change.key === null ? null : change.newValue), sessionOnly: false });
  };
  return {
    getSnapshot,
    getServerSnapshot: () => empty,
    subscribe(listener: () => void) {
      if (!listeners.size) events?.addEventListener("storage", receive);
      listeners.add(listener);
      return () => { listeners.delete(listener); if (!listeners.size) events?.removeEventListener("storage", receive); };
    },
    toggle(code: string) {
      if (sanitizeWatchlist([code])[0] !== code) return;
      const current = getSnapshot(), codes = current.codes.includes(code) ? current.codes.filter(item => item !== code) : [...current.codes, code];
      let sessionOnly = false;
      try { storage().setItem(WATCHLIST_KEY, JSON.stringify(codes)); } catch { sessionOnly = true; }
      publish({ codes, sessionOnly });
    },
  };
}
export const watchlistStore = createWatchlistStore();
export function useWatchlist() {
  return { ...useSyncExternalStore(watchlistStore.subscribe, watchlistStore.getSnapshot, watchlistStore.getServerSnapshot), toggle: watchlistStore.toggle };
}
