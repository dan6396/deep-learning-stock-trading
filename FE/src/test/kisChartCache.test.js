import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const disk = vi.hoisted(() => new Map());
vi.mock("node:fs/promises", () => {
  const api = { readFile: vi.fn(async path => { if (!disk.has(path)) throw new Error("fixture cache miss"); return disk.get(path); }),
    writeFile: vi.fn(async (path, data) => { disk.set(path, data); }), mkdir: vi.fn(async () => {}),
    rename: vi.fn(async (from, to) => { disk.set(to, disk.get(from)); disk.delete(from); }) };
  return { ...api, default: api };
});
vi.mock("../../server/pipelineResults", () => ({ loadPipelineRows: vi.fn(async () => null), indexPipelineByTicker: vi.fn() }));
vi.mock("../../server/kisRateLimit", async original => ({ ...await original(), kisRequestLimiter: { take: vi.fn(async () => {}) } }));
const env = { KIS_ENV: "real", KIS_BASE_URL: "https://fixture-chart-cache.invalid", KIS_APP_KEY: "fixture-cache-key", KIS_APP_SECRET: "fixture-cache-secret", KIS_REQUEST_DELAY_MS: "1", KIS_INTRADAY_PAGE_COUNT: "1" };
const reply = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
let api, requests, now, history;
beforeEach(async () => {
  vi.resetModules(); disk.clear(); requests = [];
  now = Date.parse("2026-10-22T07:00:00Z"); vi.spyOn(Date, "now").mockImplementation(() => now);
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  history = Array.from({ length: 390 }, (_, offset) => {
    const date = new Date(Date.parse("2026-10-22T00:00:00Z") - offset * 86_400_000);
    return { date: date.toISOString().slice(0, 10), weekday: date.getUTCDay() };
  }).filter(row => row.weekday !== 0 && row.weekday !== 6).map(({ date }) => ({ stck_bsop_date: date.replace(/-/g, ""), stck_clpr: "100", stck_oprc: "99", stck_hgpr: "101", stck_lwpr: "98", acml_vol: "10" }));
  vi.stubGlobal("fetch", vi.fn(async url => {
    if (String(url).includes("oauth2")) return reply({ access_token: "fixture-cache-token", expires_in: 3600 });
    const target = new URL(url); requests.push(target);
    if (target.pathname.includes("daily-itemchartprice")) {
      const start = target.searchParams.get("FID_INPUT_DATE_1"), end = target.searchParams.get("FID_INPUT_DATE_2");
      return reply({ rt_cd: "0", output2: history.filter(row => row.stck_bsop_date >= start && row.stck_bsop_date <= end).slice(0, 100) });
    }
    if (target.pathname.includes("time-itemchartprice")) return reply({ rt_cd: "0", output2: [{ ...history[0], stck_cntg_hour: "090000", stck_prpr: "100" }] });
    return reply({ rt_cd: "0", output: { stck_prpr: "100", prdy_vol: "1" } });
  }));
  api = await import("../../server/kisDashboard");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("persistent chart bundles and real daily history", () => {
  it("skips fresh completed TOP5 caches and refreshes expired ones using the same provider keys", async () => {
    const { createRefreshAhead } = await import("../../server/refreshAhead");
    await api.buildKisStockQuote("005930", env, true);
    await api.buildKisStockChart("005930", env, true);
    const worker = createRefreshAhead({ symbols: async () => ["005930"],
      quote: code => api.buildKisStockQuote(code, { ...env, KIS_REQUEST_PRIORITY: "background" }, true),
      urgentQuote: code => api.buildKisStockQuote(code, env, true),
      chart: code => api.buildKisStockChart(code, { ...env, KIS_REQUEST_PRIORITY: "background" }, true),
      history: code => api.getDailyHistory(code, { allowNetwork: true }, env), indices: async () => {}, now: () => now });
    const count = requests.length;
    await worker.warmQuotes(["005930"]); worker.setTargets(["005930"]); await worker.tick(); await worker.idle();
    expect(requests).toHaveLength(count);
    now = Date.parse("2026-10-23T07:00:00Z");
    await worker.warmQuotes(["005930"]); await worker.tick(); await worker.idle();
    expect(requests.length).toBeGreaterThan(count); worker.stop();
  });
  it("uses KIS index trading dates before the built-in calendar year and exposes missing sessions", async () => {
    await api.getDailyHistory("005930", { allowNetwork: true });
    const { pipelineProjectRoot } = await import("../../server/pipelineFreshness");
    disk.set(join(pipelineProjectRoot(), "outputs", "market_index_history", "KOSPI.csv"),
      "date,Close,Volume,source,collected_at\n2025-10-28,100,10,kis,2026-10-22T01:00:00Z\n2025-10-29,101,10,kis,2026-10-22T01:00:00Z\n2025-10-30,102,10,kis,2026-10-22T01:00:00Z\n");
    const count = requests.length;
    const result = await api.getDailyHistory("005930", { start: "2025-10-28", end: "2025-10-30" });
    expect(result).toMatchObject({ complete: true, calendarSource: "kis-index-cache", missingDates: [] });
    // New symbols can legitimately miss sessions; expose dates instead of inventing a halt or price.
    history = history.filter(row => row.stck_bsop_date !== "20251029");
    await api.getDailyHistory("000660", { allowNetwork: true });
    const partial = await api.getDailyHistory("000660", { start: "2025-10-28", end: "2025-10-30" });
    expect(partial).toMatchObject({ complete: false, calendarSource: "kis-index-cache", missingDates: ["2025-10-29"] });
    expect(result.rows.map(row => row.date)).toEqual(["2025-10-28", "2025-10-29", "2025-10-30"]);
    expect(requests.length).toBeGreaterThan(count);
  });
  it("returns null offline when absent, paginates a year on opt-in background requests, and reports gaps honestly", async () => {
    expect(await api.getDailyHistory("005930")).toBeNull(); expect(requests).toHaveLength(0);
    const live = await api.getDailyHistory("005930", { start: "2026-10-20", end: "2026-10-22", allowNetwork: true });
    expect(live).toMatchObject({ code: "005930", source: "live", complete: true });
    expect(live.rows.map(row => row.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(live.rows[0]).toEqual({ date: "2026-10-20", open: 99, high: 101, low: 98, close: 100, volume: 10 });
    expect(requests).toHaveLength(3); // > 100 real daily rows, not a single truncated page.
    const { kisRequestLimiter } = await import("../../server/kisRateLimit");
    expect(kisRequestLimiter.take.mock.calls.every(args => args[1] === "background")).toBe(true);
    const count = requests.length;
    const cached = await api.getDailyHistory("005930", { start: "2026-10-20", end: "2026-10-22" });
    expect(cached).toMatchObject({ source: "cache", complete: true, asOf: live.asOf }); expect(requests).toHaveLength(count);
    expect((await api.getDailyHistory("005930", { start: "2025-01-01", end: "2026-10-22" })).complete).toBe(false);
  });
  it("serves the first chart after a process restart from disk without upstream requests", async () => {
    const original = await api.buildKisStockChart("005930", env); expect(requests.length).toBeGreaterThan(4);
    vi.resetModules(); api = await import("../../server/kisDashboard");
    const count = requests.length;
    const restored = await api.buildKisStockChart("005930", env);
    expect(restored).toMatchObject({ source: "cache", asOf: original.asOf }); expect(requests).toHaveLength(count);
    expect(restored.chartData.ranges["1Y"].candles.length).toBeGreaterThan(250);
    expect(disk.size).toBeGreaterThanOrEqual(4); expect([...disk.keys()].filter(path => path.endsWith(".tmp"))).toEqual([]);
  });
  it("retains the last chart and its original provenance if a stale refresh fails", async () => {
    const original = await api.buildKisStockChart("005930", env);
    now = Date.parse("2026-10-23T00:00:00Z");
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 502 }));
    await expect(api.buildKisStockChart("005930", env, true)).rejects.toThrow();
    const retained = await api.buildKisStockChart("005930", env);
    expect(retained).toMatchObject({ source: "cache", asOf: original.asOf, chartData: original.chartData });
  });
  it("incrementally refetches recent dates, overwrites corrections and preserves older history", async () => {
    await api.buildKisStockChart("005930", env);
    const original = await api.getDailyHistory("005930", { start: "2026-10-20", end: "2026-10-22" });
    now = Date.parse("2026-10-23T07:00:00Z"); requests.length = 0;
    history = [{ ...history[0], stck_bsop_date: "20261023", stck_clpr: "110", stck_hgpr: "112" }, ...history.map(row => row.stck_bsop_date === "20261022" ? { ...row, stck_clpr: "102", stck_hgpr: "103" } : row)];
    await api.buildKisStockChart("005930", env, true);
    const daily = requests.filter(url => url.pathname.includes("daily-itemchartprice"));
    expect(daily).toHaveLength(3);
    expect(daily.filter(url => url.searchParams.get("FID_PERIOD_DIV_CODE") === "D").every(url => url.searchParams.get("FID_INPUT_DATE_1") === "20261008")).toBe(true);
    const updated = await api.getDailyHistory("005930", { start: "2026-10-20", end: "2026-10-23" });
    expect(updated.rows.slice(0, 2)).toEqual(original.rows.slice(0, 2));
    expect(updated.rows.find(row => row.date === "2026-10-22").close).toBe(102);
    expect(updated.rows.find(row => row.date === "2026-10-23").close).toBe(110);
    // A corrected upstream missing close invalidates the old candle instead of reviving it.
    now = Date.parse("2026-10-26T07:00:00Z");
    history = history.map(row => row.stck_bsop_date === "20261022" ? { ...row, stck_clpr: "0" } : row);
    await api.buildKisStockChart("005930", env, true);
    const missing = await api.getDailyHistory("005930", { start: "2026-10-20", end: "2026-10-23" });
    expect(missing.rows.some(row => row.date === "2026-10-22")).toBe(false);
    expect(missing).toMatchObject({ complete: false, missingDates: ["2026-10-22"] });
  });
});
