import { describe, expect, it } from "vitest";
import { modelEvidence, adaptModelEvidence } from "./modelEvidence";
describe("actual input observations", () => {
  it("uses optional lookback ranks and feature percentiles without fabricating missing values", () => {
    const row = { score_kind: "rank_zscore", prediction_status: "ok", pred_rank: 1, pred_pool_size: 200, rank_score: 1.6 };
    expect(modelEvidence(row)).toMatchObject({ rank: 1, lookbacks: [], agreement: null, features: [] });
    const observed = modelEvidence({ ...row, rank_lb20: 2, rank_lb120: 3, score_lb20: 1.5, score_lb120: 1.7, model_agreement: "일치", feat_pct_f_close: 95, feat_pct_f_volume: 3, feat_pct_f_rsi: 52, feat_pct_f_low: 1 });
    expect(observed?.lookbacks.map(lb => lb.rank)).toEqual([2, 3]); expect(observed?.features.map(f => f.key)).toEqual(["f_low", "f_volume", "f_close"]);
    expect(observed?.features[2].tailPercent).toBe(5.5); expect(observed?.features[0].text).toContain("하위 1.00%");
    expect(adaptModelEvidence(observed)).toEqual(observed);
    expect(modelEvidence({ ...row, pred_rank: 201 })).toBeNull();
  });
});
