import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMarketDataCache } from "../../server/marketDataCache";

let directory;
const valid = value => !!value && typeof value.price === "number";
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "top5-market-cache-test-")); });
afterEach(async () => {
  vi.restoreAllMocks();
  // mkdtemp owns this exact directory, outside the repository and all credentials.
  await rm(directory, { recursive: true, force: true });
});
describe("public market file cache", () => {
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
