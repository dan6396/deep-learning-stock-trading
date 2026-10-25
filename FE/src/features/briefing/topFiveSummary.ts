import type { CandidateData } from "../../entities/candidate";
import { formatDate } from "../../shared/lib/format";

type PredictionRow = Pick<CandidateData, "rank" | "predictedReturn" | "baseDate" | "predictionTarget" | "rankScore" | "scoreKind">;

function directionCounts(values: number[]) {
  const parts = ([["상승", values.filter(value => value > 0).length], ["하락", values.filter(value => value < 0).length], ["보합", values.filter(value => value === 0).length]] as const).filter(([, count]) => count > 0);
  return parts.length === 1 ? `${parts[0][0]} ${parts[0][1]}종목` : parts.map(([label, count]) => `${label} ${count}`).join(" · ");
}
/** Summarize exactly the rows on screen, without inferring missing predictions or periods. */
export function topFiveSummary(rows: readonly PredictionRow[], pending = false, error = false) {
  const unavailable = (reason: string) => ({ range: "—", count: reason, period: "예측 기간 · 분석 기준일 미확인" });
  if (pending) return unavailable("모델 순위 조회 중");
  if (error) return unavailable("모델 순위 조회 실패 · 요약 미제공");
  if (rows.length === 0) return unavailable("표시할 모델 순위 없음");
  if (rows.length !== 5) return unavailable(`TOP5 미완성 · ${rows.length}종목 확인`);
  if (new Set(rows.map(row => row.rank)).size !== 5 || rows.some(row => row.rank === null || !Number.isInteger(row.rank) || row.rank < 1 || row.rank > 5)) return unavailable("원본 순위 1~5위 미확인 · 범위 미제공");
  const rankModel = rows.every(row => row.scoreKind === "rank_zscore");
  if (rankModel && rows.some(row => row.rankScore == null || !Number.isFinite(row.rankScore))) return unavailable("순위 점수 미제공");
  if (!rankModel && rows.some(row => typeof row.predictedReturn !== "number" || !Number.isFinite(row.predictedReturn))) return unavailable("원본 예측값 미제공 · 요약 미완성");
  const dates = new Set(rows.map(row => row.baseDate)), periods = new Set(rows.map(row => row.predictionTarget));
  if (dates.size > 1 || periods.size > 1) return unavailable("분석 기준일·예측 기간 불일치 · 범위 미제공");
  const date = rows[0].baseDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return unavailable("분석 기준일 미확인 · 범위 미제공");
  if (rows[0].predictionTarget !== "next_session_open_to_close") return unavailable("예측 기간 미확인 · 범위 미제공");
  if (rankModel) return { range: "상대 순위 상위 5종목", count: "20일·120일 동일 비중 · 상승/하락 판정 아님", period: `다음 거래일 시가→종가 상대 순위 · 분석 기준일 ${formatDate(date)}` };
  const values = rows.map(row => row.predictedReturn!);
  return {
    range: directionCounts(values),
    count: "원본 순위 1~5위 · 예측 방향",
    period: `다음 거래일 시가→종가 · 분석 기준일 ${formatDate(date)}`,
  };
}
