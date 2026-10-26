import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRawPrices, normalizeDailyChartRange, normalizeStockChartBundle } from "../../server/chartNormalization";
import * as normalization from "../../server/chartNormalization";
import { adaptChart } from "../entities/market";
import { validatedChart } from "../features/stock/reportData";
import { jsonResponse } from "./dataFixtures";

const files = vi.hoisted(() => ({ chart: null, daily: null }));
vi.mock("node:fs/promises", () => { const mocks = {
  readFile: vi.fn(async file => {
    if (String(file).includes("chart-") && files.chart) return JSON.stringify(files.chart);
    if (String(file).includes("daily-") && files.daily) return JSON.stringify(files.daily);
    throw new Error("No fixture file");
  }),
  writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}), rename: vi.fn(async () => {}),
}; return { ...mocks, default: mocks }; });
vi.mock("../../server/kisRateLimit", () => ({ kisRequestLimiter: { take: vi.fn(async () => {}) }, kisMaxRps: () => 5, kisRequestMetrics: {} }));
const now = Date.parse("2026-10-26T08:00:00Z");
const date = offset => new Date(now - offset * 86400000).toISOString().slice(0, 10);
const price = offset => ({ date: date(offset), price: 100 + offset });
const candle = point => ({ time: point.date, rawTime: point.date, open: point.price, high: point.price + 1, low: point.price - 1, close: point.price,
  rawValues: { open: point.price, high: point.price + 1, low: point.price - 1, close: point.price, volume: 1 } });
