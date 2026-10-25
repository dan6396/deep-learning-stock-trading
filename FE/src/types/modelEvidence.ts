/** Observations of actual model inputs; these are not feature attribution. */
export const FEATURE_LABELS = {
  f_open: "전일 종가 대비 시가", f_high: "전일 종가 대비 고가", f_low: "전일 종가 대비 저가", f_close: "전일 종가 대비 종가",
  f_volume: "최근 60일 대비 거래량", f_rsi: "상대강도 지표", f_macd: "가격 대비 이동평균 차이", f_macd_signal: "이동평균 차이의 신호선",
  f_pct_b: "가격 밴드 내 종가 위치", f_norm_bw: "이동평균 대비 가격 밴드 폭", f_rel_bw: "종가 대비 가격 밴드 폭",
} as const;
export type FeatureKey = keyof typeof FEATURE_LABELS;
export type FeatureObservation = { key: FeatureKey; label: string; percentile: number; side: "upper" | "lower"; tailPercent: number; text: string };
export type ModelEvidence = {
  rank: number; poolSize: number; topPercent: number; rankScore: number;
  lookbacks: { sessions: 20 | 120; rank: number; score: number }[];
  agreement: "일치" | "부분 일치" | "불일치" | null; features: FeatureObservation[]; note: string;
};

export function modelEvidence(row: Record<string, unknown>): ModelEvidence | null {
  const num = (value: unknown) => typeof value === "number" ? Number.isFinite(value) ? value : null : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
  const rank = num(row.pred_rank), poolSize = num(row.pred_pool_size), rankScore = num(row.rank_score);
  if (row.score_kind !== "rank_zscore" || row.prediction_status !== "ok" || rank === null || poolSize === null || rankScore === null
    || !Number.isInteger(rank) || !Number.isInteger(poolSize) || rank < 1 || rank > poolSize) return null;
  const lookbacks = ([20, 120] as const).flatMap(sessions => {
    const rank = num(row[`rank_lb${sessions}`]), score = num(row[`score_lb${sessions}`]);
    return rank !== null && score !== null && Number.isInteger(rank) && rank >= 1 && rank <= poolSize ? [{ sessions, rank, score }] : [];
  });
  const agreement = lookbacks.length === 2 && ["일치", "부분 일치", "불일치"].includes(String(row.model_agreement)) ? row.model_agreement as ModelEvidence["agreement"] : null;
  const features = (Object.entries(FEATURE_LABELS) as [FeatureKey, string][]).flatMap(([key, label]): FeatureObservation[] => {
    const percentile = num(row[`feat_pct_${key}`]);
    if (percentile === null || percentile <= 0 || percentile > 100) return [];
    const side = percentile >= 50 ? "upper" : "lower", tailPercent = Math.min(100, side === "upper" ? 100 + 100 / poolSize - percentile : percentile);
    return [{ key, label, percentile, side, tailPercent, text: `${label} 관측값이 ${poolSize}종목 중 ${side === "upper" ? "상위" : "하위"} ${tailPercent.toFixed(2)}%입니다.` }];
  }).sort((a, b) => a.tailPercent - b.tailPercent || a.key.localeCompare(b.key)).slice(0, 3);
  return { rank, poolSize, topPercent: rank / poolSize * 100, rankScore, lookbacks, agreement, features,
    note: "입력 특징의 상대적 위치이며 모델 기여도나 순위의 원인을 뜻하지 않습니다. 가격·거래량 특징은 서로 겹칠 수 있습니다." };
}

export function adaptModelEvidence(raw: unknown): ModelEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as ModelEvidence, row: Record<string, unknown> = { score_kind: "rank_zscore", prediction_status: "ok", pred_rank: value.rank, pred_pool_size: value.poolSize, rank_score: value.rankScore, model_agreement: value.agreement };
  if (Array.isArray(value.lookbacks)) for (const lb of value.lookbacks) if (lb && [20, 120].includes(lb.sessions)) { row[`rank_lb${lb.sessions}`] = lb.rank; row[`score_lb${lb.sessions}`] = lb.score; }
  if (Array.isArray(value.features)) for (const feature of value.features) if (feature && feature.key in FEATURE_LABELS) row[`feat_pct_${feature.key}`] = feature.percentile;
  return modelEvidence(row);
}
