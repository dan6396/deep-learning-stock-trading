import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMarketDataCache } from "../../server/marketDataCache";
import { normalizeRawPrices } from "../../server/chartNormalization";

let directory;
const valid = value => !!value && typeof value.price === "number";
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "top5-market-cache-test-")); });
afterEach(async () => {
  vi.restoreAllMocks();
  // mkdtemp owns this exact directory, outside the repository and all credentials.
  await rm(directory, { recursive: true, force: true });
});
describe("public market file cache", () => {
  it("normalizes disk hydration and writes once, preserving freshness and avoiding memory-hit work", async () => {
    const normalize = vi.fn(value => ({ ...value, rawPrices: normalizeRawPrices(value.rawPrices) }));
    const legacy = createMarketDataCache("fixture", valid, directory);
    const rows = [{ date: "2026-10-23", price: 100 }, { date: "2026-10-22", price: 99 }, { date: "2026-10-26", price: 101 }];
    await legacy.write("symbol", { price: 101, rawPrices: rows }, true);
    const file = join(directory, (await readdir(directory))[0]), original = await readFile(file, "utf8");
    const builtAt = JSON.parse(original).builtAt;
    const expected = ["2026-10-22", "2026-10-23", "2026-10-26"];
    const restarted = createMarketDataCache("fixture", valid, directory, undefined, normalize);
    const restored = await restarted.read("symbol", true);
    expect(restored.data.rawPrices.map(row => row.date)).toEqual(expected);
    expect(restored.builtAt).toBe(builtAt);
    expect(await readFile(file, "utf8")).toBe(original);
    await restarted.read("symbol"); await restarted.read("symbol", true);
    expect(normalize).toHaveBeenCalledTimes(1);
    await restarted.write("symbol", { price: 101, rawPrices: rows });
    expect((await restarted.read("symbol")).data.rawPrices.map(row => row.date)).toEqual(expected);
    expect(normalize).toHaveBeenCalledTimes(2);
    await restarted.refresh("symbol", async () => ({ price: 101, rawPrices: rows }));
    await restarted.read("symbol");
    expect(normalize).toHaveBeenCalledTimes(3);
  });
  it("ignores observations older than fourteen days in memory and on disk, then recollects", async () => {
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    const cache = createMarketDataCache("fixture", valid, directory);
    await cache.write("symbol", { price: 100 }, true);
    now += 14 * 86_400_000; expect(await cache.read("symbol", true)).not.toBeNull();
    now++; expect(await cache.read("symbol", true)).toBeNull();
    const restarted = createMarketDataCache("fixture", valid, directory); expect(await restarted.read("symbol", true)).toBeNull();
    const load = vi.fn(async () => ({ price: 101 })); await restarted.refresh("symbol", load, true);
    expect(load).toHaveBeenCalledOnce(); expect((await restarted.read("symbol", true)).data.price).toBe(101);
  });
  it("persists atomically, hydrates a fresh process cache and isolates returned values", async () => {
    const first = createMarketDataCache("fixture", valid, directory);
    await first.write("scope-005930", { price: 100 }, true);
    const files = await readdir(directory);
    expect(files).toHaveLength(1); expect(files[0]).toMatch(/^fixture-[a-f0-9]{64}\.json$/);
    expect(JSON.parse(await readFile(join(directory, files[0]), "utf8"))).toMatchObject({ version: 2, data: { price: 100 } });
    const restarted = createMarketDataCache("fixture", valid, directory);
    const loaded = await restarted.read("scope-005930", true); loaded.data.price = 999;
    expect((await restarted.read("scope-005930", true)).data.price).toBe(100);
    expect(await restarted.read("other-scope", true)).toBeNull();
  });
  it.each(["{broken", JSON.stringify({ version: 2, builtAt: Date.now(), data: { price: "bad" } }), JSON.stringify({ version: 1, builtAt: Date.now(), data: { price: 100 } })])("recollects a corrupted or obsolete file", async corrupt => {
    const first = createMarketDataCache("fixture", valid, directory);
    await first.write("symbol", { price: 100 }, true);
    await writeFile(join(directory, (await readdir(directory))[0]), corrupt, "utf8");
    const restarted = createMarketDataCache("fixture", valid, directory);
    expect(await restarted.read("symbol", true)).toBeNull();
    await restarted.refresh("symbol", async () => ({ price: 101 }), true);
    expect((await createMarketDataCache("fixture", valid, directory).read("symbol", true)).data.price).toBe(101);
  });
  it("deduplicates refreshes, serves old values during refresh, and retains them on failure with backoff", async () => {
    const cache = createMarketDataCache("fixture", valid, directory);
    let now = Date.now(), reject;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await cache.write("symbol", { price: 100 });
    const first = await cache.read("symbol");
    const load = vi.fn(() => new Promise((_resolve, fail) => { reject = fail; }));
    cache.revalidate("symbol", load); cache.revalidate("symbol", load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(await cache.read("symbol")).toEqual(first);
    const pending = cache.refresh("symbol", load);
    reject(new Error("fixture unavailable")); await expect(pending).rejects.toThrow("fixture unavailable");
    cache.revalidate("symbol", load); expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.read("symbol")).toEqual(first);
    now += 30_001;
    const recovered = vi.fn(async () => ({ price: 102 })); cache.revalidate("symbol", recovered);
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledOnce());
    await vi.waitFor(async () => expect((await cache.read("symbol")).data.price).toBe(102));
  });
});
