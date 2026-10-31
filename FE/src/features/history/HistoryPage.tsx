import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { useAnalysisRun } from "../../shared/api/analysis";
import { queries } from "../../shared/api/queries";
import { SOURCE_LABELS } from "../../entities/source";
import { formatDate } from "../../shared/lib/format";
import { analysisProgressText } from "../../shared/lib/analysisDisplay";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useAppPaths } from "../../app/paths";
import { useCandidateProduction, productionNotice } from "../briefing/candidateProduction";
import type { BackendStatus } from "../../types/backendStatus";
import "./history.css";
import { PerformancePanel } from "./PerformancePanel";
import { RunReference } from "./RunReference";

const statusLabels = { idle: "실행 중인 분석 없음", running: "분석 진행 중", completed: "최신 실행 완료", failed: "최신 실행 실패" };
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
const savedModeLabels = { full: "뉴스 포함", model_only: "모델 분석", unknown: "분석 방식 미확인" } as const;
const kindLabel = (kind: unknown) => kind === "official" ? "공식" : kind === "adhoc" ? "수시" : "분류 미확인";
const runMeta = (kind: unknown, at: string | null | undefined) => [kind === "official" || kind === "adhoc" ? kindLabel(kind) : null, formatDate(at, true)].filter(value => value && value !== "—").join(" · ");
/** Read-only disk marker of the last stored run. It is not the current in-memory run and never an official or realized-performance record. */
function SavedRun({ status, embedded = false }: { status: BackendStatus | undefined; embedded?: boolean }) {
  const marker = status?.marker;
  if (!status || !marker || (marker.state !== "completed" && marker.state !== "failed") || !marker.startedAt || !marker.finishedAt) return null;
  const elapsed = Date.parse(marker.finishedAt) - Date.parse(marker.startedAt);
  const sameRun = status.runtime.startedAt !== null && status.runtime.startedAt === marker.startedAt;
  const facts = <details><summary>{embedded ? "분석 실행 정보" : "자세히"}</summary><RunReference value={marker.runId} />
    {sameRun ? <p data-testid="history-saved-same">위 최신 실행 상태와 같은 실행입니다.</p> : <dl className="history-facts">
      <div><dt>분석 결과</dt><dd data-testid="history-saved-status">{marker.state === "completed" ? "완료" : "실패"}</dd></div>
      <div><dt>실행 방식</dt><dd data-testid="history-saved-mode">{savedModeLabels[marker.mode]}</dd></div>
      <div><dt>공식 / 수시 구분</dt><dd>{kindLabel(marker.kind)}</dd></div>
      <div><dt>시작 시각</dt><dd>{formatDate(marker.startedAt, true)}</dd></div>
      <div><dt>종료 시각</dt><dd>{formatDate(marker.finishedAt, true)}</dd></div>
      <div><dt>측정된 실행 시간</dt><dd data-testid="history-saved-elapsed">{Number.isFinite(elapsed) && elapsed >= 0 ? elapsedLabel(elapsed) : "—"}</dd></div>
      <div><dt>출처</dt><dd>{SOURCE_LABELS[marker.source]}</dd></div>
    </dl>}
    <p data-testid="history-saved-rank">전체 순위 {status.results.rank.state === "available" && status.results.rank.count !== null ? `${status.results.rank.count}종목` : "미확인"}</p>
    </details>;
  return embedded ? <div data-testid="history-saved-run">{facts}</div> : <section className="history-card" aria-labelledby="saved-run-heading" data-testid="history-saved-run"><h2 id="saved-run-heading">마지막 분석</h2>
    <p className="history-muted">{runMeta(marker.kind, marker.finishedAt)}</p>{facts}</section>;
}
export function HistoryPage() {
  usePageTitle("분석 기록");
  const paths = useAppPaths(), analysis = useAnalysisRun(), candidates = useQuery(queries.candidates());
  const production = useCandidateProduction(candidates), notice = productionNotice(production), backend = useQuery(queries.backendStatus());
  const run = analysis.data?.data, modelOnlyRun = run?.status === "completed" && run.result?.mode === "model_only";
  // An empty array is a zero only when the final list was actually produced.
  const count = !candidates.data ? "—" : candidates.data.data.length > 0 || production === "produced" ? `${candidates.data.data.length}개`
    : production === "pending" ? "확인 중" : production === "unproduced" ? "미생성" : "미확인";
  const storedRank = backend.data?.results.rank;
  const modelResults = production === "unproduced" && backend.data?.analysisMode === "model_only"
    && storedRank?.state === "available" && storedRank.count !== null && storedRank.count >= 0;
  const resultCount = modelResults ? String(storedRank.count) + "종목" : count;
  const resultAsOf = modelResults ? storedRank.asOf : candidates.data?.asOf;
  const resultSource = modelResults ? storedRank.source : candidates.data?.source;
  const marker = backend.data?.marker, resultTime = Date.parse(resultAsOf ?? "");
  // A timestamp inside the completed run identifies its result without comparing rounded labels.
  // Keep separate cards when the active/failed run can refer to a different result.
  const sameStoredResult = marker?.state === "completed" && run?.status !== "running" && run?.status !== "failed"
    && backend.data?.runtime.state !== "running" && backend.data?.runtime.state !== "failed"
    && resultSource === "cache" && (modelResults || (candidates.data?.data.length ?? 0) > 0) && Number.isFinite(resultTime)
    && resultTime >= Date.parse(marker.startedAt ?? "") && resultTime <= Date.parse(marker.finishedAt ?? "");
  const pending = analysis.isFetching || candidates.isFetching;
  async function refresh() { await Promise.all([analysis.refetch(), candidates.refetch(), backend.refetch()]); }
  const isSimpleStatus = run?.status === "idle" || (!run && !analysis.isPending && !analysis.isError);
  return <div className="history-page">
    <div className="history-title"><div><h1>분석 기록</h1><p>최근 분석과 실제 가격으로 계산한 성과를 확인하세요.</p></div><button type="button" onClick={() => void refresh()} disabled={pending}><RefreshCw aria-hidden="true" size={16} />{pending ? "조회 중" : "다시 조회"}</button></div>
    <section className="history-summary" aria-labelledby="history-summary-heading"><ShieldCheck aria-hidden="true" size={25} /><div><h2 id="history-summary-heading">실제 가격으로 계산한 성과</h2><p>분석 당시의 종목과 다음 거래일 가격을 비교합니다. 공식 기록은 분석 시각과 가격 자료를 검증한 뒤 집계합니다.</p></div></section>
    <div className="history-grid">
      <section className={`history-card ${isSimpleStatus ? "is-compact-status" : ""}`} aria-labelledby="latest-run-heading"><div className="history-section-title"><Clock3 aria-hidden="true" size={20} /><h2 id="latest-run-heading">최신 실행 상태</h2>{isSimpleStatus && <span className="history-status-divider" aria-hidden="true">·</span>}{isSimpleStatus && <strong className="history-status" data-testid="history-status">{run ? statusLabels[run.status] : "상태 미확인"}</strong>}</div>
        {analysis.isPending && <p role="status">실행 상태를 조회하고 있습니다.</p>}
        {analysis.isError && <p role="status" className="history-notice">{run ? "이전 조회 상태 · 최신 상태 갱신 실패" : "실행 상태 조회 실패 · 다시 조회해 주세요."}</p>}
        {!isSimpleStatus && <strong className="history-status" data-testid="history-status">{run ? modelOnlyRun ? "모델 실행 완료" : statusLabels[run.status] : "상태 미확인"}</strong>}
        {run?.status === "running" && <p role="status">진행 중인 동안 5초마다 상태를 확인합니다.</p>}
        {run?.status === "failed" && <p className="history-notice">실행이 완료되지 않았습니다. 현재 저장된 분석 결과와 별개로 확인하세요.</p>}
        <p className="history-muted">{runMeta(run?.kind, analysis.data?.asOf)}</p>
        <details className="history-runtime-details"><summary>자세히</summary><dl className="history-facts">
          <div><dt>측정된 경과 시간</dt><dd data-testid="history-elapsed">{elapsedLabel(run?.elapsedMs)}</dd></div>
          <div><dt>최근 상태 갱신</dt><dd data-testid="history-progress-updated">{progressUpdatedLabel(run?.progress?.updatedAt)}</dd></div>
          <div><dt>진행 메시지</dt><dd>{analysisProgressText(run?.progress?.message, run?.progress?.message ? "분석 데이터 처리 중" : "—")}</dd></div>
          <div><dt>제공된 오류</dt><dd>{analysisProgressText(run?.error, run?.error ? "분석 기록을 확인해 주세요." : run?.status === "completed" ? "없음" : run?.status === "failed" ? "오류 내용 미제공" : "—")}</dd></div>
          <div><dt>공식 / 수시 구분</dt><dd>{run?.status === "idle" ? "현재 실행 없음" : kindLabel(run?.kind)}</dd></div>
          <div><dt>실행 기록</dt><dd><RunReference value={run?.runId} /></dd></div>
          <div><dt>출처</dt><dd>{analysis.data ? SOURCE_LABELS[analysis.data.source] : "—"}</dd></div>
          <div><dt>상태 기준 시각</dt><dd>{formatDate(analysis.data?.asOf, true)}</dd></div>
        </dl></details>
      </section>
      <section className="history-card" aria-labelledby="current-results-heading"><h2 id="current-results-heading">현재 분석 결과</h2>
        {candidates.isPending && <p role="status">현재 결과를 조회하고 있습니다.</p>}
        {candidates.isError && <p role="status" className="history-notice">{candidates.data ? "이전 조회 결과 · 결과 갱신 실패" : "현재 결과 조회 실패"}</p>}
        {resultAsOf && <p className="history-muted">{formatDate(resultAsOf, true)}</p>}
        <details><summary>자세히</summary><dl className="history-facts"><div><dt>{modelResults ? "모델 순위 종목 수" : "조회된 후보 수"}</dt><dd data-testid="history-candidate-count">{resultCount}</dd></div><div><dt>결과 출처</dt><dd>{resultSource ? SOURCE_LABELS[resultSource] : "—"}</dd></div></dl></details>
        {resultSource === "sample" && <p className="history-notice">예시 데이터 · 실제 분석 결과가 아닙니다.</p>}
        {modelResults && <p className="history-info">모델 순위 {storedRank.count}종목 · 상위 목록 {Math.min(5, storedRank.count!)}종목</p>}
        {!modelResults && candidates.data?.data.length === 0 && (production === "produced" ? <p>현재 조회된 최종 후보가 없습니다.</p>
          : production === "pending" ? <p role="status">최종 후보 생성 여부를 확인하고 있습니다.</p>
          : <p data-candidate-production={production}>{notice}</p>)}
        {sameStoredResult && <SavedRun status={backend.data} embedded />}
        <Link className="history-link" to={paths.briefing}>브리핑에서 근거 확인<ArrowRight aria-hidden="true" size={16} /></Link>
        {production === "unproduced" && <Link className="history-link" to={paths.rank}>전체 모델 순위 보기<ArrowRight aria-hidden="true" size={16} /></Link>}
      </section>
    </div>
    {!sameStoredResult && <SavedRun status={backend.data} />}
    <PerformancePanel detailed />
    <p className="history-footnote">실측 성과는 실제 주문 손익이 아니며 미래 수익을 보장하지 않습니다.</p>
    <section className="history-card history-criteria" aria-labelledby="history-criteria-heading"><h2 id="history-criteria-heading">기록을 읽는 기준</h2><details><summary>집계 기준 자세히</summary><div><article><h3>분석 상태</h3><p>최근 분석의 진행 여부입니다. 진행 중·완료·실패로 구분합니다.</p></article><article><h3>분석 결과</h3><p>분석 당시 선별된 종목 목록입니다. 수시 분석과 분류 정보가 없는 과거 분석은 공식 성과에 넣지 않습니다.</p></article><article><h3>가격 기반 성과</h3><p>공식 분석 중 기준일·분석 방식별 첫 결과를 집계합니다. 기준일 15:30 이후·다음 거래일 09:00 이전에 완료한 분석이 대상입니다. KIS 다음 거래일 시가→종가를 동일 비중으로 계산하며 거래 비용은 차감하지 않았습니다.</p></article></div></details></section>
  </div>;
}