function range(rawPrices) { return { rawPrices, prices: rawPrices.filter(row => row.date && row.price > 0), candles: rawPrices.filter(row => row.date && row.price > 0).map(candle) }; }
function bundle(rawPrices) { return { source: "cache", asOf: new Date(now).toISOString(), chartData: { code: "055550", symbol: "055550", ranges: Object.fromEntries(["1D", "1M", "3M", "1Y", "3Y", "5Y"].map(key => [key, range(rawPrices)])) }, sourceStock: { code: "055550" }, summary: {} }; }
const mixed = () => [...Array.from({ length: 27 }, (_, index) => price(index + 1)), price(0)];
const env = { KIS_ENV: "real", KIS_BASE_URL: "https://fixture-order.invalid", KIS_APP_KEY: "fixture-order-key", KIS_APP_SECRET: "fixture-order-secret", KIS_REQUEST_DELAY_MS: "1", KIS_INTRADAY_PAGE_COUNT: "1" };
beforeEach(() => { files.chart = files.daily = null; vi.resetModules(); vi.spyOn(Date, "now").mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("daily chart cache chronology", () => {
  it.each([
    ["descending tail", [price(0), price(1), { date: null, price: null }], [null, date(1), date(0)], [2]],
    ["descending head", [{ date: null, price: null }, price(0), price(1)], [date(1), date(0), null], [2]],
    ["ascending head", [{ date: null, price: null }, price(1), price(0)], [null, date(1), date(0)], [2]],
    ["ascending tail", [price(1), price(0), { date: null, price: null }], [date(1), date(0), null], [2]],
    ["descending middle", [price(0), { date: null, price: null }, price(1)], [date(1), null, date(0)], [1, 1]],
    ["ascending middle", [price(1), { date: null, price: null }, price(0)], [date(1), null, date(0)], [1, 1]],
  ])("keeps %s gaps at their original chronological boundary", (_name, rows, expectedDates, segments) => {
    const normalized = normalizeRawPrices(rows), chart = bundle([]);
    chart.chartData.ranges["1M"] = range(normalized);
    expect(normalized.map(row => row.date)).toEqual(expectedDates);
    expect(validatedChart(adaptChart(chart, "055550", "1M").data).segments.map(segment => segment.length)).toEqual(segments);
    expect(normalizeRawPrices(normalized)).toEqual(normalized);
  });
  it("replaces reobserved gap anchors without accumulating markers and expires old anchors", () => {
    const gap = value => ({ date: null, price: value });
    let cached = [gap(1), price(10), gap(2), price(5), gap(3), price(3), gap(4), price(2)];
    const incoming = [price(0), gap(8), gap(9), price(3)]; // Descending; gap anchor is date(3).
    for (let count = 0; count < 5; count++) {
      cached = normalization.mergeDailyRawPrices(cached, incoming, date(4), date(7));
      expect(cached).toEqual([price(5), gap(3), price(3), gap(9), gap(8), price(2), price(0)]);
      expect(cached.filter(row => row.date === null)).toHaveLength(3);
      const chart = bundle([]); chart.chartData.ranges["1M"] = range(cached);
      expect(validatedChart(adaptChart(chart, "055550", "1M").data).segments.map(segment => segment.length)).toEqual([1, 1, 2]);
    }
    const cleared = normalization.mergeDailyRawPrices(cached, [price(0), price(3)], date(4), date(7));
    expect(cleared).toEqual([price(5), gap(3), price(3), price(2), price(0)]);
  });
  it("repairs mixed legacy dates while dropping only unlocatable nulls", () => {
    const chart = normalizeStockChartBundle(bundle([...mixed().slice(0, 3), { date: null, price: null }, ...mixed().slice(3)]));
    const view = validatedChart(adaptChart(chart, "055550", "1M").data);
    expect(view.prices).toHaveLength(28); expect(view.segments.map(segment => segment.length)).toEqual([28]); expect(view.rejectedPrices).toBe(0);
  });
  it("preserves old head gaps outside a partial query and replaces the query's leading boundary", () => {
    const head = {date:null,price:1}, edge = {date:null,price:2};
    let cached = [head,price(10),price(5),price(3)];
    const incoming = [edge,price(1),price(0)];
    for(let count=0;count<3;count++) {
      cached=normalization.mergeDailyRawPrices(cached,incoming,date(2),date(12));
      expect(cached).toEqual([head,price(10),price(5),price(3),edge,price(1),price(0)]);
    }
    expect(normalization.mergeDailyRawPrices(cached,[price(0),price(3),price(5)],date(12),date(12)).filter(row=>row.date===null)).toEqual([]);
  });
  it("expires gaps with their excluded anchors when deriving a shorter daily range", () => {
    const gap={date:null,price:null};
    expect(normalization.sliceDailyRawPrices([gap,price(60),gap,price(40),gap,price(0)],date(45)))
      .toEqual([price(40),gap,price(0)]);
  });
  it("hydrates and repeatedly reads a legacy mixed bundle without recollecting or changing freshness", async () => {
    files.chart = { version: 2, builtAt: now, data: bundle(mixed()) };
    const fetcher = vi.fn(() => { throw new Error("Unexpected network"); }); vi.stubGlobal("fetch", fetcher);
    const { buildKisStockChart } = await import("../../server/kisDashboard");
    for (let count = 0; count < 2; count++) {
      const result = await buildKisStockChart("055550", env);
      const view = validatedChart(adaptChart(result, "055550", "1M").data);
      expect(view.prices).toHaveLength(28); expect(view.segments.map(segment => segment.length)).toEqual([28]); expect(view.rejectedPrices).toBe(0);
      expect(result.asOf).toBe(new Date(now).toISOString());
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(files.chart.data.chartData.ranges["1M"].rawPrices).toEqual(mixed()); // Repair is read-only.
  });
  it("merges a newest-first response into an existing daily cache and keeps corrections in time order", async () => {
    files.daily = { version: 2, builtAt: now - 3 * 86400000, data: range(Array.from({ length: 27 }, (_, index) => price(index + 1))) };
    const fetcher = vi.fn(async url => {
      if (String(url).includes("oauth2")) return jsonResponse({ access_token: "fixture-order-access", expires_in: 3600 });
      if (String(url).includes("daily-itemchartprice")) return jsonResponse({ rt_cd: "0", output2: [0, 1, 2].map(offset => ({ stck_bsop_date: date(offset).replace(/-/g, ""), stck_oprc: "110", stck_hgpr: "112", stck_lwpr: "109", stck_clpr: "111", acml_vol: "1" })) });
      if (String(url).includes("time-itemchartprice")) return jsonResponse({ rt_cd: "0", output2: [{ stck_bsop_date: date(0).replace(/-/g, ""), stck_cntg_hour: "150000", stck_oprc: "110", stck_hgpr: "112", stck_lwpr: "109", stck_prpr: "111", cntg_vol: "1" }] });
      return jsonResponse({ rt_cd: "0", output: { stck_prpr: "111", prdy_vol: "1" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const { buildKisStockChart } = await import("../../server/kisDashboard");
    const result = await buildKisStockChart("055550", env);
    const selected = result.chartData.ranges["1M"], dates = selected.rawPrices.map(row => row.date);
    expect(dates).toEqual([...dates].sort()); expect(new Set(dates).size).toBe(28);
    expect(selected.rawPrices.find(row => row.date === date(1)).price).toBe(111);
    expect(selected.candles.map(row => row.time)).toEqual(dates);
    const view = validatedChart(adaptChart(result, "055550", "1M").data);
    expect(view.prices).toHaveLength(28); expect(view.segments.map(segment => segment.length)).toEqual([28]); expect(view.rejectedPrices).toBe(0);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("daily-itemchartprice"))).toBe(true);
  });
  it("repeatedly refreshes the actual daily-cache path without accumulating or relocating provider nulls", async () => {
    const cachedRows=Array.from({length:27},(_,index)=>price(index+1));
    cachedRows.splice(1,0,{date:null,price:null});
    files.daily={version:2,builtAt:now-3*86400000,data:range(cachedRows)};
    vi.stubGlobal("fetch",vi.fn(async url=>{
      if(String(url).includes("oauth2"))return jsonResponse({access_token:"fixture-null-access",expires_in:3600});
      if(String(url).includes("daily-itemchartprice"))return jsonResponse({rt_cd:"0",output2:[0,null,1,2].map(offset=>offset===null?{stck_bsop_date:"",stck_clpr:""}:{stck_bsop_date:date(offset).replace(/-/g,""),stck_oprc:"110",stck_hgpr:"112",stck_lwpr:"109",stck_clpr:"111",acml_vol:"1"})});
      if(String(url).includes("time-itemchartprice"))return jsonResponse({rt_cd:"0",output2:[{stck_bsop_date:date(0).replace(/-/g,""),stck_cntg_hour:"150000",stck_oprc:"110",stck_hgpr:"112",stck_lwpr:"109",stck_prpr:"111",cntg_vol:"1"}]});
      return jsonResponse({rt_cd:"0",output:{stck_prpr:"111",prdy_vol:"1"}});
    }));
    const {buildKisStockChart}=await import("../../server/kisDashboard");
    for(let count=0;count<3;count++) {
      vi.mocked(Date.now).mockReturnValue(now+count*86400000);
      const result=await buildKisStockChart("055550",env,true), selected=result.chartData.ranges["1M"];
      expect(selected.rawPrices.filter(row=>row.date===null)).toHaveLength(1);
      expect(selected.rawPrices.slice(-3).map(row=>row.date)).toEqual([date(1),null,date(0)]);
      expect(selected.candles.map(row=>row.time)).toEqual(selected.rawPrices.filter(row=>row.date!==null).map(row=>row.date));
      expect(validatedChart(adaptChart(result,"055550","1M").data).segments.map(segment=>segment.length)).toEqual([27,1]);
    }
  });
  it("derives 1M without retaining a null anchored outside its cutoff in 3M", async () => {
    vi.stubGlobal("fetch",vi.fn(async url=>{
      if(String(url).includes("oauth2"))return jsonResponse({access_token:"fixture-subset-access",expires_in:3600});
      if(String(url).includes("daily-itemchartprice"))return jsonResponse({rt_cd:"0",output2:[0,40,null,60].map(offset=>offset===null?{stck_bsop_date:"",stck_clpr:""}:{stck_bsop_date:date(offset).replace(/-/g,""),stck_oprc:"110",stck_hgpr:"112",stck_lwpr:"109",stck_clpr:"111",acml_vol:"1"})});
      if(String(url).includes("time-itemchartprice"))return jsonResponse({rt_cd:"0",output2:[{stck_bsop_date:date(0).replace(/-/g,""),stck_cntg_hour:"150000",stck_oprc:"110",stck_hgpr:"112",stck_lwpr:"109",stck_prpr:"111",cntg_vol:"1"}]});
      return jsonResponse({rt_cd:"0",output:{stck_prpr:"111",prdy_vol:"1"}});
    }));
    const {buildKisStockChart}=await import("../../server/kisDashboard");
    const result=await buildKisStockChart("055550",env);
    expect(result.chartData.ranges["3M"].rawPrices.filter(row=>row.date===null)).toHaveLength(1);
    expect(result.chartData.ranges["1M"].rawPrices.map(row=>row.date)).toEqual([date(40),date(0)]);
    const view=validatedChart(adaptChart(result,"055550","1M").data);
    expect(view.prices).toHaveLength(2);expect(view.segments.map(segment=>segment.length)).toEqual([2]);expect(view.rejectedPrices).toBe(0);
  });
  it.each([false, true])("retains unknown-date and invalid-price gaps in %s descending source order", descending => {
    const rows = [price(2), { date: null, price: 105 }, price(1), { date: date(0), price: 0 }];
    const normalized = normalizeDailyChartRange(range(descending ? [...rows].reverse() : rows));
    const chart = bundle([]); chart.chartData.ranges["1M"] = normalized;
    const view = validatedChart(adaptChart(chart, "055550", "1M").data);
    expect(view.prices).toHaveLength(2); expect(view.segments.map(segment => segment.length)).toEqual([1, 1]); expect(view.rejectedPrices).toBe(2);
    expect(normalized.rawPrices.filter(row => row.date === null)).toEqual([{ date: null, price: 105 }]);
    expect(normalizeDailyChartRange(normalized)).toEqual(normalized);
  });
  it("uses the last correction for duplicates and retains boundary markers in monotone input", () => {
    const rows = [price(0), price(0), ...Array.from({length:27}, (_,index)=>price(index+1)), { date: null, price: null }, { date: null, price: 0 }];
    rows[1] = { date: date(0), price: 250 };
    const normalized = normalizeRawPrices(rows);
    expect(normalized.filter(row => row.date !== null)).toHaveLength(28);
    expect(normalized.find(row => row.date === date(0)).price).toBe(250);
    expect(normalized.filter(row => row.date === null)).toHaveLength(2);
    expect(normalized.slice(0,2).map(row=>row.date)).toEqual([null,null]);
    expect(normalizeStockChartBundle(bundle(rows)).chartData.ranges["1D"].rawPrices).toEqual(rows);
  });
});
