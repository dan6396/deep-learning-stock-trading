import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "./dataFixtures";
import { createElement } from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportChart } from "../features/stock/ReportChart";
// Provenance fixtures do not exercise elapsed time; the bucket has dedicated clock tests.
vi.mock("../../server/kisRateLimit", async original => ({ ...await original(), kisRequestLimiter: { take: vi.fn(async () => {}) } }));
const snapshots = vi.hoisted(() => ({ fresh: null, stale: null }));
vi.mock("../../server/dashboardCache", () => ({
  readDashboardSnapshot: vi.fn(async () => snapshots.fresh), readLastSnapshot: vi.fn(async () => snapshots.stale), writeDashboardSnapshot: vi.fn(),
}));
vi.mock("../../server/pipelineResults", () => ({ loadPipelineRows: vi.fn(async () => null), indexPipelineByTicker: vi.fn() }));
vi.mock("node:fs/promises", () => {
  const mocks = { readFile: vi.fn(async () => { throw new Error("no fixture file"); }), writeFile: vi.fn() };
  return { ...mocks, default: mocks };
});
import { buildKisDashboard, buildKisIndices, buildKisStockQuote, buildKisStockChart, requestBriefingKis } from "../../server/kisDashboard";
import { adaptIndex, adaptQuote, adaptChart } from "../entities/market";
import { validatedChart } from "../features/stock/reportData";
import { kisRequestLimiter } from "../../server/kisRateLimit";

function dashboard(source = "live") {
  return { source, generatedAt: "2026-10-07T09:00:00Z", indices: [
    { symbol: "KOSPI", name: "KOSPI", value: 102, change: 1, changeRate: 1, direction: "up", miniSeries: [100, 101, 102], miniSeriesSource: "interpolated", source: "sample" },
    { symbol: "KOSPI200", name: "KOSPI200", value: 102, change: 1, changeRate: 1, direction: "up", miniSeries: [100, 101, 102], miniSeriesSource: "history", source: "live" },
  ], stocks: [], watchlist: [], focusedStockCode: "005930", sessionLabel: "fixture", events: [] };
}

