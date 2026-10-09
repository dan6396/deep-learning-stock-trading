import { describe, expect, it } from "vitest";
import { safeArticleUrl, observationTime, validatedChart } from "./reportData";
import { chartBundle } from "./reportFixtures";
import { adaptChart, adaptQuote } from "../../entities/market";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow } from "../../test/dataFixtures";

describe("report input boundaries", () => {
  it.each([null, undefined, "", "javascript:alert(1)", "data:text/html,x", "//host/article", "/article", "unknown", "https://user:password@host/article"])("does not link unsafe/non-absolute URL %s", value => expect(safeArticleUrl(value)).toBeNull());
  it("permits only absolute HTTP/S article links", () => {
    expect(safeArticleUrl("https://news.example/article?a=1")).toBe("https://news.example/article?a=1");
    expect(safeArticleUrl("http://news.example/article")).toBe("http://news.example/article");
  });
  it.each([null, "", "2026-02-30", "2026-10-07T24:00:00+09:00", "2026-10-07T12:60:00+09:00", "20261007", "not-a-date"])("rejects impossible/raw missing observation %s", value => expect(observationTime(value)).toBeNull());
  it("uses Seoul raw dates/times independent of browser timezone", () => {
    expect(observationTime("2026-10-07T09:00:00+09:00")).toBe(Date.parse("2026-10-07T00:00:00Z"));
    expect(observationTime("2026-10-07T09:00:00")).toBe(Date.parse("2026-10-07T00:00:00Z"));
  });
  it("splits missing prices without interpolation and rejects unknown or invalid OHLC", () => {
    const bundle = chartBundle(), range = bundle.chartData.ranges["1D"];
    range.prices[1].price = NaN;
    range.candles[0].rawValues.open = 0;
    range.candles[1].rawValues.low = 120;
    const data = adaptChart(bundle, "005930", "1D").data, view = validatedChart(data);
    expect(view.segments.map(segment => segment.length)).toEqual([1, 1]);
    expect(view.rejectedPrices).toBe(1); expect(view.candles).toHaveLength(1); expect(view.rejectedCandles).toBe(2);
    expect(data.candles[0].open).toBe(0); expect(data.candles[2].volume).toBe(0);
    expect(adaptQuote({ code: "005930", currentPrice: null, tradingValue: 0 }).data).toMatchObject({ currentPrice: null, tradingValue: 0 });
  });
  it("preserves explicit raw null time/OHLC instead of legacy fabricated values", () => {
    const bundle = chartBundle();
    const range = bundle.chartData.ranges["1D"];
    Object.assign(range.candles[0], { rawTime: null }); Object.assign(range.candles[1].rawValues, { open: null });
    Object.assign(range.prices[0], { rawDate: null });
    const data = adaptChart(bundle, "005930", "1D").data;
    expect(data.prices[0].date).toBeNull(); expect(data.candles[0].time).toBeNull(); expect(data.candles[1].open).toBeNull();
    expect(validatedChart(data).candles).toHaveLength(1);
    const old = { chartData: { code: "005930", ranges: { "1D": { prices: [{ date: "2026-10-07", price: 100 }], candles: [{ time: "2026-10-07", open: 100, high: 100, low: 100, close: 100 }] } } } };
    expect(validatedChart(adaptChart(old, "005930", "1D").data)).toMatchObject({ prices: [], candles: [] });
  });
  it("keeps final rank distinct and explicit null authoritative over input/overwritten pred_rank", () => {
    expect(adaptCandidate(pipelineRow({ pred_rank: 1, final_rank: 3 })).data).toMatchObject({ rank: 1, finalRank: 3 });
    for (const value of [null, 0, -1, "", Infinity, 1.5]) expect(adaptCandidate(pipelineRow({ final_rank: value })).data.finalRank).toBeNull();
    expect(adaptCandidate(pipelineRow({ pred_rank: 1, final_rank: 2 }, { rawModelRank: 50, rawFinalRank: null })).data).toMatchObject({ rank: 50, finalRank: null });
  });
  it("keeps unknown article sentiment with original reason/description and null missing values", () => {
    const row = pipelineRow(); row.news = [{ sentiment: "unclear", sentiment_reason: "원본 근거", description: "원본 설명" }, {}];
    expect(adaptCandidate(row).data.news).toMatchObject([{ sentiment: null, reason: "원본 근거", description: "원본 설명" }, { sentiment: null, reason: null, description: null }]);
  });
  it("aggregates an explicit sample/unknown sourceStock even without provenance headers", () => {
    for (const source of ["sample", "unknown"]) {
      const bundle = { ...chartBundle(), sourceStock: { code: "005930", source } };
      expect(adaptChart(bundle, "005930", "1D").source).toBe(source);
    }
  });
});
