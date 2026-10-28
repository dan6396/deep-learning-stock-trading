import type { StockOpinionMetrics } from "../src/types/stockOpinionMetrics";
import { FEATURE_LABELS } from "../src/types/modelEvidence";
export function stockOpinionMetrics(row: Record<string, unknown>, meta: Record<string, unknown> = {}): StockOpinionMetrics {
  const number = (value: unknown) => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const pool = number(row.pred_pool_size);
  const rank = (value: unknown) => { const n = number(value); return n !== null && Number.isInteger(n) && n >= 1 && pool !== null && n <= pool ? n : null; };
  const lookbacks = ([20, 120] as const).flatMap(sessions => { const r = rank(row[`rank_lb${sessions}`]); return r !== null && pool ? [{ sessions, rank: r, topPercent: r / pool * 100 }] : []; });
  const features = (["f_rsi", "f_pct_b", "f_high"] as const).flatMap(key => {
    const percentile = number(row[`feat_pct_${key}`]); if (percentile === null || percentile <= 0 || percentile > 100 || !pool) return [];
    const side = percentile >= 50 ? "upper" as const : "lower" as const;
    return [{ key, label: FEATURE_LABELS[key], percentile, side, tailPercent: Math.min(100, side === "upper" ? 100 + 100 / pool - percentile : percentile) }];
  });
  return { rawRank: rank(Object.prototype.hasOwnProperty.call(meta, "rawModelRank") ? meta.rawModelRank : row.pred_rank),
    adjustedRank: rank(Object.prototype.hasOwnProperty.call(meta, "rawFinalRank") ? meta.rawFinalRank : row.final_rank), lookbacks,
    agreement: lookbacks.length === 2 && ["일치", "부분 일치", "불일치"].includes(String(row.model_agreement)) ? row.model_agreement as StockOpinionMetrics["agreement"] : null, features };
}
