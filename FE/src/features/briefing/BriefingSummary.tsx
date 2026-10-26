import { useQuery } from "@tanstack/react-query";
import type { IndexData } from "../../entities/market";
import type { DataResult } from "../../entities/source";
import { SOURCE_LABELS } from "../../entities/source";
import type { CandidateData } from "../../entities/candidate";
import { queries } from "../../shared/api/queries";
import { useAnalysisRun } from "../../shared/api/analysis";
import { formatDate, formatNumber, formatPercent } from "../../shared/lib/format";
import { marketAssessment } from "./MarketOverview";
import { formatDuration, savedRunDuration } from "./briefingData";
import { topFiveSummary } from "./topFiveSummary";

export function BriefingExecutionBar({ pool }: { pool: number | null }) {
  const backend = useQuery(queries.backendStatus()), analysis = useAnalysisRun(), status = backend.data;
  const briefing = useQuery(queries.briefing());
  const running = analysis.data?.data.status === "running" || status?.runtime.state === "running";
  const previousReason = running ? "running" : briefing.data?.previousRun?.reason;
  const completed = status?.marker.state === "completed";
  const finishedAt = briefing.data?.model?.finishedAt ?? (completed && !previousReason ? status.marker.finishedAt ?? status.marker.asOf : null);
  const duration = briefing.data?.model?.elapsedMs ?? (!previousReason ? savedRunDuration(status, analysis.data?.data) : null);
  const resultPool = briefing.data?.model?.poolSize ?? pool ?? (!previousReason ? status?.results.rank.count : null);
  return (
    <div className="briefing-execution-bar" role="status" aria-label="분석 실행 상태">
      <span className="briefing-execution-item">
        분석 완료 <strong>{finishedAt ? formatDate(finishedAt, true) : "—"}</strong>
      </span>
      <span className="briefing-execution-divider">·</span>
      <span className="briefing-execution-item">
        모집단 <strong>{formatNumber(resultPool)}종목</strong> ({formatDuration(duration)})
      </span>
      <span className="briefing-execution-divider">·</span>
      <span className="briefing-execution-item">
        {previousReason === "running" ? "새 분석 진행 중 · 이전 결과 표시" : previousReason === "failed" ? "새 분석 실패 · 이전 결과 표시" : "마지막 분석"}
      </span>
      {briefing.data && briefing.data.kind !== "official" && <span className="briefing-execution-item briefing-execution-error">
        {briefing.data.kind === "adhoc" ? "수시 분석" : "분류 미확인"}
      </span>}
      {(backend.isError || analysis.isError) && (
        <>
          <span className="briefing-execution-divider">·</span>
          <span className="briefing-execution-error" role="status">실행 상태 갱신 실패</span>
        </>
      )}
    </div>
  );
}

export function BriefingSummary({ indices, pending, error, count, rows, rankPending, rankError, rankSource }: { indices: DataResult<IndexData>[]; pending: boolean; error: boolean; count: number | null; rows: CandidateData[]; rankPending: boolean; rankError: boolean; rankSource?: DataResult<unknown>["source"] }) {
  const backend = useQuery(queries.backendStatus()), analysis = useAnalysisRun(), status = backend.data;
  const running = analysis.data?.data.status === "running" || status?.runtime.state === "running";
  const index = indices.find(item => item.data.symbol === "KOSPI200"), assessment = marketAssessment(indices);
  const completed = status?.marker.state === "completed", finishedAt = completed ? status.marker.finishedAt ?? status.marker.asOf : null;
  const direction = pending ? "pending" : assessment.startsWith("상승") ? "positive" : assessment.startsWith("하락") ? "negative" : "neutral";
  const prediction = topFiveSummary(rows, rankPending, rankError);
  return <section className="briefing-summary-strip" aria-label="브리핑 요약">
    <article className="briefing-summary-market" aria-label="최근 지수 흐름"><p className="briefing-eyebrow">최근 지수 흐름</p><strong className="briefing-summary-value"><span className="briefing-regime-dot" data-direction={direction} aria-hidden="true" />{pending ? "지수 조회 중" : error && !indices.length ? "지수 조회 실패" : assessment}</strong>
      <p>코스피200 {formatNumber(index?.data.value, 2)} <span className={index?.data.changeRate != null && index.data.changeRate < 0 ? "briefing-fall" : index?.data.changeRate != null && index.data.changeRate > 0 ? "briefing-rise" : ""}>{formatPercent(index?.data.changeRate, "percent")}</span>{index && <span className="briefing-source-tag">{SOURCE_LABELS[index.source]}</span>}</p>
      <small>당일 지수 등락 기반 단순 판단{error && indices.length > 0 ? " · 이전 조회 결과" : ""}</small>
    </article>
    <article className="briefing-summary-prediction" aria-label="TOP5 예측 요약"><p className="briefing-eyebrow">TOP5 예측 요약</p><strong className="briefing-summary-value">{prediction.range}</strong>
      <p>{prediction.count}</p><small>{prediction.period}</small>{rankSource === "sample" && <small>예시 데이터</small>}
    </article>
    <article className="briefing-summary-data" aria-label="분석 및 데이터"><p className="briefing-eyebrow">분석 · 데이터</p><strong className="briefing-summary-value">{finishedAt ? formatDate(finishedAt, true) : "—"}</strong>
      <p>{formatNumber(count ?? status?.results.rank.count)}종목 · {formatDuration(savedRunDuration(status, analysis.data?.data))}</p><small>{running ? "분석 진행 중" : completed ? "최신 완료 결과" : "완료 결과 확인 필요"}</small>
      {(backend.isError || analysis.isError) && <small role="status">실행 상태 갱신 실패</small>}
    </article>
  </section>;
}
