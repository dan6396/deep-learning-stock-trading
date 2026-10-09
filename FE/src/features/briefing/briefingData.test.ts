import { describe, expect, it } from "vitest";
import { adaptCandidate } from "../../entities/candidate";
import { adaptBackendStatus } from "../../shared/api/queries";
import { backendStatusBody, pipelineRow } from "../../test/dataFixtures";
import { evidenceSummary, formatBillions, savedRunDuration } from "./briefingData";

describe("briefing factual summaries", () => {
  it("uses raw supply totals and rank without recommendations, filling neither missing nor zero", () => {
    const row = adaptCandidate(pipelineRow({ pred_rank: 1, pred_pool_size: 199, foreign_net_buy_sum: -430_000_000, inst_net_buy_sum: -450_000_000, supply_window: 5 })).data;
    const summary = evidenceSummary({ ...row, supply: { ...row.supply, window: 5 } });
    expect(summary).toBe("모델 예측 199종목 중 1위 · 외국인·기관 5일 합계 순매도 -8.8억");
    expect(evidenceSummary({ ...row, rank: null, supply: { ...row.supply, window: null, combinedNetBuy: null } })).toBe("모델 원본 순위 미제공 · 외국인·기관 기간 미확인 합계 미제공");
    expect(formatBillions(0)).toBe("0.0억"); expect(formatBillions(null)).toBe("—");
  });
  it.each([-4_999_999, -1, -0, 0, 1, 4_999_999])("avoids signed rounded zero for amount %s", amount => {
    expect(formatBillions(amount)).toBe("0.0억");
  });
  it("uses the same minus character as percent formatting at and beyond the rounding boundary", () => {
    expect(formatBillions(-5_000_000)).toBe("-0.1억"); expect(formatBillions(5_000_000)).toBe("+0.1억");
    expect(formatBillions(-880_000_000)).toBe("-8.8억");
  });
  it("does not mix a previous completed result duration with another ongoing run", () => {
    const status = adaptBackendStatus(backendStatusBody({ state: "not_produced" }, { marker: { runId: "saved", startedAt: "2026-10-08T00:00:00Z", finishedAt: "2026-10-08T00:00:17Z" } }));
    const run = { runId: "new", status: "running" as const, elapsedMs: 900000, progress: null, error: null, result: null };
    expect(savedRunDuration(status, run)).toBe(17000);
    expect(savedRunDuration(status, { ...run, status: "completed", runId: "saved", elapsedMs: 18000 })).toBe(18000);
    expect(savedRunDuration({ ...status, marker: { ...status.marker, state: "absent" } }, run)).toBeNull();
    expect(savedRunDuration({ ...status, marker: { ...status.marker, startedAt: null } }, run)).toBeNull();
  });
});
