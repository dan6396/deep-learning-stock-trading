import { formatRankScore } from "../../shared/lib/format";

export type PredictionDirectionState = "rise" | "fall" | "flat" | "unavailable";
const labels: Record<PredictionDirectionState, string> = { rise: "상승", fall: "하락", flat: "보합", unavailable: "—" };

export function predictionDirection(value: number | null | undefined): PredictionDirectionState {
  if (value == null || !Number.isFinite(value)) return "unavailable";
  return value > 0 ? "rise" : value < 0 ? "fall" : "flat";
}
export function predictionDirectionLabel(value: number | null | undefined) { return labels[predictionDirection(value)]; }

/** Direction-only view of a model prediction; the magnitude is shown only inside the full stock report. */
export function PredictionDirection({ value, rankScore, scoreKind }: { value: number | null | undefined; rankScore?: number | null; scoreKind?: string | null }) {
  if (scoreKind === "rank_zscore") return <span className="prediction-direction" data-direction="relative" title="비교 종목 내 상대 순위 점수 · 수익률/상승확률 아님">{formatRankScore(rankScore)}</span>;
  const state = predictionDirection(value);
  if (state === "unavailable") return <span className="prediction-direction" data-direction={state}>—</span>;
  return <span className="prediction-direction" data-direction="relative" title="이전 모델 출력 · 실제 가격 등락이 아닙니다">
    <span>{labels[state]}</span>
  </span>;
}
