import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBriefingInput, createBriefingService, formatSupplyWon } from "../../server/briefing";
import { MACRO_UNIVERSE } from "../../server/marketMacro";
import { templateNarrative } from "../../server/briefingNarrative";
import { buildBriefingComposition } from "../../server/briefingComposition";
afterEach(() => vi.useRealTimers());

const marker = { status: "completed", mode: "model_only", startedAt: Date.parse("2026-10-22T07:00:00Z") };
const now = Date.parse("2026-10-23T01:00:00Z");
const macro = { asOf: "2026-10-22T20:00:00Z", indicators: MACRO_UNIVERSE.map(row => ({
  id: row.id, name: row.name, value: 100, change: 1, changePct: 1, unit: row.unit, asOf: "2026-10-22T20:00:00Z", source: "yahoo", status: "ok", session: "closed",
})) };
function rows() {
  return Array.from({ length: 6 }, (_, index) => ({
    input_row: { ticker: String(index + 1).padStart(6, "0"), model_id: "plain_20_120_rank_mean_v1", score_kind: "rank_zscore", prediction_target: "next_session_open_to_close",
      prediction_status: "ok", pred_rank: index + 1, rank_score: 6 - index, pred_pool_size: "6", prediction_base_date: "2026-10-22" },
    result: { ticker: String(index + 1).padStart(6, "0"), company_name: `종목${index + 1}`, label: "NEUTRAL", label_ko: "중립", sentiment_score: 0, confidence: 0,
      summary: "", positive_factors: [], negative_factors: [], key_data_points: [], used_news_indices: [], caution: "" },
    news: [], data_meta: { source: "cache", newsStatus: "not_collected" },
  }));
}
describe("model TOP5 briefing", () => {
  it("uses background KIS reads only for GET and carries the same 1.5-second budget into composition", async () => {
    const market = vi.fn(async () => macro), composition = vi.fn(async input => buildBriefingComposition(input));
    const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: market, composition,
      narratives: { resolve: async input => templateNarrative(input, null, now) } });
    await service(false, {}); expect(market.mock.calls[0][1].backgroundKis).toBe(true);
    expect(composition.mock.calls[0][2].backgroundKis).toBe(true); expect(composition.mock.calls[0][2].kisWaitMs).toBeLessThanOrEqual(1500);
    await service(true, {}); expect(market.mock.calls[1][1].backgroundKis).toBe(false); expect(composition.mock.calls[1][2].backgroundKis).toBe(false);
  });
  it("caps a POST at 45 seconds and reuses already loaded macro/composition when providers hang", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const known = buildBriefingComposition(buildBriefingInput(rows(), marker, macro, now));
    const market = vi.fn().mockResolvedValueOnce(macro).mockImplementation(() => new Promise(() => {}));
    const composition = vi.fn().mockResolvedValueOnce(known).mockImplementation(() => new Promise(() => {}));
    const resolve = vi.fn(async input => templateNarrative(input, null, now));
    const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: market, composition, narratives: { resolve }, now: () => now });
    await service(false, {});
    const pending = service(true, {});
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await pending;
    expect(result.status).toBe("ready"); expect(result.macro.indicators).toEqual(macro.indicators);
    expect(result.composition).toEqual(known);
    expect(resolve.mock.calls[1][3]).toBe(now + 45_000 - 50);
  });
  it("keeps model ranks and returns seven unavailable indicators if cold macro preparation exceeds nine seconds", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const resolve = vi.fn(async input => templateNarrative(input, null, now));
    const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: () => new Promise(() => {}),
      composition: async input => buildBriefingComposition(input), narratives: { resolve }, now: () => now });
    const pending = service(true, {});
    await vi.advanceTimersByTimeAsync(9000);
    const result = await pending;
    expect(result.status).toBe("ready"); expect(result.stocks.map(stock => stock.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result.macro.indicators).toHaveLength(7); expect(result.macro.indicators.every(row => row.status === "unavailable")).toBe(true);
  });
  it("returns no_run without a completed model_only run or with malformed model metadata", () => {
    expect(buildBriefingInput(rows(), null, macro, now).stocks).toEqual([]);
    expect(buildBriefingInput(rows(), { ...marker, mode: "full" }, macro, now).model).toBeNull();
    expect(buildBriefingInput(rows(), { ...marker, status: "running" }, macro, now).model).toBeNull();
    for (const override of [{ model_id: "other" }, { score_kind: "return" }, { pred_pool_size: 99 }, { pred_rank: 2 }, { rank_score: NaN }, { prediction_base_date: "2026-02-30" }]) {
      const data = rows(); Object.assign(data[0].input_row, override);
      expect(buildBriefingInput(data, marker, macro, now).model).toBeNull();
    }
  });
  it("preserves model rank despite row order, and creates grounded evidence and US/Korea session context", () => {
    const data = rows().reverse(), original = structuredClone(data);
    const result = buildBriefingInput(data, marker, macro, now);
    expect(result.stocks.map(row => row.rank)).toEqual([1, 2, 3, 4, 5]); expect(data).toEqual(original);
    expect(result.stocks[0].rankScore).toBe(6); expect(result.stocks[0].topPercent).toBeCloseTo(100 / 6);
    expect(result.stocks[0].evidence[0]).toMatchObject({ id: "E:000001:1", kind: "model", text: "전체 6개 중 1위(상위 16.67%)입니다." });
    expect(result.stocks[0].cautions.map(row => row.kind)).toEqual(["model", "supply", "news", "data"]);
    expect(result.macro.context).toMatchObject({ usSessionDate: "2026-10-22" });
    expect(result.macro.context?.targetSessionNote).toContain("2026-10-23 한국 정규장");
    expect(templateNarrative(result, null).marketNote).toContain("미국 정규장 마감");
  });
  it("distinguishes article failure, zero results, uncollected and measured supply", () => {
    const data = rows();
    data[0].input_row = { ...data[0].input_row, supply_status: "ok", supply_window: 5, supply_data_days: 5, foreign_net_buy_sum: 123, inst_net_buy_sum: -10, supply_pass: "true" };
    data[0].data_meta.newsStatus = "collected";
    data[0].news = [{ index: 1, title: "종목1 공시", url: "https://example.com/article", source: "경제지", pub_date: "2026-10-22T08:00:00Z" }];
    data[1].data_meta.newsStatus = "collection_failed"; data[2].data_meta.newsStatus = "collected";
    const partial = structuredClone(macro); partial.indicators[0].status = "unavailable";
    const result = buildBriefingInput(data, marker, partial, now);
    expect(result.stocks[0].evidence.map(row => row.text).join(" ")).toContain("외국인 123원 순매수");
    expect(result.stocks[0].evidence.map(row => row.text).join(" ")).toContain("기관 10원 순매도");
    expect(JSON.stringify(result)).not.toContain("수급 조건");
    expect(result.stocks[0].news.articles[0]).toMatchObject({ id: "N:000001:1", source: "경제지" });
    expect(result.stocks[1].cautions.some(row => row.text.includes("수집에 실패"))).toBe(true);
    expect(result.stocks[2].cautions.some(row => row.text.includes("확인된 관련 기사가 없"))).toBe(true);
    expect(result.stocks[3].cautions.some(row => row.text.includes("수집하지 않았"))).toBe(true);
    expect(result.stocks[0].cautions.some(row => row.kind === "macro")).toBe(true);
  });
  it("labels intraday and mismatched US dates without claiming a completed previous session", () => {
    const intraday = structuredClone(macro); intraday.indicators[2].session = "open";
    expect(buildBriefingInput(rows(), marker, intraday, now).macro.context?.targetSessionNote).toContain("장중 관측");
    intraday.indicators[3].asOf = "2026-10-21T20:00:00Z";
    expect(buildBriefingInput(rows(), marker, intraday, now).macro.context?.usSessionDate).toBeNull();
  });
  it("GET never requests generation; no_run POST never requests it; run changes invalidate results", async () => {
    const resolve = vi.fn(async (input, _requested, _env) => templateNarrative(input, null, now));
    const markerFn = vi.fn().mockResolvedValue(marker);
    const service = createBriefingService({ rank: async () => rows(), marker: markerFn, macro: async () => macro, narratives: { resolve }, now: () => now });
    expect((await service(false, {})).status).toBe("ready"); expect(resolve.mock.calls[0][1]).toBe(false);
    markerFn.mockResolvedValueOnce(marker).mockResolvedValueOnce({ ...marker, startedAt: marker.startedAt + 100 });
    expect((await service(true, {})).status).toBe("no_run"); expect(resolve.mock.calls[1][1]).toBe(false);
    expect((await service(true, {})).status).toBe("ready"); expect(resolve.mock.calls[2][1]).toBe(true);
  });
  it("never presents supply flags as a ranking filter and describes measured days in KRW", () => {
    const data = rows(); Object.assign(data[0].input_row, { supply_status: "ok", supply_pass: "false", supply_window: 5, supply_data_days: 5,
      foreign_net_buy_sum: 123000000, inst_net_buy_sum: -10000000, foreign_positive_days: 3, inst_positive_days: 2, combined_positive_days: 4 });
    const result = buildBriefingInput(data, marker, macro, now), text = JSON.stringify(result.stocks[0]);
    expect(result.stocks[0].rank).toBe(1); expect(text).toContain("1억 2,300만 원"); expect(text).toContain("순매수 양수 3일");
    expect(result.stocks[0].evidence.filter(fact => fact.kind === "supply")).toHaveLength(1);
    expect(text).not.toMatch(/수급 조건|통과|필터/);
  });
  it("formats measured won in Korean groups without changing magnitude or sign", () => {
    expect(formatSupplyWon(1473000000)).toBe("14억 7,300만 원");
    expect(formatSupplyWon(-2932000000)).toBe("-29억 3,200만 원");
    expect(formatSupplyWon(1230000000000)).toBe("1조 2,300억 원");
    expect(formatSupplyWon(123)).toBe("123원");
  });
  it("rejects non-ok rows claiming ranks, legacy returns and malformed rows like model output validation", () => {
    const legacy = rows(); legacy[0].input_row.ensemble_pred_return = 0.1;
    expect(buildBriefingInput(legacy, marker, macro, now).model).toBeNull();
    const nonOk = rows(); nonOk.push({ ...nonOk[0], input_row: { ...nonOk[0].input_row, ticker: "999999", prediction_status: "failed" } });
    expect(buildBriefingInput(nonOk, marker, macro, now).model).toBeNull();
    expect(buildBriefingInput([null], marker, macro, now).model).toBeNull();
  });
  it("passes the request environment through to rank loading", async () => {
    const rank = vi.fn(async () => rows()), selectedEnv = { PIPELINE_OUTPUT_DIR: "fixture-request" };
    const service = createBriefingService({ rank, marker: async () => marker, macro: async () => macro,
      narratives: { resolve: async input => templateNarrative(input, null, now) }, now: () => now });
    await service(false, selectedEnv); expect(rank).toHaveBeenCalledWith(selectedEnv);
  });
});
