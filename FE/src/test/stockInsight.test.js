import { describe, expect, it, vi } from "vitest";
import { createStockInsightService } from "../../server/stockInsight";
import { validateModelRows } from "../../server/pipelineResults";
import { pipelineRow } from "./dataFixtures";
const sensitivity = { status: "preparing", metrics: [], conditional: null, samples: 0, complete: false, periodStart: null, periodEnd: null, source: "test", note: "과거 관측입니다." };
describe("read-only stock insight", () => {
  it("keeps old model outputs readable and uses only already validated summaries", async () => {
    const row = pipelineRow(); Object.assign(row.input_row, { ticker: "005930", score_kind: "rank_zscore", rank_score: 1.6, pred_rank: 1, pred_pool_size: 200, prediction_status: "ok" });
    const rank = vi.fn(async () => [row]), briefing = vi.fn(async () => ({ stocks: [{ code: "005930", news: { articles: [{ id: "N:005930:1", title: "공시", url: "https://example.com/news", source: "발행처", pubDate: null }] } }], narrative: { status: "llm", stocks: [{ code: "005930", source: "llm", summary: "공시 제목을 확인했습니다.", citations: ["N:005930:1", "R:005930"] }] }, model: { runStartedAt: "2026-10-22T01:00:00Z" } }));
    const observations = { get: vi.fn(async () => ({ sensitivities: [sensitivity] })) };
    const service = createStockInsightService({ rank, briefing, observations });
    const result = await service("005930", {}); expect(result.model.lookbacks).toEqual([]); expect(result.model.features).toEqual([]);
    expect(result.news).toMatchObject({ source: "llm", bodyCollected: false, summary: "공시 제목을 확인했습니다.", citations: ["N:005930:1"] });
    expect(result.sensitivity.status).toBe("preparing"); expect(result.cautions.join(" ")).toContain("하루 등락만으로");
    await expect(service("000000", {})).rejects.toThrow("6자리"); expect(rank).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed optional model observations while allowing historical files without them", () => {
    const row = { ticker: "005930", score_kind: "rank_zscore", model_id: "plain_20_120_rank_mean_v1", rank_score: "1.6", ensemble_pred_return: "", prediction_target: "next_session_open_to_close", prediction_status: "ok", pred_rank: "1", pred_pool_size: "200", prediction_base_date: "2026-10-22" };
    expect(validateModelRows([row]).poolSize).toBe(200);
    const extra = { rank_lb20: "1", rank_lb120: "22", score_lb20: "1.5", score_lb120: "1.7", model_agreement: "부분 일치", feat_pct_f_close: "99" };
    expect(validateModelRows([{ ...row, ...extra }]).ok).toHaveLength(1);
    for (const bad of [{ rank_lb20: "201" }, { model_agreement: "일치" }, { feat_pct_f_close: "100.01" }, { score_lb120: "NaN" }]) expect(() => validateModelRows([{ ...row, ...extra, ...bad }])).toThrow();
  });
});