beforeEach(() => { snapshots.fresh = null; snapshots.stale = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("server market provenance", () => {
  it("bounds OAuth token responses before parsing or issuing any quotation request", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { headers: { "content-length": "1048577" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestBriefingKis("/uapi/fixture", "FIXTURE", {}, {
      KIS_ENV: "real", KIS_BASE_URL: "https://fixture-token-size.invalid", KIS_APP_KEY: "fixture-bounded-key", KIS_APP_SECRET: "fixture-bounded-secret",
    })).rejects.toThrow("KIS briefing data unavailable.");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain("oauth2/tokenP");
  });
  it("bounds Yahoo history responses and preserves the safe interpolated-index fallback", async () => {
    const rejected = [];
    vi.stubGlobal("fetch", vi.fn(async url => {
      if (String(url).includes("oauth2")) return jsonResponse({ access_token: "fixture-bounded-token", expires_in: 3600 });
      if (String(url).includes("finance.yahoo.com")) {
        const response = new Response("{}", { headers: { "content-length": "1048577" } });
        const parse = vi.spyOn(response, "json"); rejected.push(parse);
        return response;
      }
      return jsonResponse({ rt_cd: "0", output: { bstp_nmix_prpr: "300", bstp_nmix_prdy_vrss: "-1", bstp_nmix_prdy_ctrt: "-0.33" } });
    }));
    const result = await buildKisIndices({ KIS_BASE_URL: "https://fixture-yahoo-size.invalid",
      KIS_APP_KEY: "fixture-bounded-key", KIS_APP_SECRET: "fixture-bounded-secret", KIS_INDEX_SERIES_SOURCE: "yahoo" });
    expect(rejected).toHaveLength(3);
    expect(result).toHaveLength(3);
    expect(result.every(index => index.miniSeriesSource === "interpolated")).toBe(true);
    for (const parse of rejected) expect(parse).not.toHaveBeenCalled();
  });
  it.each([true, false])("retries EGW00201 once in the common path without nesting legacy retries (recovery=%s)", async recovery => {
    vi.useFakeTimers(); const timestamps = [], warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(kisRequestLimiter.take).mockClear();
    vi.stubGlobal("fetch", vi.fn(async url => {
      if (String(url).includes("oauth2")) return jsonResponse({ access_token: "fixture-rate-token", expires_in: 3600 });
      timestamps.push(Date.now());
      return timestamps.length === 1 || !recovery
        ? jsonResponse({ rt_cd: "1", msg_cd: "EGW00201", msg1: "초당 거래건수를 초과하였습니다." })
        : jsonResponse({ rt_cd: "0", output: { stck_prpr: "100" } });
    }));
    const pending = buildKisStockQuote("005930", { KIS_ENV: "real", KIS_BASE_URL: `https://fixture-rate-${recovery}.invalid`, KIS_APP_KEY: "fixture-rate-key", KIS_APP_SECRET: "fixture-rate-secret", KIS_MAX_RPS: "3" });
    const assertion = recovery ? expect(pending).resolves.toMatchObject({ currentPrice: 100 }) : expect(pending).rejects.toThrow("EGW00201");
    await vi.runAllTimersAsync(); await assertion;
    expect(timestamps).toHaveLength(2); expect(timestamps[1] - timestamps[0]).toBe(750);
    expect(kisRequestLimiter.take).toHaveBeenCalledTimes(2); expect(kisRequestLimiter.take).toHaveBeenCalledWith(3);
    warn.mockRestore();
  });
  it("keeps the original five-attempt retry for legacy rate messages without EGW00201", async () => {
    vi.useFakeTimers(); const timestamps = [], warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async url => {
      if (String(url).includes("oauth2")) return jsonResponse({ access_token: "fixture-legacy-token", expires_in: 3600 });
      timestamps.push(Date.now()); return jsonResponse({ rt_cd: "1", msg1: "초당 거래건수를 초과하였습니다." });
    }));
    const pending = buildKisStockQuote("005930", { KIS_BASE_URL: "https://fixture-legacy-rate.invalid", KIS_APP_KEY: "fixture-rate-key", KIS_APP_SECRET: "fixture-rate-secret", KIS_REQUEST_DELAY_MS: "1" });
    const assertion = expect(pending).rejects.toThrow("초당 거래건수"); await vi.runAllTimersAsync(); await assertion;
    expect(timestamps).toHaveLength(5); warn.mockRestore();
  });
  it("applies the common limiter to briefing APIs and does not retry other KIS errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {}); let count = 0;
    vi.mocked(kisRequestLimiter.take).mockClear();
    vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("oauth2") ? jsonResponse({ access_token: "fixture-other-token", expires_in: 3600 })
      : (count++, jsonResponse({ rt_cd: "1", msg_cd: "EGW02004", msg1: "실전/모의 구성 불일치" }))));
    await expect(requestBriefingKis("/uapi/domestic-stock/v1/quotations/search-stock-info", "CTPF1002R", {},
      { KIS_ENV: "real", KIS_BASE_URL: "https://fixture-other-rate.invalid", KIS_APP_KEY: "fixture-rate-key", KIS_APP_SECRET: "fixture-rate-secret" })).rejects.toThrow("KIS briefing data unavailable.");
    expect(count).toBe(1); expect(kisRequestLimiter.take).toHaveBeenCalledWith(1); warn.mockRestore();
  });
  it("logs only sanitized KIS diagnostic fields while keeping the public briefing error generic", async () => {
    const secrets = ["fixture-diagnostic-app-key", "fixture-diagnostic-secret", "fixture-diagnostic-token"];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("oauth2")
      ? jsonResponse({ access_token: secrets[2], expires_in: 3600 })
      : new Response(JSON.stringify({ rt_cd: "1", msg_cd: "EGW02004", msg1: `실전투자 도메인 ${secrets.join(" ")}` }), { status: 500, headers: { "Content-Type": "application/json" } })));
    await expect(requestBriefingKis("/uapi/domestic-stock/v1/quotations/search-stock-info", "CTPF1002R", { PRDT_TYPE_CD: "300", PDNO: "042660" },
      { KIS_ENV: "real", KIS_BASE_URL: "https://fixture-diagnostic.invalid", KIS_APP_KEY: secrets[0], KIS_APP_SECRET: secrets[1] })).rejects.toThrow("KIS briefing data unavailable.");
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).toContain("EGW02004"); expect(logs).toContain("실전투자 도메인");
    for (const secret of secrets) expect(logs).not.toContain(secret);
    warn.mockRestore();
  });
  it("labels a shorter 1Y fallback for requested 5Y through server, adapter and report UI", async () => {
    const day = offset => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10), rows = [0, 180, 360].map(offset => ({ stck_bsop_date: day(offset).replace(/-/g, ""), stck_clpr: "105", stck_oprc: "100", stck_hgpr: "110", stck_lwpr: "90", acml_vol: "0" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async url => {
      const path = String(url);
      if (path.includes("oauth2")) return jsonResponse({ access_token: "fixture-access-only", expires_in: 3600 });
      if (path.includes("daily-itemchartprice")) {
        const params = new URL(path).searchParams;
        if (params.get("FID_PERIOD_DIV_CODE") === "M") return new Response("{}", { status: 502 });
        const cutoff = params.get("FID_INPUT_DATE_1"); return jsonResponse({ rt_cd: "0", output2: rows.filter(row => row.stck_bsop_date >= cutoff) });
      }
      if (path.includes("time-itemchartprice")) return jsonResponse({ rt_cd: "0", output2: [] });
      return jsonResponse({ rt_cd: "0", output: { stck_prpr: "105", prdy_vol: "1" } });
    }));
    const bundle = await buildKisStockChart("035420", { KIS_BASE_URL: "https://fixture-coverage.invalid", KIS_APP_KEY: "fixture-key-only", KIS_APP_SECRET: "fixture-secret-only", KIS_REQUEST_DELAY_MS: "1", KIS_INTRADAY_PAGE_COUNT: "1" });
    warn.mockRestore();
    const coverage = bundle.chartData.ranges["5Y"].coverage;
    expect(coverage).toMatchObject({ requestedRange: "5Y", sourceRange: "1Y", method: "fallback", status: "partial", observedStart: day(360), observedEnd: day(0) });
    expect(adaptChart(bundle, "035420", "5Y").data.coverage).toEqual(coverage);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(bundle)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const view = render(createElement(QueryClientProvider, { client }, createElement(ReportChart, { code: "035420" })));
    expect(screen.getByRole("button", { name: "가격선" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "5년" }));
    expect(await screen.findByText(/요청 기간의 일부만 제공되었습니다/)).toHaveTextContent("1년 조회 원본을 대신 사용");
    expect(document.querySelector('[data-chart-coverage="partial"]')).toHaveTextContent("전체 기간 이력이 아닙니다");
    expect(screen.queryByText(/없는 기간을 다른 기간으로 자동 전환하지 않습니다/)).not.toBeInTheDocument();
    expect(screen.getByText(/실제 제공 관측 범위/)).toBeInTheDocument();
    expect(await screen.findByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("5년 요청"));
    view.unmount(); client.clear();
  });
  it.each(["fresh", "stale"])("returns a %s stored snapshot as cache and preserves sample/interpolation", async kind => {
    snapshots[kind] = dashboard();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await buildKisDashboard({ KIS_AUTO_WARM: "false" });
    expect(result.source).toBe("cache"); expect(result.asOf).toBe("2026-10-07T09:00:00Z");
    expect(result.indices[0]).toMatchObject({ source: "sample", miniSeriesSource: "interpolated" });
    expect(result.indices[1]).toMatchObject({ source: "cache", miniSeriesSource: "history" });
    expect(snapshots[kind].source).toBe("live");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("propagates a sample parent to untagged child indices and never invents history", async () => {
    const sample = dashboard("sample");
    delete sample.indices[0].source; delete sample.indices[0].miniSeriesSource;
    snapshots.fresh = sample;
    const result = await buildKisDashboard({ KIS_AUTO_WARM: "false" });
    expect(result.indices[0]).toMatchObject({ source: "sample", miniSeriesSource: "unknown" });
  });
  it.each(["history", "interpolated"])("tags actual index series as %s with mock upstream only", async expected => {
    const fetcher = vi.fn(async url => {
      const target = String(url);
      if (target.includes("oauth2")) return jsonResponse({ access_token: "fixture-access-only", expires_in: 3600 });
      if (target.includes("finance.yahoo")) return jsonResponse({ chart: { result: [{ indicators: { quote: [{ close: [100, 101, 102] }] } }] } });
      if (target.includes("fixture-kis.invalid")) return jsonResponse({ rt_cd: "0", output: { bstp_nmix_prpr: "102", bstp_nmix_prdy_ctrt: "1", bstp_nmix_prdy_vrss: "1", prdy_vrss_sign: "2" } });
      throw new Error("unexpected fixture request");
    });
    vi.stubGlobal("fetch", fetcher);
    const indices = await buildKisIndices({ KIS_BASE_URL: "https://fixture-kis.invalid", KIS_APP_KEY: "fixture-key-only", KIS_APP_SECRET: "fixture-secret-only",
      KIS_REQUEST_DELAY_MS: "1", KIS_INDEX_SERIES_SOURCE: expected === "history" ? "yahoo" : "off" });
    expect(indices.length).toBeGreaterThan(0);
    for (const index of indices) expect(index).toMatchObject({ source: "live", miniSeriesSource: expected });
    expect(fetcher).toHaveBeenCalled();
    expect(indices.every(index => typeof index.asOf === "string")).toBe(true);
  });
  it("keeps missing upstream quote/index values null for new consumers", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("oauth2")
      ? jsonResponse({ access_token: "fixture-access-only", expires_in: 3600 })
      : jsonResponse({ rt_cd: "0", output: { stck_prpr: "", prdy_vrss: "", prdy_ctrt: "" } })));
    const env = { KIS_BASE_URL: "https://fixture-kis-missing.invalid", KIS_APP_KEY: "fixture-key-only", KIS_APP_SECRET: "fixture-secret-only",
      KIS_REQUEST_DELAY_MS: "1", KIS_INDEX_SERIES_SOURCE: "off", KIS_QUOTE_WITH_INVESTOR_FLOW: "false" };
    const indices = await buildKisIndices(env);
    for (const index of indices) expect(adaptIndex(index).data).toMatchObject({ value: null, change: null, changeRate: null, miniSeries: [] });
    const quote = await buildKisStockQuote("005930", env);
    expect(adaptQuote(quote).data).toMatchObject({ currentPrice: null, change: null, changeRate: null, volume: null, tradingValue: null });
  });
  it("adds original nullable OHLC/time without altering legacy substitutions, using fixture upstream only", async () => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), kisDay = day.replace(/-/g, "");
    const missing = { stck_bsop_date: kisDay, stck_prpr: "105", stck_clpr: "105", stck_oprc: "", stck_hgpr: "", stck_lwpr: "", cntg_vol: "0", acml_vol: "0" };
    const valid = { ...missing, stck_cntg_hour: "090000", stck_oprc: "100", stck_hgpr: "110", stck_lwpr: "90" };
    const fetcher = vi.fn(async url => {
      if (String(url).includes("oauth2")) return jsonResponse({ access_token: "fixture-access-only", expires_in: 3600 });
      if (String(url).includes("time-itemchartprice")) return jsonResponse({ rt_cd: "0", output2: [{ ...missing }, valid, { ...valid, stck_cntg_hour: "246000", stck_prpr: "108" }] });
      if (String(url).includes("daily-itemchartprice")) return jsonResponse({ rt_cd: "0", output2: [{ ...missing, stck_bsop_date: undefined }, { ...valid, stck_bsop_date: "20260230" }, valid] });
      return jsonResponse({ rt_cd: "0", output: { stck_prpr: "105", prdy_vrss: "0", prdy_ctrt: "0", acml_vol: "0", prdy_vol: "1" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const bundle = await buildKisStockChart("005930", { KIS_BASE_URL: "https://fixture-chart.invalid", KIS_APP_KEY: "fixture-key-only", KIS_APP_SECRET: "fixture-secret-only", KIS_REQUEST_DELAY_MS: "1", KIS_INTRADAY_PAGE_COUNT: "1" });
    const rows = bundle.chartData.ranges["1D"].candles;
    const missingTime = rows.find(point => point.time.includes("T00:00:00"));
    expect(missingTime.rawTime).toBeNull(); expect(missingTime.open).toBe(105); expect(missingTime.rawValues.open).toBeNull(); expect(missingTime.rawValues.volume).toBe(0);
    expect(rows.find(point => point.time.includes("T24:60:00")).rawTime).toBeNull();
    expect(rows.find(point => point.time.includes("T09:00:00")).rawTime).toBe(`${day}T09:00:00+09:00`);
    const chart = adaptChart(bundle, "005930", "1D").data;
    expect(chart.candles.find(point => point.time === null).open).toBeNull();
    expect(validatedChart(chart).candles).toHaveLength(1); expect(validatedChart(chart).prices).toHaveLength(1);
    expect(bundle.chartData.ranges["3M"].candles.find(point => point.time === "2026-02-30").rawTime).toBeNull();
    expect(fetcher).toHaveBeenCalled();
  });
  it("retains a missing close between valid observations through daily/intraday and derived ranges", async () => {
    const today = new Date(), day = offset => new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10), kisDay = day(0).replace(/-/g, "");
    const raw = { stck_oprc: "100", stck_hgpr: "110", stck_lwpr: "90", cntg_vol: "0", acml_vol: "0" };
    vi.stubGlobal("fetch", vi.fn(async url => {
      if (String(url).includes("oauth2")) return jsonResponse({ access_token: "fixture-access-only", expires_in: 3600 });
      if (String(url).includes("time-itemchartprice")) return jsonResponse({ rt_cd: "0", output2: [
        { ...raw, stck_bsop_date: kisDay, stck_cntg_hour: "110000", stck_prpr: "107" },
        { ...raw, stck_bsop_date: kisDay, stck_cntg_hour: "100000", stck_prpr: "" },
        { ...raw, stck_bsop_date: kisDay, stck_cntg_hour: "090000", stck_prpr: "105" },
      ] });
      if (String(url).includes("daily-itemchartprice")) return jsonResponse({ rt_cd: "0", output2: [
        { ...raw, stck_bsop_date: day(0).replace(/-/g, ""), stck_clpr: "107" },
        { ...raw, stck_bsop_date: day(1).replace(/-/g, ""), stck_clpr: "0" },
        { ...raw, stck_bsop_date: day(2).replace(/-/g, ""), stck_clpr: "105" },
      ] });
      return jsonResponse({ rt_cd: "0", output: { stck_prpr: "105", prdy_vol: "1" } });
    }));
    const bundle = await buildKisStockChart("000660", { KIS_BASE_URL: "https://fixture-gap.invalid", KIS_APP_KEY: "fixture-key-only", KIS_APP_SECRET: "fixture-secret-only", KIS_REQUEST_DELAY_MS: "1", KIS_INTRADAY_PAGE_COUNT: "1" });
    for (const range of ["1D", "3M", "1M", "3Y"]) {
      expect(bundle.chartData.ranges[range].prices).toHaveLength(2); // Existing consumer still receives filtered legacy values.
      expect(bundle.chartData.ranges[range].rawPrices).toHaveLength(3);
      const view = validatedChart(adaptChart(bundle, "000660", range).data);
      expect(view.segments.map(segment => segment.length)).toEqual([1, 1]); expect(view.rejectedPrices).toBe(1);
    }
    expect(bundle.chartData.ranges["1D"].rawPrices[1].price).toBeNull();
    expect(bundle.chartData.ranges["3M"].rawPrices[1].price).toBe(0); // Measured zero preserved, invalid stock price excluded by the view.
  });
});
