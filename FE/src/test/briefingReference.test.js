import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => {
  const api = { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() }; return { ...api, default: api };
});
import { readFile } from "node:fs/promises";
import { getNasdaqReference, parseNasdaqReference } from "../../server/briefingReference";
function fixture() {
  const metric = (count, total) => ({ value: count / total * 100, numerator: count, denominator: total, unit: "percent", ci95: [30, 80] });
  const definition = { metrics: { kospi_up_given_nasdaq_up: metric(6, 10), kospi_down_given_nasdaq_down: metric(5, 10),
    kospi_up_baseline: metric(12, 20), kospi_down_baseline: metric(8, 20), up_lift_vs_baseline: { ci95: [-1, 1] }, down_lift_vs_baseline: { ci95: [-2, 2] } } };
  return { schema_version: 1, periods: [{ name: "requested", start: "2025-10-22", end: "2026-10-22", alignments: { latest_prior: {
    last_kospi_date: "2026-10-20", definitions: { close_to_close: structuredClone(definition), open_to_close: structuredClone(definition) } } } }] };
}
beforeEach(() => vi.clearAllMocks());
describe("static Nasdaq/KOSPI reference", () => {
  it("maps the one-year latest-prior sample, conditional denominator, baseline and CI", () => {
    const result = parseNasdaqReference(fixture());
    expect(result).toMatchObject({ periodStart: "2025-10-22", periodEnd: "2026-10-22", lastObservedDate: "2026-10-20" });
    expect(result.rows).toHaveLength(4); expect(result.rows[0]).toMatchObject({ definition: "close_to_close", condition: "nasdaq_up", count: 6, total: 10, ratioPct: 60, baselinePct: 60, ciLowPct: 30 });
    expect(result.note).toContain("모델 예측 구간");
    expect(result.source).toBe("Yahoo Finance 일봉, 팀 재검증(2026-10-23)");
  });
  it("rejects malformed data, inconsistent ratios, invalid CI and non-year periods", () => {
    expect(parseNasdaqReference(null)).toBeNull();
    for (const edit of [data => { data.periods[0].end = "2027-10-22"; }, data => { data.periods[0].alignments.latest_prior.definitions.close_to_close.metrics.kospi_up_given_nasdaq_up.value = 99; },
      data => { data.periods[0].alignments.latest_prior.definitions.open_to_close.metrics.kospi_down_given_nasdaq_down.ci95 = [90, 10]; }]) {
      const data = fixture(); edit(data); expect(parseNasdaqReference(data)).toBeNull();
    }
  });
  it("describes baseline differences only when measured ratios and confidence intervals support them", () => {
    const data = fixture();
    expect(parseNasdaqReference(data).note).toContain("전일 종가→종가 구간에서는 같은 기간 기준선과 뚜렷한 차이가 관찰되지 않았습니다");
    const definitions = data.periods[0].alignments.latest_prior.definitions;
    definitions.close_to_close.metrics.kospi_up_given_nasdaq_up.ci95 = [61, 80];
    expect(parseNasdaqReference(data).note).not.toContain("기준선보다 높게");
    Object.assign(definitions.close_to_close.metrics.kospi_up_given_nasdaq_up, { numerator: 7, value: 70 });
    expect(parseNasdaqReference(data).note).toContain("나스닥 상승 조건의 관측 비율이 같은 기간 기준선보다 높게");
    expect(parseNasdaqReference(data).note).toContain("모델 예측 구간인 시가→종가 구간에서는 같은 기간 기준선과 뚜렷한 차이가 관찰되지 않았습니다");
    Object.assign(definitions.close_to_close.metrics.kospi_up_given_nasdaq_up, { numerator: 3, value: 30, ci95: [20, 40] });
    expect(parseNasdaqReference(data).note).toContain("나스닥 상승 조건의 관측 비율이 같은 기간 기준선보다 낮게");
    definitions.close_to_close.metrics.kospi_up_given_nasdaq_up.ci95 = null;
    expect(parseNasdaqReference(data).note).toContain("신뢰구간 자료가 부족해 기준선과의 차이를 판단하기 어렵습니다");
  });
  it("reads once per root and returns null for missing or corrupt files", async () => {
    readFile.mockResolvedValueOnce(JSON.stringify(fixture()));
    const env = { PIPELINE_PROJECT_ROOT: "fixture-valid" };
    const original = await getNasdaqReference(env); original.rows[0].ratioPct = 99;
    expect((await getNasdaqReference(env)).rows[0].ratioPct).toBe(60); expect(readFile).toHaveBeenCalledOnce();
    readFile.mockRejectedValueOnce(new Error("missing")); expect(await getNasdaqReference({ PIPELINE_PROJECT_ROOT: "fixture-missing" })).toBeNull();
    readFile.mockResolvedValueOnce("{corrupt"); expect(await getNasdaqReference({ PIPELINE_PROJECT_ROOT: "fixture-corrupt" })).toBeNull();
  });
});
