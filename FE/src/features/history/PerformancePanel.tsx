import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { queries } from "../../shared/api/queries";
import { apiClient } from "../../shared/api/client";
import { formatDate, formatPercent } from "../../shared/lib/format";
import { useAppPaths } from "../../app/paths";
import type { PerformanceRun } from "../../types/performance";
import "./performance.css";

export function classificationLabel(run: Pick<PerformanceRun, "kind" | "officialEligible">) {
  return run.kind === "adhoc" ? "수시 · 공식 집계 제외" : run.officialEligible === true ? "공식 · 검증 통과" : run.officialEligible === false ? "공식 요청 · 집계 제외" : "공식 요청 · 검증 대기";
}
export function PerformancePanel({ detailed = false, code }: { detailed?: boolean; code?: string }) {
  const paths = useAppPaths(), client = useQueryClient(), query = useQuery(queries.performance(code));
  const collect = useMutation({ mutationFn: () => apiClient.request("/api/performance/collect", { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["performance"] }) });
  const data = query.data, busy = collect.isPending || data?.collector.status === "running";
  return <section className={`performance-card${detailed ? " history-card" : " briefing-card"}`} aria-label={code ? "종목 성과 기록" : "성과 기록"}>
    <div className="performance-heading"><div><p className="performance-eyebrow">PREDICTION TRACKING</p><h2>{code ? "종목 성과 기록" : "성과 기록"}</h2></div>
      {detailed && <button className="performance-collect" type="button" onClick={() => collect.mutate()} disabled={busy}><RefreshCw size={16} aria-hidden="true" />{busy ? "실제 가격 수집 중" : "실제 가격 수집"}</button>}
    </div>
    <p className="performance-description">고정 저장한 선별 종목의 다음 거래일 시가→종가 가격 수익률입니다. 동일 비중·비용 차감 전이며 실제 주문 손익이 아닙니다.</p>
    {query.isPending && <p role="status">저장된 실행과 성과 기록을 조회하고 있습니다.</p>}
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
        <p className="performance-description">로컬 서버는 한국시간 18시 이후·익일 오전에 15분마다 수집을 확인하며, 목표일 18:30 이후 종가를 수집합니다. 서버가 꺼져 있던 기간은 다음 실행 시 재수집합니다.</p>
        <p className="performance-description">수집 확인 {formatDate(data.collector.checkedAt, true)} · 저장 기준 {formatDate(data.asOf, true)} · 최근 실행 최대 100건 표시</p>
        <ol className="performance-runs">{data.runs.map(run => <li key={run.runId}>
          <div className="performance-run-heading"><strong>{run.mode === "model_only" ? "모델 예측만" : "뉴스 포함"}</strong><span>{classificationLabel(run)}</span></div>
          <p className="performance-run-id">실행 식별자 {run.runId}</p>
          <dl><div><dt>예측 기준일 → 목표 거래일</dt><dd>{run.baseDate ?? "분석 완료 후 생성"} → {run.targetDate ?? "KIS 거래일 확인 대기"}</dd></div>
            <div><dt>선별 / 가격 확보</dt><dd>{run.selectedCount} / {run.measuredCount}종목</dd></div>
            <div><dt>고정 예측 / 실제 가격 수익률</dt><dd>{formatPercent(run.predictedReturn)} / {formatPercent(run.actualReturn)}</dd></div>
            <div><dt>완료 / 수집 시각</dt><dd>{formatDate(run.finishedAt, true)} / {formatDate(run.lastCollectedAt, true)}</dd></div></dl>
          <p className="performance-reason">{run.reason}</p>{run.error && <p className="performance-reason">{run.error}</p>}
          {!!run.measurements?.length && <details className="performance-measurements"><summary>종목별 예측·실제 가격 {run.measurements.length}종목</summary>
            <ul>{run.measurements.map(item => <li key={item.code}><strong>{item.name} · {item.code}</strong>
              <p>{item.date ?? "목표 거래일 확인 대기"} · 고정 예측 {formatPercent(item.predictedReturn)}</p>
              <p>KIS 시가 {item.open === null ? "가격 수집 대기" : `${item.open.toLocaleString("ko-KR")}원`} → 종가 {item.close === null ? "가격 수집 대기" : `${item.close.toLocaleString("ko-KR")}원`} · 수익률 {formatPercent(item.actualReturn)}</p>
            </li>)}</ul>
          </details>}
        </li>)}</ol>
      </>}
    </>}
    {!detailed && <Link className="performance-link" to={paths.history}>실행별 기록과 수집 상태 보기 →</Link>}
  </section>;
}
