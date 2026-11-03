import { describe, expect, it } from "vitest";
import { validateMarketOutlook, selectMarketOutlook, applyNarrativeExtensions, MIN_DIRECTIONAL_OUTLOOK_INDICATORS, marketOutlookSignals, allowedOutlookStances, outlookCalibrationApplies } from "../../server/briefingExtensions";
import { templateNarrative } from "../../server/briefingNarrative";

const row = (id, band, extra = {}) => ({ id, name: id, status: "ok", unit: id === "UST10Y" ? "%" : id === "USDKRW" ? "원" : "pt", value: 100, change: 1, changePct: 1, fiveDayChange: 2, fiveDayChangePct: 2, history: [],
  comment: { text: `${id} 관측 자료입니다.`, ruleId: `${id}:${band}`, band, metric: 1 }, ...extra });
const input = rows => ({ model: null, stocks: [], macro: { indicators: [], preOpen: rows } });
const outlook = (stance, citations = ["M:NASDAQ"]) => ({ stance, text: `나스닥 관측을 바탕으로 코스피 장 초반은 ${stance}로 판단합니다.`, citations });
const stances = data => ["상승 우위", "하락 우위", "중립", "판단 보류"].filter(stance => validateMarketOutlook(outlook(stance), data) === null);

describe("marketOutlook directional stance follows market-implied indicator signals", () => {
  it("uses three as the minimum", () => expect(MIN_DIRECTIONAL_OUTLOOK_INDICATORS).toBe(3));
  it("inverts rates and USD/KRW: falling values are 상승 요인", () => {
    const signals = marketOutlookSignals(input([row("NASDAQ", "소폭 하락"), row("UST10Y", "소폭 하락"), row("SOX", "하락"), row("USDKRW", "보합")]));
    expect(signals.map(({ id, signal }) => [id, signal])).toEqual([["M:NASDAQ", "하락 요인"], ["M:UST10Y", "상승 요인"], ["M:SOX", "하락 요인"], ["M:USDKRW", "중립"]]);
  });
  it("rejects 하락 우위 for the 11/3 mix (2 하락 요인, 1 상승 요인, 1 중립) and allows 중립", () => {
    const data = input([row("NASDAQ", "소폭 하락"), row("UST10Y", "소폭 하락"), row("SOX", "하락"), row("USDKRW", "보합")]);
    expect(allowedOutlookStances(data)).toEqual(["중립", "판단 보류"]);
    expect(validateMarketOutlook(outlook("하락 우위"), data)).toBe("mixed_signals");
    expect(stances(data)).toEqual(["중립", "판단 보류"]);
  });
  it("requires an agreeing majority of at least three", () => {
    expect(stances(input([row("NASDAQ", "하락"), row("SOX", "하락"), row("UST10Y", "상승")]))).toEqual(["하락 우위", "중립", "판단 보류"]);
    // 2 상승 요인 vs 2 하락 요인 (rising rates and USD/KRW) is a split, not a direction.
    expect(stances(input([row("NASDAQ", "상승"), row("SOX", "상승"), row("UST10Y", "상승"), row("USDKRW", "상승")]))).toEqual(["중립", "판단 보류"]);
    expect(stances(input([row("NASDAQ", "상승"), row("SOX", "상승"), row("UST10Y", "하락"), row("USDKRW", "상승"), row("KOSPI200_FOREIGN_FUTURES", "하락", { unit: "계약" })]))).toEqual(["상승 우위", "중립", "판단 보류"]);
    expect(stances(input([row("NASDAQ", "상승"), row("SOX", "상승"), row("UST10Y", "하락"), row("USDKRW", "보합")]))).toEqual(["상승 우위", "중립", "판단 보류"]);
  });
  it.each([[[row("NASDAQ", "상승")]], [[row("NASDAQ", "상승"), row("SOX", "상승")]]])("rejects directional stances below the minimum as insufficient_indicators", rows => {
    const data = input(rows);
    for (const stance of ["상승 우위", "하락 우위"]) expect(validateMarketOutlook(outlook(stance), data)).toBe("insufficient_indicators");
    for (const stance of ["중립", "판단 보류"]) expect(validateMarketOutlook(outlook(stance), data)).toBeNull();
  });
  it("does not count unavailable indicators", () => {
    const data = input([row("NASDAQ", "상승"), { ...row("SOX", "상승"), status: "unavailable" }, { ...row("UST10Y", "하락"), status: "unavailable" }]);
    expect(validateMarketOutlook(outlook("상승 우위"), data)).toBe("insufficient_indicators");
  });
  it("recomputes a missing band with the team rule instead of treating it as neutral", () => {
    const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-23", "2026-10-26"];
    const legacy = { ...row("SOX", null), comment: { text: "관측 자료입니다.", ruleId: "legacy" }, history: days.map((date, i) => ({ date, value: 100 + i * 5 })), value: 120 };
    expect(marketOutlookSignals(input([legacy]))[0].signal).toBe("상승 요인");
  });
  it("falls back to the 판단 보류 template instead of salvaging sentences", () => {
    const data = input([row("NASDAQ", "상승")]), value = { ...outlook("상승 우위"), text: "나스닥은 전일 대비 상승했습니다. 코스피 장 초반은 상승 우위로 판단합니다." };
    expect(selectMarketOutlook(value, data)).toBeNull();
    const fixed = applyNarrativeExtensions({ ...templateNarrative(data, null), status: "llm" }, { marketOutlook: value }, data);
    expect(fixed.marketOutlook).toMatchObject({ stance: "판단 보류", source: "template" });
  });
});

describe("46.6%/50.6% calibration applies only after a NASDAQ rise", () => {
  const text = "직전 나스닥 상승 후 코스피 시가→종가 상승 비율은 46.6%로 같은 표본의 전체 상승일 비율 50.6%보다 낮았습니다. 중립입니다.";
  it("allows the comparison after a rise", () => {
    const data = input([row("NASDAQ", "상승", { change: 1 })]);
    expect(outlookCalibrationApplies(data)).toBe(true); expect(validateMarketOutlook({ ...outlook("중립"), text }, data)).toBeNull();
  });
  it.each([-1, 0])("rejects the comparison when NASDAQ changed by %s", change => {
    const data = input([row("NASDAQ", "하락", { change })]);
    expect(outlookCalibrationApplies(data)).toBe(false); expect(validateMarketOutlook({ ...outlook("중립"), text }, data)).toBe("calibration_mismatch");
  });
});
