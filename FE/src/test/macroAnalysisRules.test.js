import { describe, expect, it, vi } from "vitest";
import copy from "./fixtures/macro-analysis-copy.json";
import { macroComment, macroAnalysisValue, MACRO_COMMENT_RULES } from "../../server/macroCommentRules";
import { buildPreOpenIndicators } from "../../server/preOpenMacro";
import { createMarketMacro, MACRO_UNIVERSE } from "../../server/marketMacro";
import { validateMarketOutlook } from "../../server/briefingExtensions";
import { groundedNumbers } from "../../server/briefingValidation";
import { adaptMacroData, parseCitation } from "../entities/briefing";
import { unavailableNight } from "../../server/kisBriefing";
import { futuresFlowIndicator } from "../../server/futuresForeignFlow";

const dates = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26"];
function row(id, metric) {
  const contracts = id === "KOSPI200_FOREIGN_FUTURES", values = contracts ? [0, 0, 0, 0, metric] : [100, 100, 100, 100, 100 + metric];
  return { id, name: id, unit: contracts ? "계약" : id === "UST10Y" ? "%" : id === "USDKRW" ? "KRW" : "pt", status: "ok", source: contracts ? "kis" : "yahoo", value: values[4], change: values[4] - values[3], changePct: metric,
    fiveDayChange: metric, fiveDayChangePct: metric, fiveDaySum: contracts ? metric : null, consecutiveDays: 1, asOf: dates[4], history: dates.map((date, i) => ({ date, value: values[i] })) };
}
const bands = ["상승", "소폭 상승", "보합", "소폭 하락", "하락"];
describe("literal team analysis rules", () => {
  for (const [id, small, large] of [["NASDAQ", .5, 1.5], ["UST10Y", .5, 2], ["SOX", 1, 4], ["KOSPI200_FOREIGN_FUTURES", 1500, 4500]]) {
    const epsilon = id === "KOSPI200_FOREIGN_FUTURES" ? 1 : .000001;
    it.each([[large + epsilon, "상승"], [large, "소폭 상승"], [small + epsilon, "소폭 상승"], [small, "보합"], [0, "보합"], [-small, "보합"], [-small - epsilon, "소폭 하락"], [-large, "소폭 하락"], [-large - epsilon, "하락"]])(`${id} metric %s -> %s`, (metric, band) => {
      const result = macroComment(row(id, metric)); expect(result.band).toBe(band); expect(result.text).toBe(copy[id][band]); expect(result.ruleId).toBe(`${id}:${band}`); expect(result).not.toHaveProperty("placeholder");
    });
  }
  it.each([[3.000001, "상승"], [3, "보합"], [2.999999, "보합"], [0, "보합"], [-2.999999, "보합"], [-3, "보합"], [-3.000001, "하락"]])("USDKRW %s -> %s", (metric, band) => {
    expect(macroComment(row("USDKRW", metric))).toMatchObject({ band, text: copy.USDKRW[band], ruleId: `USDKRW:${band}` });
  });
  it("preserves every supplied sentence verbatim, including 고퍼주", () => {
    expect(Object.fromEntries(Object.entries(MACRO_COMMENT_RULES).map(([id, rule]) => [id, rule.messages]))).toEqual(copy);
    expect(Object.values(copy).flatMap(Object.values)).toHaveLength(23);
    expect(copy.UST10Y["상승"]).toContain("고퍼주(성장주)");
    for (const id of ["NASDAQ", "UST10Y", "SOX", "KOSPI200_FOREIGN_FUTURES"]) expect(Object.keys(copy[id])).toEqual(bands);
  });
  it("uses relative rates rather than percentage points and never rounds before classification", () => {
    const input = row("UST10Y", 0); input.history = dates.map((date, i) => ({ date, value: i === 4 ? 5.09 : 4.99 })); input.fiveDayChangePct = (5.09 - 4.99) / 4.99 * 100;
    expect(macroAnalysisValue(input)).toBeCloseTo(2.004008016);
    expect(macroComment(input).band).toBe("상승");
    const nasdaq = row("NASDAQ", .4); nasdaq.history[0].value = 80;
    expect(macroComment(nasdaq).band).toBe("보합"); // Daily +.4%, five-day >25%.
  });
  it.each(["NASDAQ", "UST10Y", "SOX", "KOSPI200_FOREIGN_FUTURES", "USDKRW"])("returns explicit unavailable or incomplete %s opinions", id => {
    expect(macroComment({ ...row(id, 5), status: "unavailable" })).toMatchObject({ text: id === "KOSPI200_FOREIGN_FUTURES" ? "데이터 출처 확인 중" : "직전 미국장 기준 관측 자료가 없습니다", ruleId: "unavailable", band: null, metric: null });
    const metricKey = id === "NASDAQ" ? "changePct" : id === "KOSPI200_FOREIGN_FUTURES" ? "fiveDaySum" : "fiveDayChangePct";
    for (const value of [null, NaN, Infinity]) expect(macroComment({ ...row(id, 5), [metricKey]: value })).toMatchObject({ text: "추세를 비교할 관측일이 부족합니다", ruleId: "insufficient", band: null, metric: null });
    if (id !== "NASDAQ") for (const length of [0, 1, 4, 6]) expect(macroComment({ ...row(id, 5), history: Array.from({ length }, (_, i) => ({ date: `2026-10-${20 + i}`, value: 100 })) })).toMatchObject({ text: "추세를 비교할 관측일이 부족합니다", ruleId: "insufficient" });
  });
  it("uses NASDAQ daily change even without a five-observation history", () => {
    expect(macroComment({ ...row("NASDAQ", 2), history: [], fiveDayChangePct: -10 })).toMatchObject({ text: copy.NASDAQ["상승"], ruleId: "NASDAQ:상승", metric: 2 });
    expect(macroComment({ ...row("NASDAQ", 2), changePct: null })).toMatchObject({ ruleId: "insufficient" });
  });
  it("ignores a legacy placeholder flag while adapting cached comments", () => {
    const legacy = { ...row("NASDAQ", 2), comment: { text: copy.NASDAQ["상승"], ruleId: "NASDAQ:상승", placeholder: true } };
    const adapted = adaptMacroData({ indicators: [], preOpen: [legacy] }).preOpen[0];
    expect(adapted.comment.text).toBe(copy.NASDAQ["상승"]);
    expect(adapted.comment).not.toHaveProperty("placeholder");
  });
});

