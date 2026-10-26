import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RunReference } from "./RunReference";
import { RefreshCw } from "lucide-react";
import { queries } from "../../shared/api/queries";
import { apiClient } from "../../shared/api/client";
import { formatDate, formatRankScore, formatPercent } from "../../shared/lib/format";
import { useAppPaths } from "../../app/paths";
import type { PerformanceRun } from "../../types/performance";
import { predictionDirectionLabel } from "../briefing/PredictionDirection";
import "./performance.css";

export function classificationLabel(run: Pick<PerformanceRun, "kind" | "officialEligible">) {
  return run.kind === "adhoc" ? "수시 · 공식 집계 제외" : run.officialEligible === true ? "공식 · 검증 통과" : run.officialEligible === false ? "공식 요청 · 집계 제외" : "공식 요청 · 검증 대기";
}
const VISIBLE_RUNS = 3;
function runItem(run: PerformanceRun, showMagnitude: boolean) {
  const prediction = (value: number | null | undefined) => showMagnitude ? formatPercent(value) : predictionDirectionLabel(value);
  return <li key={run.runId}>
    <div className="performance-run-heading"><strong>{run.mode === "model_only" ? "모델 순위" : "뉴스 포함"}</strong><span>{classificationLabel(run)}</span></div>
    <RunReference value={run.runId} />
    <dl><div><dt>예측 기준일 → 목표 거래일</dt><dd>{run.baseDate ?? "분석 완료 후 생성"} → {run.targetDate ?? "KIS 거래일 확인 대기"}</dd></div>
      <div><dt>선별 / 가격 확보</dt><dd>{run.selectedCount} / {run.measuredCount}종목</dd></div>
      <div><dt>저장한 모델 값 / 실제 가격 수익률</dt><dd>{run.rankScore != null ? `순위 점수 ${formatRankScore(run.rankScore)}` : prediction(run.predictedReturn)} / {formatPercent(run.actualReturn)}</dd></div>
      <div><dt>완료 / 수집 시각</dt><dd>{formatDate(run.finishedAt, true)} / {formatDate(run.lastCollectedAt, true)}</dd></div></dl>
    <p className="performance-reason">{run.reason}</p>{run.error && <p className="performance-reason">{run.error}</p>}
    {!!run.measurements?.length && <details className="performance-measurements"><summary>종목별 예측·실제 가격 {run.measurements.length}종목</summary>
      <ul>{run.measurements.map(item => <li key={item.code}><strong>{item.name} · {item.code}</strong>
        <p>{item.date ?? "목표 거래일 확인 대기"} · 저장한 모델 값 {item.rankScore != null ? `순위 점수 ${formatRankScore(item.rankScore)}` : prediction(item.predictedReturn)}</p>
        <p>KIS 시가 {item.open === null ? "가격 수집 대기" : `${item.open.toLocaleString("ko-KR")}원`} → 종가 {item.close === null ? "가격 수집 대기" : `${item.close.toLocaleString("ko-KR")}원`} · 수익률 {formatPercent(item.actualReturn)}</p>
      </li>)}</ul>
    </details>}
    </li>;
}
export function PerformancePanel({ detailed = false, code }: { detailed?: boolean; code?: string }) {
  const paths = useAppPaths(), client = useQueryClient(), query = useQuery(queries.performance(code));
  const collect = useMutation({ mutationFn: () => apiClient.request("/api/performance/collect", { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["performance"] }) });
  const data = query.data, busy = collect.isPending || data?.collector.status === "running";
  return <section className={`performance-card${detailed ? " history-card" : " briefing-card"}`} aria-label={code ? "종목 성과 기록" : "성과 기록"}>
    <div className="performance-heading"><div><p className="performance-eyebrow">가격 기반 성과</p><h2>{code ? "종목 성과 기록" : "성과 기록"}</h2></div>
      {detailed && <button className="performance-collect" type="button" onClick={() => collect.mutate()} disabled={busy}><RefreshCw size={16} aria-hidden="true" />{busy ? "실제 가격 수집 중" : "실제 가격 수집"}</button>}
    </div>
    <p className="performance-description">선별 종목의 다음 거래일 시가→종가 수익률입니다. 종목별 동일 비중으로 계산하며 거래 비용은 차감하지 않았습니다.</p>
    {query.isPending && <p role="status">분석과 성과 기록을 조회하고 있습니다.</p>}
    {query.isError && <p role="status">성과 기록 조회 실패 · 다시 조회해 주세요.</p>}
    {collect.isError && <p role="status">수집 요청을 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.</p>}
    {data && <>
      <div className="performance-summaries">{data.summaries.map(summary => <article key={summary.mode}>
        <h3>{summary.mode === "model_only" ? "모델 전용 공식 성과" : "뉴스 포함 공식 성과"}</h3>
        <strong>{formatPercent(summary.cumulativeReturn)}</strong><span>최근 {summary.tradingDays}/20거래일 · 누적 가격 수익률</span>
        <p>일평균 {formatPercent(summary.averageReturn)} · 방향 적중률 {formatPercent(summary.hitRate)}</p>
      </article>)}</div>
      {data.reasons.map(reason => <p className="performance-reason" key={reason}>{reason}</p>)}
      {data.collector.error && <p className="performance-reason" role="status">{data.collector.error}</p>}
      {detailed && <>
        <details><summary>수집 정보</summary><p className="performance-description">종가는 목표 거래일 18:30 이후 수집합니다. 수집하지 못한 기간은 다음 분석 때 다시 확인합니다.</p>
        <p className="performance-description">최근 수집 확인 {formatDate(data.collector.checkedAt, true)} · 갱신 {formatDate(data.asOf, true)} · 최근 분석 최대 100건</p></details>
        <ol className="performance-runs">{data.runs.slice(0, VISIBLE_RUNS).map(run => runItem(run, Boolean(code)))}</ol>
        {data.runs.length > VISIBLE_RUNS && <details className="performance-older"><summary>이전 실행 {data.runs.length - VISIBLE_RUNS}건 더 보기</summary>
          <ol className="performance-runs" start={VISIBLE_RUNS + 1}>{data.runs.slice(VISIBLE_RUNS).map(run => runItem(run, Boolean(code)))}</ol>
        </details>}
      </>}
    </>}
    {!detailed && <Link className="performance-link" to={paths.history}>실행별 기록과 수집 상태 보기 →</Link>}
  </section>;
}
