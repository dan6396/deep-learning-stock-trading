import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { useAnalysisRun } from "../../shared/api/analysis";
import { queries } from "../../shared/api/queries";
import { SOURCE_LABELS } from "../../entities/source";
import { formatDate } from "../../shared/lib/format";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useAppPaths } from "../../app/paths";
import { useCandidateProduction, productionNotice } from "../briefing/candidateProduction";
import { availabilityMessage } from "../connection/ConnectionNotice";
import type { BackendStatus } from "../../types/backendStatus";
import "./history.css";
import { PerformancePanel } from "./PerformancePanel";

const statusLabels = { idle: "실행 중인 분석 없음", running: "분석 진행 중", completed: "최신 실행 완료", failed: "최신 실행 실패" };
function rawValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}
export function elapsedLabel(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 3 }).format((milliseconds % 60000) / 1000);
  return minutes ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}
export function progressUpdatedLabel(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(new Date(value).getTime())) return "미확인";
    value = new Date(value).toISOString();
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return "미확인";
  const formatted = formatDate(value, true);
  return formatted === "—" ? "미확인" : formatted;
}
const savedModeLabels = { full: "뉴스 포함 실행", model_only: "모델 전용 실행 · 뉴스 분석 미실행", unknown: "실행 방식 미확인" } as const;
const kindLabel = (kind: unknown) => kind === "official" ? "공식 기록 요청 · 성과 검증 별도" : kind === "adhoc" ? "수시 실행" : "구현 이전 실행 · 분류 정보 없음";
/** Read-only disk marker of the last stored run. It is not the current in-memory run and never an official or realized-performance record. */
function SavedRun({ status, current }: { status: BackendStatus | undefined; current: boolean }) {
  const marker = status?.marker;
  if (!status || !marker || (marker.state !== "completed" && marker.state !== "failed") || !marker.startedAt || !marker.finishedAt) return null;
  const elapsed = Date.parse(marker.finishedAt) - Date.parse(marker.startedAt);
  const sameRun = status.runtime.startedAt !== null && status.runtime.startedAt === marker.startedAt;
  return <section className="history-card" aria-labelledby="saved-run-heading" data-testid="history-saved-run"><h2 id="saved-run-heading">저장된 마지막 실행</h2>
    <p className="history-muted">서버가 디스크에 남긴 마지막 실행 기록입니다. 현재 실행 상태와 성과 적격 여부는 각각 별도로 확인합니다.</p>
    <p className="history-footnote">{kindLabel(marker.kind)} · 실행 식별자 {marker.runId ?? "구현 이전 기록에는 식별자가 없습니다."}</p>
    {sameRun ? <p data-testid="history-saved-same">위 최신 실행 상태와 같은 실행입니다.</p> : <dl className="history-facts">
      <div><dt>저장된 실행 결과</dt><dd data-testid="history-saved-status">{marker.state === "completed" ? "완료" : "실패"}</dd></div>
      <div><dt>실행 방식</dt><dd data-testid="history-saved-mode">{savedModeLabels[marker.mode]}</dd></div>
      <div><dt>시작 시각</dt><dd>{formatDate(marker.startedAt, true)}</dd></div>
      <div><dt>종료 시각</dt><dd>{formatDate(marker.finishedAt, true)}</dd></div>
      <div><dt>측정된 실행 시간</dt><dd data-testid="history-saved-elapsed">{Number.isFinite(elapsed) && elapsed >= 0 ? elapsedLabel(elapsed) : "—"}</dd></div>
      <div><dt>출처</dt><dd>{SOURCE_LABELS[marker.source]}</dd></div>
    </dl>}
    <p data-testid="history-saved-rank">{availabilityMessage("전체 순위", status.results.rank)}{status.results.rank.state === "available" && status.results.rank.count !== null ? ` · ${status.results.rank.count}종목` : ""}</p>
    {marker.mode === "model_only" && marker.state === "completed" && <p className="history-notice">모델 순위만 실행했습니다. 뉴스 보정 최종 후보는 생성되지 않았습니다.</p>}
    <p className="history-footnote">실행 분류와 공식 성과 적격 여부는 다릅니다. 가격 확보·공식 집계 여부는 아래 성과 기록에서 확인하세요.{current ? "" : " 현재 실행 상태는 별도로 확인하세요."}</p>
  </section>;
}
export function HistoryPage() {
  usePageTitle("분석 기록");
  const paths = useAppPaths(), analysis = useAnalysisRun(), candidates = useQuery(queries.candidates());
  const production = useCandidateProduction(candidates), notice = productionNotice(production), backend = useQuery(queries.backendStatus());
  const run = analysis.data?.data, modelOnlyRun = run?.status === "completed" && run.result?.mode === "model_only";
  // An empty array is a zero only when the final list was actually produced.
  const count = !candidates.data ? "—" : candidates.data.data.length > 0 || production === "produced" ? `${candidates.data.data.length}개`
    : production === "pending" ? "확인 중" : production === "unproduced" ? "미생성" : "미확인";
  const pending = analysis.isFetching || candidates.isFetching;
  async function refresh() { await Promise.all([analysis.refetch(), candidates.refetch(), backend.refetch()]); }
  return <div className="history-page">
    <div className="history-title"><div><p className="history-eyebrow">ANALYSIS RECORDS</p><h1>분석 기록</h1><p>지금 확인할 수 있는 실행 상태와 기록의 기준을 살펴보세요.</p></div><button type="button" onClick={() => void refresh()} disabled={pending}><RefreshCw aria-hidden="true" size={16} />{pending ? "조회 중" : "다시 조회"}</button></div>
    <section className="history-summary" aria-labelledby="history-summary-heading"><ShieldCheck aria-hidden="true" size={25} /><div><h2 id="history-summary-heading">검증 가능한 기록부터</h2><p>새 실행은 식별자·분류·예측을 고정 저장합니다. 20거래일 가격 기반 성과는 모델 전용과 뉴스 포함을 구분하며, 개장 전 완료·중복 여부·실제 가격 확보를 검증한 공식 요청만 집계합니다.</p></div></section>
    <div className="history-grid">
      <section className="history-card" aria-labelledby="latest-run-heading"><div className="history-section-title"><Clock3 aria-hidden="true" size={20} /><h2 id="latest-run-heading">최신 실행 상태</h2></div>
        {analysis.isPending && <p role="status">실행 상태를 조회하고 있습니다.</p>}
        {analysis.isError && <p role="status" className="history-notice">{run ? "이전 조회 상태 · 최신 상태 갱신 실패" : "실행 상태 조회 실패 · 다시 조회해 주세요."}</p>}
        <strong className="history-status" data-testid="history-status">{run ? modelOnlyRun ? "모델 실행 완료" : statusLabels[run.status] : "상태 미확인"}</strong>
        {modelOnlyRun && <p className="history-notice" data-testid="history-model-only">모델 순위만 실행했습니다. 뉴스 분석과 뉴스 보정 최종 후보는 실행되지 않았습니다. 실행 완료만으로 공식 성과가 확정되지 않습니다.</p>}
        {run?.status === "running" && <p role="status">진행 중인 동안 5초마다 상태를 확인합니다.</p>}
        {run?.status === "failed" && <p className="history-notice">실행이 완료되지 않았습니다. 현재 저장된 분석 결과와 별개로 확인하세요.</p>}
        <dl className="history-facts">
          <div><dt>측정된 경과 시간</dt><dd data-testid="history-elapsed">{elapsedLabel(run?.elapsedMs)}</dd></div>
          <div><dt>최근 상태 갱신</dt><dd data-testid="history-progress-updated">{progressUpdatedLabel(run?.progress?.updatedAt)}</dd></div>
          <div><dt>진행 메시지</dt><dd>{rawValue(run?.progress?.message)}</dd></div>
          <div><dt>제공된 오류</dt><dd>{run?.error || (run?.status === "completed" ? "없음" : run?.status === "failed" ? "오류 내용 미제공" : "—")}</dd></div>
          <div><dt>공식 / 수시 구분</dt><dd>{run?.status === "idle" ? "현재 실행 없음" : kindLabel(run?.kind)}</dd></div>
          <div><dt>실행 식별자</dt><dd>{run?.runId ?? (run?.status === "idle" ? "새 실행 시 발급" : "구현 이전 기록에는 식별자가 없습니다.")}</dd></div>
          <div><dt>출처</dt><dd>{analysis.data ? SOURCE_LABELS[analysis.data.source] : "—"}</dd></div>
          <div><dt>상태 기준 시각</dt><dd>{formatDate(analysis.data?.asOf, true)}</dd></div>
        </dl><p className="history-footnote">경과 시간은 제공된 측정값입니다. 최근 상태 갱신 시각을 확인할 수 없으면 미확인으로 표시합니다.</p>
      </section>
      <section className="history-card" aria-labelledby="current-results-heading"><h2 id="current-results-heading">현재 분석 결과</h2><p className="history-muted">저장된 결과의 존재만으로 특정 실행의 완료나 공식 실행 여부를 확인할 수 없습니다.</p>
        {candidates.isPending && <p role="status">현재 결과를 조회하고 있습니다.</p>}
        {candidates.isError && <p role="status" className="history-notice">{candidates.data ? "이전 조회 결과 · 결과 갱신 실패" : "현재 결과 조회 실패"}</p>}
        <dl className="history-facts"><div><dt>조회된 후보 수</dt><dd data-testid="history-candidate-count">{count}</dd></div><div><dt>공식 / 수시 구분</dt><dd>{kindLabel(backend.data?.marker.kind)}</dd></div><div><dt>실행 식별자</dt><dd>{backend.data?.marker.runId ?? "구현 이전 기록 · 식별자 없음"}</dd></div><div><dt>결과 출처</dt><dd>{candidates.data ? SOURCE_LABELS[candidates.data.source] : "—"}</dd></div><div><dt>저장 기준 시각</dt><dd>{production === "unproduced" ? "해당 없음 · 최종 후보 미생성" : formatDate(candidates.data?.asOf, true)}</dd></div></dl>
        {candidates.data?.source === "sample" && <p className="history-notice">예시 데이터 · 실제 분석 결과가 아닙니다.</p>}
        {candidates.data?.data.length === 0 && (production === "produced" ? <p>현재 조회된 최종 후보가 없습니다.</p>
          : production === "pending" ? <p role="status">최종 후보 생성 여부를 확인하고 있습니다.</p>
          : <p data-candidate-production={production}>{notice}</p>)}
        <Link className="history-link" to={paths.briefing}>브리핑에서 근거 확인<ArrowRight aria-hidden="true" size={16} /></Link>
        {production === "unproduced" && <Link className="history-link" to={paths.rank}>전체 모델 순위 보기<ArrowRight aria-hidden="true" size={16} /></Link>}
      </section>
    </div>
    <SavedRun status={backend.data} current={run?.status === "running"} />
    <PerformancePanel detailed />
    <section className="history-card history-criteria" aria-labelledby="history-criteria-heading"><h2 id="history-criteria-heading">기록을 읽는 기준</h2><div><article><h3>실행 상태</h3><p>최신 실행의 진행 여부입니다. 서버 재시작 후에도 실행별 고정 기록은 디스크에 남습니다.</p></article><article><h3>분석 결과</h3><p>실행 식별자에 연결된 예측값입니다. 수시 실행과 구현 이전 결과는 소급하여 공식 성과에 넣지 않습니다.</p></article><article><h3>가격 기반 성과</h3><p>공식 요청 중 기준일·모드별 최초 고정 예측을 사용합니다. 기준일 15:30 이후·목표일 09:00 이전 완료가 필요합니다. KIS 다음 거래일 시가→종가를 비용 차감 전 동일 비중으로 계산하며 실제 주문 손익과 다릅니다.</p></article></div></section>
  </div>;
}
