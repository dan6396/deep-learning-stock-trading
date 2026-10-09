import { afterEach, describe, expect, it, vi } from "vitest";
import { createWatchlistStore, sanitizeWatchlist, WATCHLIST_KEY } from "./watchlist";

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });
describe("watchlist persistence boundaries", () => {
  it("sanitizes, deduplicates and does not seed absent or deliberately empty lists", () => {
    expect(sanitizeWatchlist([" 005930 ", "005930", "000000", "123", 5930, null, "000660", "abcdef"])).toEqual(["005930", "000660"]);
    expect(createWatchlistStore().getSnapshot().codes).toEqual([]);
    localStorage.setItem(WATCHLIST_KEY, "[]");
    expect(createWatchlistStore().getSnapshot().codes).toEqual([]);
  });
  it("keeps the legacy string-array key and survives a new store/reload", () => {
    const store = createWatchlistStore(); store.toggle("005930"); store.toggle("999999"); store.toggle("000000");
    expect(JSON.parse(localStorage.getItem(WATCHLIST_KEY)!)).toEqual(["005930", "999999"]);
    expect(createWatchlistStore().getSnapshot().codes).toEqual(["005930", "999999"]);
    store.toggle("005930"); store.toggle("999999");
    expect(createWatchlistStore().getSnapshot().codes).toEqual([]);
  });
  it("keeps session-only changes and notifies all subscribers when saving fails", () => {
    const storage = { getItem: () => '["005930"]', setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
    const store = createWatchlistStore(() => storage), listener = vi.fn(), unsubscribe = store.subscribe(listener);
    store.toggle("000660"); expect(store.getSnapshot()).toEqual({ codes: ["005930", "000660"], sessionOnly: true });
    expect(listener).toHaveBeenCalledOnce(); unsubscribe();
  });
  it("synchronizes cross-tab localStorage updates, newValue [] and localStorage.clear", () => {
    const store = createWatchlistStore(), unsubscribe = store.subscribe(() => {});
    window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: '["005930","005930","999999"]', storageArea: localStorage }));
    expect(store.getSnapshot().codes).toEqual(["005930", "999999"]);
    window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: "[]", storageArea: localStorage }));
    expect(store.getSnapshot().codes).toEqual([]);
    store.toggle("005930"); window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null, storageArea: localStorage }));
    expect(store.getSnapshot().codes).toEqual([]); unsubscribe();
  });
  it("ignores sessionStorage with the same key but allows synthetic null storageArea", () => {
    const store = createWatchlistStore(), unsubscribe = store.subscribe(() => {}); store.toggle("005930");
    window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: '["000660"]', storageArea: sessionStorage }));
    expect(store.getSnapshot().codes).toEqual(["005930"]);
    window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: '["000660"]' }));
    expect(store.getSnapshot().codes).toEqual(["000660"]); unsubscribe();
  });
  it("fails safely when storage access is denied, including event identity lookup", () => {
    const store = createWatchlistStore(() => { throw new DOMException("denied", "SecurityError"); }), unsubscribe = store.subscribe(() => {});
    store.toggle("005930"); expect(store.getSnapshot()).toEqual({ codes: ["005930"], sessionOnly: true });
    window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: "[]", storageArea: localStorage }));
    expect(store.getSnapshot().codes).toEqual(["005930"]); unsubscribe();
  });
});
