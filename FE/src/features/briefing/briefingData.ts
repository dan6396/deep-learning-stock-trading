import type { CandidateData } from "../../entities/candidate";
import type { BackendStatus } from "../../types/backendStatus";
import type { AnalysisStatus } from "../../shared/api/queries";
import { formatNumber } from "../../shared/lib/format";

export function formatBillions(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 5_000_000) return "0.0억";
  return `${value > 0 ? "+" : ""}${formatNumber(value / 100_000_000, 1)}억`;
}
export function evidenceSummary(row: CandidateData) {
  const ranking = row.rank === null ? "모델 원본 순위 미제공" : `모델 예측 ${row.poolSize ?? "—"}종목 중 ${row.rank}위`;
  const { combinedNetBuy: amount, window } = row.supply;
  return `${ranking} · 외국인·기관 ${window === null ? "기간 미확인" : `${window}일`} 합계 ${amount === null ? "미제공" : amount > 0 ? "순매수" : amount < 0 ? "순매도" : "0원"}${amount === null || amount === 0 ? "" : ` ${formatBillions(amount)}`}`;
}
export function savedRunDuration(status?: BackendStatus, run?: AnalysisStatus): number | null {
  if (status?.marker.state !== "completed") return null;
  if (run?.status === "completed" && run.runId && run.runId === status.marker.runId && run.elapsedMs !== null && run.elapsedMs >= 0) return run.elapsedMs;
  const start = status.marker.startedAt && Date.parse(status.marker.startedAt), end = status.marker.finishedAt && Date.parse(status.marker.finishedAt);
  return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}
export function formatDuration(duration: number | null) {
  return duration === null ? "소요 미확인" : `소요 ${Math.floor(duration / 60_000)}분 ${Math.floor(duration % 60_000 / 1000)}초`;
}
