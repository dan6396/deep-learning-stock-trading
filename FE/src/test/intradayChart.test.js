import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeIntradayChartRange, normalizeStockChartBundle } from "../../server/chartNormalization";
import { adaptChart } from "../entities/market";
import { validatedChart } from "../features/stock/reportData";
import { jsonResponse } from "./dataFixtures";

const files = vi.hoisted(() => ({ chart: null }));
vi.mock("node:fs/promises", () => { const mocks = {
  readFile: vi.fn(async path => {
    if (String(path).includes("chart-") && files.chart) return JSON.stringify(files.chart);
    throw new Error("No fixture file");
  }),
  writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}), rename: vi.fn(async () => {}),
}; return { ...mocks, default: mocks }; });
vi.mock("../../server/kisRateLimit", () => ({ kisRequestLimiter: { take: vi.fn(async () => {}) }, kisMaxRps: () => 5, kisRequestMetrics: {} }));

const now = Date.parse("2026-10-27T13:01:00+09:00");
const time = (hhmm, day = "2026-10-27") => `${day}T${hhmm}:00+09:00`;
const point = (hhmm, close = 100, day) => ({ time: time(hhmm, day), rawTime: time(hhmm, day), open: close, high: close, low: close, close, volume: 0,
  rawValues: { open: close, high: close, low: close, close, volume: 0 } });