describe("SOX shared Yahoo/pre-open path and citations", () => {
  it("collects only mock Yahoo data and publishes the five-card order", async () => {
    const times = dates.map(date => Date.parse(date + "T20:00:00Z") / 1000), now = Date.parse("2026-10-27T08:00:00Z");
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ chart: { result: [{ timestamp: times,
      meta: { exchangeTimezoneName: "America/New_York", regularMarketTime: times[4], regularMarketPrice: 104, previousClose: 103, currentTradingPeriod: { regular: { start: times[4] - 23400, end: times[4] } } }, indicators: { quote: [{ close: [100, 101, 102, 103, 104] }] } }] } }) }));
    const result = await createMarketMacro({ transport, now: () => now, reference: async () => null, night: async () => unavailableNight(), foreignFlow: async () => futuresFlowIndicator([]) })({});
    expect(transport.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("^SOX"))).toBe(true);
    expect(MACRO_UNIVERSE.some(row => row.id === "SOX")).toBe(false);
    expect(result.indicators.some(row => row.id === "SOX")).toBe(false);
    expect(result.preOpen.map(row => row.id)).toEqual(["NASDAQ", "UST10Y", "SOX", "KOSPI200_FOREIGN_FUTURES", "USDKRW"]);
    expect(result.preOpen.find(row => row.id === "SOX").history.map(row => row.date)).toEqual(dates);
    expect(adaptMacroData(result).preOpen.find(row => row.id === "SOX").value).toBe(104); expect(parseCitation("M:SOX").isValid).toBe(true);
  });
  it("does not fill a missing SOX observation and keeps old responses compatible", () => {
    const nasdaq = { ...row("NASDAQ", 1), asOf: "2026-10-26T20:00:00Z", session: "closed", history: row("NASDAQ", 1).history }, sox = { ...row("SOX", 5), history: row("SOX", 5).history.filter(p => p.date !== "2026-10-22") };
    const result = buildPreOpenIndicators([nasdaq, sox]); expect(result.find(row => row.id === "SOX").history).toHaveLength(4); expect(result.find(row => row.id === "SOX").comment.text).toBe("추세를 비교할 관측일이 부족합니다");
    expect(buildPreOpenIndicators([nasdaq]).some(row => row.id === "SOX")).toBe(false);
    expect(adaptMacroData({ asOf: null, indicators: [] }).preOpen).toBeUndefined();
  });
  it.each(["필라델피아 반도체 지수", "필라델피아 반도체", "반도체 지수", "SOX"])("binds %s and its quantities to SOX", alias => {
    const sox = { ...row("SOX", 5), name: "필라델피아 반도체 지수", comment: macroComment(row("SOX", 5)) }, input = { model: null, stocks: [], macro: { indicators: [], preOpen: [sox] } };
    expect(validateMarketOutlook({ stance: "중립", text: `${alias}는 105pt입니다. 중립입니다.`, citations: ["M:SOX"] }, input)).toBeNull();
    expect(groundedNumbers(`${alias}는 999pt입니다.`, input, { outlook: true })).toBe(false);
    expect(validateMarketOutlook({ stance: "중립", text: `${alias}는 105pt입니다. 중립입니다.`, citations: ["M:NASDAQ"] }, input)).toBe("invalid_citation");
  });
});
