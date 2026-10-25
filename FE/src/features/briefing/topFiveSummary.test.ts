import { describe, expect, it } from "vitest";
import { topFiveSummary } from "./topFiveSummary";

const rows = (values: (number | null)[] = [.0039577617929895705, .003919560499959298, .003840753026558162, .0038075680598780135, .0037625877410731798]) => values.map((predictedReturn, index) => ({ rank: index + 1, predictedReturn, baseDate: "2026-10-08", predictionTarget: "next_session_open_to_close" }));

describe("displayed TOP5 prediction summary", () => {
  it("converts fractions and summarizes the displayed original model values", () => {
    expect(topFiveSummary(rows())).toEqual({ range: "상승 5종목", count: "원본 순위 1~5위 · 예측 방향", period: "다음 거래일 시가→종가 · 분석 기준일 2026. 10. 08." });
    expect(topFiveSummary(rows([-.02, -.01, 0, .01, .03]))).toMatchObject({ range: "상승 2 · 하락 2 · 보합 1" });
    expect(topFiveSummary(rows([-.02, 0, 0, 0, 0]))).toMatchObject({ range: "하락 1 · 보합 4" });
  });
  it.each([null, NaN, Infinity, -Infinity])("does not drop or impute unavailable prediction %s", value => {
    const result = topFiveSummary(rows([.01, .02, value, .03, .04]));
    expect(result.range).toBe("—"); expect(result.count).toContain("원본 예측값 미제공");
  });
  it.each([0, 1, 4])("does not present a partial list of %s as TOP5", count => {
    expect(topFiveSummary(rows().slice(0, count)).range).toBe("—");
    expect(topFiveSummary(rows().slice(0, count)).count).toContain(count ? "TOP5 미완성" : "표시할 모델 순위 없음");
  });
  it.each(["baseDate", "predictionTarget"] as const)("does not combine mismatched %s", key => {
    const mixed = rows(); mixed[4][key] = key === "baseDate" ? "2026-10-07" : "different_period";
    expect(topFiveSummary(mixed)).toMatchObject({ range: "—", count: "분석 기준일·예측 기간 불일치 · 범위 미제공" });
  });
  it("requires confirmed date and prediction period, even when every row matches", () => {
    for (const baseDate of [null, "", "invalid", "2026-02-30"]) expect(topFiveSummary(rows().map(row => ({ ...row, baseDate }))).range).toBe("—");
    for (const predictionTarget of [null, "", "unknown"]) expect(topFiveSummary(rows().map(row => ({ ...row, predictionTarget }))).range).toBe("—");
  });
  it("does not summarize stale results during a loading or failed request", () => {
    expect(topFiveSummary(rows(), true).count).toBe("모델 순위 조회 중");
    expect(topFiveSummary(rows(), false, true)).toMatchObject({ range: "—", count: "모델 순위 조회 실패 · 요약 미제공" });
  });
  it.each([[2, 3, 4, 5, 6], [1, 2, 3, 4, 4], [1, 2, 3, 4, 4.5], [1, 2, 3, 4, null]])("requires original integer ranks 1 through 5: %s", (...ranks) => {
    expect(topFiveSummary(rows().map((row, index) => ({ ...row, rank: ranks[index] })))).toMatchObject({ range: "—", count: "원본 순위 1~5위 미확인 · 범위 미제공" });
  });
});
