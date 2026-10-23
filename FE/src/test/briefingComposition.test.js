import { describe, expect, it, vi } from "vitest";
import { compositionPerformance, createCompositionProvider } from "../../server/briefingComposition";
function run(date, actualReturn, overrides = {}) { return { mode: "model_only", modelId: "plain_20_120_rank_mean_v1", scoreKind: "rank_zscore", kind: "official",
  officialEligible: true, outcomeState: "complete", actualReturn, targetDate: date, ...overrides }; }
describe("TOP5 equal-weight reference composition", () => {
  it("uses only measured model-only official portfolios, one per date, capped at ten days", () => {
    const runs = Array.from({ length: 12 }, (_, index) => run(`2026-10-${String(index + 1).padStart(2, "0")}`, index % 2 ? 0.01 : -0.01));
    runs.push(run("2026-10-12", 0.03));
    runs.push(run("2026-10-13", 0.99, { mode: "full" }), run("2026-10-14", 0.99, { kind: "adhoc" }), run("2026-10-15", 0.99, { officialEligible: false }),
      run("2026-10-16", null), run("2026-10-17", 0.99, { modelId: "other" }));
    const result = compositionPerformance({ runs, asOf: "2026-10-12T09:00:00Z" });
    expect(result.measuredDays).toBe(10); expect(result.recent[0]).toEqual({ date: "2026-10-12", returnPct: 3 });
    expect(result.averageReturnPct).toBeCloseTo(0.2); expect(result.positiveDays).toBe(5); expect(result.recent.at(-1).date).toBe("2026-10-03");
  });
  it("reports zero measured days with no historical record", () => {
    expect(compositionPerformance({ runs: [], asOf: null })).toEqual({ asOf: null, measuredDays: 0, averageReturnPct: null, positiveDays: 0, recent: [] });
  });
  it("adds the fixed note, sectors and deterministic common cautions; keeps unavailable history null", async () => {
    const input = { model: null, macro: { indicators: [{ status: "unavailable" }] }, stocks: [{ code: "005930", news: { articles: [] } }] };
    const performance = vi.fn(async () => ({ runs: [], asOf: null })), sectors = vi.fn(async () => ({ sectors: [{ name: "전기전자", codes: ["005930"] }], sectorSource: "KIS" }));
    const result = await createCompositionProvider(performance, sectors)(input, {});
    expect(result.note).toBe("최적화하지 않은 동일 비중(각 20%) 참고 구성입니다. 투자 권유가 아닙니다.");
    expect(result.basis).toBe("equal_weight_reference"); expect(result.performance.measuredDays).toBe(0);
    expect(result.commonCautions.join(" ")).toContain("모든 후보 종목"); expect(result.commonCautions.join(" ")).toContain("일부 시장 지표");
    expect(result.commonCautions.join(" ")).not.toMatch(/순위 점수|공식 성과 기록이 없습니다/);
    const failed = await createCompositionProvider(async () => { throw new Error("read"); }, async () => ({ sectors: null, sectorSource: null }))(input, {});
    expect(failed.performance).toBeNull(); expect(failed.sectors).toBeNull();
    expect(failed.commonCautions).toContain("공식 성과 자료를 확인하지 못했습니다.");
  });
});