const range = candles => ({ candles, prices: candles.map(c => ({ date: c.time, rawDate: c.rawTime, price: c.close })), rawPrices: candles.map(c => ({ date: c.rawTime, price: c.close })) });
const bundle = candles => ({ source: "cache", asOf: "2026-10-26T07:26:08Z", chartData: { code: "138930", symbol: "138930", ranges: Object.fromEntries(["1D", "1M", "3M", "1Y", "3Y", "5Y"].map(key => [key, key === "1D" ? range(candles) : range([])])) }, sourceStock: { code: "138930" }, summary: {} });
const row = (hhmm, close = 100, day = "20261027") => ({ stck_bsop_date: day, stck_cntg_hour: hhmm.replace(":", "") + "00", stck_oprc: String(close), stck_hgpr: String(close), stck_lwpr: String(close), stck_prpr: String(close), cntg_vol: "0" });
const env = { KIS_ENV: "real", KIS_BASE_URL: "https://fixture-intraday.invalid", KIS_APP_KEY: "fixture-key", KIS_APP_SECRET: "fixture-secret", KIS_REQUEST_DELAY_MS: "1", KIS_INTRADAY_PAGE_COUNT: "1" };
function provider(intraday) {
  const cursors = [];
  vi.stubGlobal("fetch", vi.fn(async input => {
    const url = new URL(String(input));
    if (url.hostname !== "fixture-intraday.invalid") throw new Error("Unexpected provider");
    if (url.pathname.includes("oauth2")) return jsonResponse({ access_token: "fixture-token", expires_in: 3600 });
    if (url.pathname.includes("time-itemchartprice")) {
      const cursor = url.searchParams.get("FID_INPUT_HOUR_1"); cursors.push(cursor);
      return jsonResponse({ rt_cd: "0", output2: intraday(cursor, cursors.length) });
    }
    if (url.pathname.includes("daily-itemchartprice")) return jsonResponse({ rt_cd: "0", output2: [{ stck_bsop_date: "20261026", stck_oprc: "100", stck_hgpr: "100", stck_lwpr: "100", stck_clpr: "100", acml_vol: "0" }] });
    return jsonResponse({ rt_cd: "0", output: { stck_prpr: "100", prdy_vol: "1" } });
  }));
  return cursors;
}
async function collect(wait = false, options = {}) {
  const { buildKisStockChart } = await import("../../server/kisDashboard");
  const pending = buildKisStockChart("138930", { ...env, ...options }, wait);
  await vi.runAllTimersAsync();
  return pending;
}
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); files.chart = null; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("intraday observation time boundary", () => {
  it("starts at 13:01 and rejects provider future rows using one recorded query time", async () => {
    const cursors = provider(() => [row("15:30", 200), row("13:01"), row("09:00")]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await collect(), selected = result.chartData.ranges["1D"];
    expect(cursors).toEqual(["130100"]);
    expect(selected.candles.map(c => c.rawTime)).toEqual([time("09:00"), time("13:01")]);
    expect(selected.intraday).toMatchObject({ rejectedFuturePrices: 1, rejectedFutureCandles: 1, needsRefresh: false });
    expect(Date.parse(selected.intraday.queriedAt)).toBeGreaterThanOrEqual(now);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rejected future observations: prices=1 candles=1"));
    // The bundle's old daily asOf must not erase fresh intraday observations.
    expect(validatedChart(adaptChart({ ...result, asOf: "2026-10-26T07:26:08Z" }, "138930", "1D").data).prices).toHaveLength(2);
  });

  it.each([
    ["after close", "2026-10-27T16:00:00+09:00", "20261027"],
    ["before open", "2026-10-27T08:00:00+09:00", "20261026"],
    ["weekend", "2026-11-01T13:01:00+09:00", "20261030"],
    ["holiday", "2026-10-09T13:01:00+09:00", "20261008"],
    ["unknown weekend", "2027-01-02T13:01:00+09:00", "20261230"],
    ["unknown weekday", "2027-01-04T13:01:00+09:00", "20261230"],
  ])("preserves the closing/previous-session query %s", async (_name, at, day) => {
    vi.setSystemTime(new Date(at));
    const cursors = provider(() => [row("15:30", 100, day), row("09:00", 100, day)]);
    const selected = (await collect()).chartData.ranges["1D"];
    expect(cursors).toEqual(["153000"]);
    expect(selected.candles).toHaveLength(2);
    expect(selected.intraday.rejectedFutureCandles).toBe(0);
  });

  it("never lets an all-future provider page move the next cursor into the future", async () => {
    const cursors = provider(() => [row("15:30")]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const selected = (await collect(false, { KIS_INTRADAY_PAGE_COUNT: "3" })).chartData.ranges["1D"];
    expect(cursors).toEqual(["130100"]);
    expect(selected.candles).toHaveLength(0);
    expect(selected.intraday.rejectedFutureCandles).toBe(1);
  });

  it("keeps the initial query boundary when provider work crosses into a later minute", async () => {
    provider(() => {
      vi.setSystemTime(now + 120_000);
      return [row("13:02"), row("13:01"), row("09:00")];
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const selected = (await collect()).chartData.ranges["1D"];
    expect(selected.intraday.rejectedFutureCandles).toBe(1);
    expect(selected.candles.some(c => c.rawTime === time("13:02"))).toBe(false);
    expect(Date.parse(selected.intraday.queriedAt)).toBeLessThan(Date.parse(time("13:02")));
  });

  it("repairs against cache builtAt, remains stable as time advances, and preserves legitimate zero-volume runs", () => {
    const source = bundle([point("09:00"), point("09:01"), point("13:01"), point("15:30")]);
    const builtAt = Date.parse(time("13:00"));
    const restored = normalizeStockChartBundle(source, builtAt).chartData.ranges["1D"];
    expect(restored.candles.map(c => c.rawTime)).toEqual([time("09:00"), time("09:01")]);
    expect(restored.prices).toHaveLength(2); expect(restored.rawPrices).toHaveLength(2);
    expect(restored.intraday).toMatchObject({ queriedAt: new Date(builtAt).toISOString(), rejectedFuturePrices: 2, rejectedFutureCandles: 2, needsRefresh: true });
    vi.setSystemTime(new Date("2026-10-27T17:00:00+09:00"));
    expect(normalizeIntradayChartRange(restored, now + 4 * 3600_000, true)).toEqual(restored);
    expect(source.chartData.ranges["1D"].candles).toHaveLength(4);
  });

  it("hydrates an unexpired contaminated disk cache and replaces all intraday history before resuming incremental updates", async () => {
    files.chart = { version: 2, builtAt: now - 10_000, data: bundle([point("09:31", 11780), point("13:02"), point("15:30")]) };
    const original = structuredClone(files.chart);
    const cursors = provider((_cursor, count) => count === 1 ? [row("13:01", 201), row("12:32", 202)] : [row("12:31", 203), row("09:00", 204)]);
    const result = await collect(true), selected = result.chartData.ranges["1D"];
    expect(cursors).toEqual(["130100", "123100"]); // Recovery overrides one-page incremental collection.
    expect(selected.candles.map(c => c.close)).toEqual([204, 203, 202, 201]);
    expect(selected.intraday.needsRefresh).toBe(false);
    expect(selected.rawPrices.some(p => p.price === 11780)).toBe(false);
    expect(selected.candles.every(c => Date.parse(c.rawTime) <= Date.now())).toBe(true);
    expect(files.chart).toEqual(original); // The original disk fixture is never modified/deleted.
    vi.advanceTimersByTime(120_000);
    const next = await collect(true);
    expect(cursors.at(-1)).toBe("130300");
    expect(next.chartData.ranges["1D"].candles.some(c => c.close === 11780 || c.rawTime === time("15:30"))).toBe(false);
  });

  it("immediately exposes rejected counts from a sanitized cache while background recovery runs", async () => {
    files.chart = { version: 2, builtAt: now - 10_000, data: bundle([point("09:00"), point("15:30")]) };
    const cursors = provider(() => [row("09:00")]);
    const selected = (await collect()).chartData.ranges["1D"];
    expect(selected.candles.map(c => c.rawTime)).toEqual([time("09:00")]);
    expect(selected.intraday).toMatchObject({ needsRefresh: true, rejectedFuturePrices: 1, rejectedFutureCandles: 1 });
    expect(cursors).toEqual(["130100"]);
  });

  it("serves a sanitized old cache during a failed repair and keeps recovery pending", async () => {
    files.chart = { version: 2, builtAt: now - 10_000, data: bundle([point("09:00"), point("15:30")]) };
    provider(() => []);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await collect(true), selected = result.chartData.ranges["1D"];
    expect(selected.candles.map(c => c.rawTime)).toEqual([time("09:00")]);
    expect(selected.intraday).toMatchObject({ needsRefresh: true, rejectedFutureCandles: 1 });
  });

  it("backs off partial bundle repair failures independently of successful writes, including after restart", async () => {
    files.chart = { version: 2, builtAt: now - 10_000, data: bundle([point("09:00"), point("15:30")]) };
    let empty = true;
    provider(() => empty ? [] : [row("09:00")]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await collect(true), failure = first.chartData.ranges["1D"].intraday;
    expect(failure).toMatchObject({ needsRefresh: true, repairFailures: 1 });
    expect(failure.repairFailedAt).toBeGreaterThanOrEqual(now);
    const fetcher = vi.mocked(globalThis.fetch), count = fetcher.mock.calls.length;
    for (let index = 0; index < 10; index++) await collect(index % 2 === 0);
    expect(fetcher).toHaveBeenCalledTimes(count);
    // A persisted repair failure survives cache hydration and bypasses expired normal TTLs.
    files.chart = { version: 2, builtAt: Date.now(), data: first };
    vi.resetModules();
    vi.setSystemTime(failure.repairFailedAt + 59_999);
    await collect(true); expect(fetcher).toHaveBeenCalledTimes(count);
    vi.setSystemTime(failure.repairFailedAt + 60_000);
    const second = await collect(true), repeated = second.chartData.ranges["1D"].intraday;
    expect(repeated.repairFailures).toBe(2);
    const repeatedCount = fetcher.mock.calls.length;
    vi.setSystemTime(repeated.repairFailedAt + 119_999);
    await collect(true); expect(fetcher).toHaveBeenCalledTimes(repeatedCount);
    empty = false;
    vi.setSystemTime(repeated.repairFailedAt + 120_000);
    const recovered = (await collect(true)).chartData.ranges["1D"].intraday;
    expect(recovered.needsRefresh).toBe(false);
    expect(recovered.repairFailedAt).toBeUndefined(); expect(recovered.repairFailures).toBeUndefined();
  });

  it("serves cached data and backs off when the quote fails before any repair range starts", async () => {
    files.chart = { version: 2, builtAt: now - 10_000, data: bundle([point("09:00"), point("15:30")]) };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn(async input => String(input).includes("oauth2")
      ? jsonResponse({ access_token: "fixture-token", expires_in: 3600 }) : new Response("{}", { status: 502 }));
    vi.stubGlobal("fetch", fetcher);
    const selected = (await collect(true)).chartData.ranges["1D"];
    expect(selected.intraday).toMatchObject({ needsRefresh: true, repairFailures: 1 });
    const count = fetcher.mock.calls.length;
    await collect(true); await collect();
    expect(fetcher).toHaveBeenCalledTimes(count);
  });

  it("retains repair backoff even when every old intraday row was removed as future data", async () => {
    files.chart = { version: 2, builtAt: now - 10_000, data: bundle([point("15:30")]) };
    provider(() => []);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const selected = (await collect(true)).chartData.ranges["1D"];
    expect(selected.candles).toHaveLength(0);
    expect(selected.intraday).toMatchObject({ needsRefresh: true, rejectedFutureCandles: 1, repairFailures: 1 });
    const fetcher = vi.mocked(globalThis.fetch), count = fetcher.mock.calls.length;
    await collect(true); await collect();
    expect(fetcher).toHaveBeenCalledTimes(count);
  });

  it("repairs recent legacy history once on the background lane, even if pollution predates builtAt", async () => {
    files.chart = { version: 2, builtAt: now - 10_000, data: bundle([point("09:00", 11780), point("12:59", 11780)]) };
    const cursors = provider(() => [row("09:00", 200)]);
    const { kisRequestLimiter } = await import("../../server/kisRateLimit");
    const restored = (await collect()).chartData.ranges["1D"];
    expect(restored.intraday).toMatchObject({ needsRefresh: true, rejectedFutureCandles: 0 });
    expect(kisRequestLimiter.take.mock.calls.some(args => args[1] === "background")).toBe(true);
    expect(cursors).toHaveLength(1);
    const refreshed = await collect(true);
    expect(refreshed.chartData.ranges["1D"].intraday.needsRefresh).toBe(false);
    expect(refreshed.chartData.ranges["1D"].candles.map(c => c.close)).toEqual([200]);
    await collect(); await collect(true);
    expect(cursors).toHaveLength(1);
    expect(normalizeStockChartBundle(refreshed, Date.now()).chartData.ranges["1D"].intraday.needsRefresh).toBe(false);
  });

  it.each([
    ["previous session", "2026-10-26", true],
    ["older session", "2026-10-23", false],
  ])("marks only recent legacy %s caches for migration", (_name, day, needsRefresh) => {
    const result = normalizeStockChartBundle(bundle([point("15:30", 100, day)]), now);
    expect(result.chartData.ranges["1D"].intraday.needsRefresh).toBe(needsRefresh);
  });
});
