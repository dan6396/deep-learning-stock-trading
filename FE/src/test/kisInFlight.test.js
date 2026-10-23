import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => { const api = { readFile: vi.fn(async () => { throw new Error("fixture no cache"); }), writeFile: vi.fn(), mkdir: vi.fn() }; return { ...api, default: api }; });
vi.mock("../../server/pipelineResults", async original => ({ ...await original(), loadPipelineRows: vi.fn(async () => null), indexPipelineByTicker: vi.fn() }));
vi.mock("../../server/kisRateLimit", async original => ({ ...await original(), kisRequestLimiter: { take: vi.fn(async () => {}) } }));
import { createRoutes } from "../../server/routes";
let api, calls, release, shouldFail, upstreamSignals;
const env = { KIS_ENV: "real", KIS_APP_KEY: "fixture-share-key", KIS_APP_SECRET: "fixture-share-secret", KIS_BASE_URL: "https://fixture-share.invalid", KIS_REQUEST_DELAY_MS: "1", KIS_INTRADAY_PAGE_COUNT: "1", KIS_INDEX_SERIES_SOURCE: "off" };
const reply = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
beforeEach(async () => {
  vi.resetModules(); api = await import("../../server/kisDashboard"); calls = []; upstreamSignals = []; shouldFail = false;
  const gate = new Promise(resolve => { release = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("oauth2")) return reply({ access_token: "fixture-share-token", expires_in: 3600 });
    calls.push(new URL(url)); upstreamSignals.push(options.signal); await gate;
    if (shouldFail) return new Response("{}", { status: 502 });
    if (String(url).includes("itemchartprice")) return reply({ rt_cd: "0", output2: [{ stck_bsop_date: "20261022", stck_cntg_hour: "090000", stck_clpr: "100", stck_prpr: "100", stck_oprc: "99", stck_hgpr: "101", stck_lwpr: "98", acml_vol: "10" }] });
    return reply({ rt_cd: "0", output: { stck_prpr: "100", prdy_vol: "10", bstp_nmix_prpr: "100", prdy_vrss: "1", bstp_nmix_prdy_vrss: "1", bstp_nmix_prdy_ctrt: "1" } });
  }));
});
afterEach(() => { release(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("KIS in-flight endpoint sharing", () => {
  it("shares N quote requests, isolates waiter results and does not add a completed quote TTL", async () => {
    const pending = Array.from({ length: 8 }, () => api.buildKisStockQuote("005930", env));
    await vi.waitFor(() => expect(calls).toHaveLength(1)); release();
    const values = await Promise.all(pending); values[0].currentPrice = 999;
    expect(values[1].currentPrice).toBe(100);
    await api.buildKisStockQuote("005930", env); expect(calls).toHaveLength(2);
  });
  it.each(["quote", "chart", "indices"])("clears a rejected %s promise so the next request can recover", async kind => {
    const load = () => kind === "quote" ? api.buildKisStockQuote("005930", env) : kind === "chart" ? api.buildKisStockChart("005930", env) : api.buildKisIndices(env);
    shouldFail = true; const first = Promise.allSettled([load(), load(), load()]);
    await vi.waitFor(() => expect(calls).toHaveLength(1)); release();
    expect((await first).every(row => row.status === "rejected")).toBe(true);
    const before = calls.length; shouldFail = false;
    await expect(load()).resolves.toBeDefined(); expect(calls.length).toBeGreaterThan(before);
  });
  it("shares N index requests as one three-index batch", async () => {
    const pending = Array.from({ length: 8 }, () => api.buildKisIndices(env));
    await vi.waitFor(() => expect(calls).toHaveLength(1)); release(); await Promise.all(pending);
    expect(calls.filter(url => url.pathname.endsWith("inquire-index-price"))).toHaveLength(3);
  });
  it("caches completed index snapshots for twenty seconds and honors the TTL override", async () => {
    let clock = Date.now(); const time = vi.spyOn(Date, "now").mockImplementation(() => clock); release();
    const fresh = await api.buildKisIndices(env);
    expect(calls).toHaveLength(3);
    const cached = await api.buildKisIndices(env); expect(calls).toHaveLength(3);
    expect(cached[0].source).toBe("cache"); expect(cached[0].asOf).toBe(fresh[0].asOf);
    cached[0].value = 999; expect((await api.buildKisIndices(env))[0].value).toBe(100);
    clock += 20_001;
    await api.buildKisIndices(env); expect(calls).toHaveLength(6);
    clock += 101;
    await api.buildKisIndices({ ...env, KIS_INDEX_SNAPSHOT_CACHE_TTL_MS: "100" }); expect(calls).toHaveLength(9);
    time.mockRestore();
  });
  it("shares N all-range charts and their raw current-price request with a concurrent quote", async () => {
    const pending = [api.buildKisStockQuote("005930", env), ...Array.from({ length: 8 }, () => api.buildKisStockChart("005930", env))];
    await vi.waitFor(() => expect(calls).toHaveLength(1)); release(); const values = await Promise.all(pending);
    expect(calls.filter(url => url.pathname.endsWith("inquire-price"))).toHaveLength(1);
    expect(calls.filter(url => url.pathname.includes("time-itemchartprice"))).toHaveLength(1);
    expect(calls.filter(url => url.pathname.includes("daily-itemchartprice"))).toHaveLength(3);
    expect(values[1].summary.currentPrice ?? values[1].chartData.currentPrice).toBe(100);
    const count = calls.length; expect((await api.buildKisStockChart("005930", env)).source).toBe("cache"); expect(calls).toHaveLength(count);
  });
  it("keeps different symbols and request environments separate", async () => {
    const pending = [api.buildKisStockQuote("005930", env), api.buildKisStockQuote("000660", env), api.buildKisStockQuote("005930", { ...env, KIS_BASE_URL: "https://fixture-share-other.invalid" })];
    await vi.waitFor(() => expect(calls).toHaveLength(3)); release(); await Promise.all(pending);
  });
  it("a browser request abort never cancels the upstream operation or another route waiter", async () => {
    const controller = new AbortController(), routes = createRoutes({ buildKisStockQuote: code => api.buildKisStockQuote(code, env) });
    const response = () => ({ setHeader: vi.fn(), end: vi.fn(), statusCode: 0 });
    const firstResponse = response(), secondResponse = response();
    const first = routes["/api/korean-market/quote"]({ method: "GET", url: "/api/korean-market/quote?symbol=005930", signal: controller.signal }, firstResponse);
    const second = routes["/api/korean-market/quote"]({ method: "GET", url: "/api/korean-market/quote?symbol=005930" }, secondResponse);
    await vi.waitFor(() => expect(calls).toHaveLength(1)); controller.abort();
    expect(upstreamSignals[0].aborted).toBe(false); release(); await Promise.all([first, second]);
    expect(secondResponse.statusCode).toBe(200); expect(JSON.parse(secondResponse.end.mock.calls[0][0]).currentPrice).toBe(100);
  });
});
