import { describe, expect, it, vi } from "vitest";
import { safeArticleUrl, observationTime, validatedChart, formatReportRankScore, aggregateCandles, aggregateSegment } from "./reportData";
import { chartBundle } from "../../test/fixtures/reportFixtures";
import { adaptChart, adaptQuote } from "../../entities/market";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow } from "../../test/dataFixtures";

describe("report input boundaries", () => {
  it("trusts server query time despite browser clock skew and gives legacy data two minutes of tolerance", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T13:01:00+09:00"));
    try {
      const bundle = chartBundle(), times = ["12:59", "13:00", "13:01", "15:30"];
      const candles = times.map(t => ({ ...bundle.chartData.ranges["1D"].candles[0], time: `2026-10-27T${t}:00+09:00`, rawTime: `2026-10-27T${t}:00+09:00` }));
      const range = { candles, prices: candles.map(c => ({ date: c.time, rawDate: c.rawTime, price: c.close })),
        intraday: { queriedAt: "2026-10-27T13:00:00+09:00" } };
      bundle.chartData.ranges["1D"] = range;
      const data = adaptChart({ ...bundle, asOf: "2026-10-27T13:00:00+09:00" }, "005930", "1D").data;
      expect(validatedChart(data)).toMatchObject({ rejectedPrices: 2, rejectedCandles: 2 });
      expect(validatedChart(data).prices).toHaveLength(2);
      const legacy = { ...data, observedAt: undefined };
      expect(validatedChart(legacy)).toMatchObject({ rejectedPrices: 1, rejectedCandles: 1 });
      vi.setSystemTime(new Date("2026-10-27T12:59:00+09:00"));
      expect(validatedChart(legacy).prices).toHaveLength(3); // 13:01 is within the legacy tolerance.
      vi.setSystemTime(new Date("2026-10-27T12:00:00+09:00"));
      expect(validatedChart(data).prices).toHaveLength(2); // Server time remains authoritative.
      const legacyResponse = adaptChart({ ...bundle, chartData: { ...bundle.chartData, ranges: { ...bundle.chartData.ranges, "1D": { ...range, intraday: undefined } } } }, "005930", "1D").data;
      expect(legacyResponse.observedAt).toBeNull(); // Never inherit the bundle's oldest asOf.
      vi.setSystemTime(new Date("2026-10-28T13:01:00+09:00"));
      expect(validatedChart(data).prices).toHaveLength(2);
      expect(validatedChart({ ...data, observedAt: "2026-10-27T04:00:00.005Z" }).prices).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });
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
  it("formats report rank score with 2 decimal places and handles null/missing values", () => {
    expect(formatReportRankScore(1.6479)).toBe("1.65");
    expect(formatReportRankScore(1.601514)).toBe("1.60");
    expect(formatReportRankScore(1.6)).toBe("1.60");
    expect(formatReportRankScore(0)).toBe("0.00");
    expect(formatReportRankScore(-0)).toBe("0.00");
    expect(formatReportRankScore(null)).toBe("—");
    expect(formatReportRankScore(undefined)).toBe("—");
    expect(formatReportRankScore(NaN)).toBe("—");
  });
  it("aggregates minute candles into 5-minute bars combining OHLC and summing volume", () => {
    const base = Date.parse("2026-10-27T09:00:00+09:00");
    const rawCandles = [
      { time: "2026-10-27T09:00:00", timestamp: base, open: 100, high: 105, low: 99, close: 102, volume: 10 },
      { time: "2026-10-27T09:01:00", timestamp: base + 60_000, open: 102, high: 108, low: 101, close: 106, volume: 20 },
      { time: "2026-10-27T09:04:00", timestamp: base + 240_000, open: 106, high: 107, low: 98, close: 104, volume: 30 },
      { time: "2026-10-27T09:05:00", timestamp: base + 300_000, open: 104, high: 110, low: 103, close: 109, volume: 50 },
    ];
    const grouped = aggregateCandles(rawCandles, 5);
    expect(grouped).toHaveLength(2);
    // Bucket 1 (09:00 - 09:04)
    expect(grouped[0].open).toBe(100);
    expect(grouped[0].high).toBe(108);
    expect(grouped[0].low).toBe(98);
    expect(grouped[0].close).toBe(104);
    expect(grouped[0].volume).toBeNull();
    expect(grouped[0].bucket).toMatchObject({ observed: 3, expected: 5 });
    expect(grouped[0].timestamp).toBe(base);
    // Bucket 2 (09:05)
    expect(grouped[1].open).toBe(104);
    expect(grouped[1].close).toBe(109);
    expect(grouped[1].volume).toBeNull();
  });
  it("aggregates segments into N-minute bars preserving segment gaps", () => {
    const base = Date.parse("2026-10-27T09:00:00+09:00");
    const seg1 = [
      { date: "2026-10-27T09:00:00", timestamp: base, price: 100 },
      { date: "2026-10-27T09:02:00", timestamp: base + 120_000, price: 105 },
    ];
    const seg2 = [
      { date: "2026-10-27T09:20:00", timestamp: base + 1200_000, price: 110 },
      { date: "2026-10-27T09:23:00", timestamp: base + 1380_000, price: 112 },
    ];
    const agg1 = aggregateSegment(seg1, 5);
    const agg2 = aggregateSegment(seg2, 5);
    expect(agg1).toHaveLength(1);
    expect(agg1[0].price).toBe(105);
    expect(agg2).toHaveLength(1);
    expect(agg2[0].price).toBe(112);
  });

  it("uses complete verified minute volumes only and never mutates frozen input", () => {
    const base = Date.parse("2026-10-27T09:00:00+09:00");
    const candles = Array.from({ length: 5 }, (_, i) => Object.freeze({ time: new Date(base + i * 60_000).toISOString(), timestamp: base + i * 60_000, open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, volume: i }));
    Object.freeze(candles);
    expect(aggregateCandles(candles, 5)[0]).toMatchObject({ open: 100, high: 114, low: 90, close: 109, volume: 10, bucket: { observed: 5, expected: 5 } });
    expect(aggregateCandles(candles.map((point, i) => i === 1 ? { ...point, volume: null } : point), 5)[0].volume).toBeNull();
    expect(aggregateCandles(candles.map(point => ({ ...point, volume: 0 })), 5)[0].volume).toBe(0);
    expect(candles[0].volume).toBe(0); expect(candles).toHaveLength(5);
  });
  it.each([15, 30])("isolates Seoul sessions and the 15:30 closing boundary for %i-minute bars without fabricated buckets", interval => {
    const candle = (time: string) => ({ time, timestamp: observationTime(time)!, open: 100, high: 110, low: 90, close: 105, volume: 5 });
    const points = ["2026-10-26T08:59:00+09:00", "2026-10-26T15:29:00+09:00", "2026-10-26T06:30:00Z", "2026-10-26T15:31:00+09:00", "2026-10-27T00:02:00Z"].map(candle);
    const grouped = aggregateCandles(points, interval);
    expect(grouped.map(point => point.time)).toEqual([`2026-10-26T15:${interval === 15 ? "15" : "00"}:00+09:00`, "2026-10-26T15:30:00+09:00", "2026-10-27T09:00:00+09:00"]);
    expect(grouped[0].bucket).toMatchObject({ observed: 1, expected: interval, end: observationTime("2026-10-26T15:30:00+09:00") });
    expect(grouped[0].volume).toBeNull();
    expect(grouped[1]).toMatchObject({ volume: 5, bucket: { expected: 1, observed: 1 } });
    expect(grouped[2].bucket).toMatchObject({ first: observationTime("2026-10-27T09:02:00+09:00"), observed: 1, expected: interval });
  });
  it("retains validation policy for reversed, duplicate and invalid observations before aggregation", () => {
    const data = adaptChart(chartBundle(), "005930", "1D").data;
    const point = { ...data.candles[0], time: "2026-10-27T09:00:00+09:00" };
    data.candles = [point, { ...point }, { ...point, time: "2026-10-26T09:00:00+09:00" }, { ...point, time: "2026-10-27T09:01:00+09:00", high: 1 }, { ...point, time: "2026-10-27T09:04:00+09:00" }];
    data.observedAt = "2026-10-27T13:00:00+09:00";
    const before = structuredClone(data), view = validatedChart(data);
    expect(view.rejectedCandles).toBe(3);
    expect(aggregateCandles(view.candles, 5)[0].bucket).toMatchObject({ observed: 2, expected: 5 });
    expect(data).toEqual(before);
  });
});
