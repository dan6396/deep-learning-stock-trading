import { useQuery } from "@tanstack/react-query";
import type { IndexData } from "../../entities/market";
import type { DataResult } from "../../entities/source";
import { SOURCE_LABELS } from "../../entities/source";
import { PAPER_TRADING } from "../../entities/paperTrading";
import { queries } from "../../shared/api/queries";
import { useAnalysisRun } from "../../shared/api/analysis";
import { formatDate, formatNumber, formatPercent } from "../../shared/lib/format";
import { marketAssessment } from "./MarketOverview";
import { formatDuration, savedRunDuration } from "./briefingData";

export function BriefingSummary({ indices, pending, error, count }: { indices: DataResult<IndexData>[]; pending: boolean; error: boolean; count: number | null }) {
  const backend = useQuery(queries.backendStatus()), analysis = useAnalysisRun(), status = backend.data;
  const index = indices.find(item => item.data.symbol === "KOSPI200"), assessment = marketAssessment(indices);
  const completed = status?.marker.state === "completed", finishedAt = completed ? status.marker.finishedAt ?? status.marker.asOf : null;
  const direction = pending ? "pending" : assessment.startsWith("상승") ? "positive" : assessment.startsWith("하락") ? "negative" : "neutral";
  const recordDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  return <section className="briefing-summary-strip" aria-label="브리핑 요약">
    <article className="briefing-summary-market" aria-label="최근 지수 흐름"><p className="briefing-eyebrow">최근 지수 흐름</p><strong className="briefing-summary-value"><span className="briefing-regime-dot" data-direction={direction} aria-hidden="true" />{pending ? "지수 조회 중" : error && !indices.length ? "지수 조회 실패" : assessment}</strong>
      <p>코스피200 {formatNumber(index?.data.value, 2)} <span className={index?.data.changeRate != null && index.data.changeRate < 0 ? "briefing-fall" : index?.data.changeRate != null && index.data.changeRate > 0 ? "briefing-rise" : ""}>{formatPercent(index?.data.changeRate, "percent")}</span>{index && <span className="briefing-source-tag">{SOURCE_LABELS[index.source]}</span>}</p>
      <small>당일 지수 등락 기반 단순 판단{error && indices.length > 0 ? " · 이전 조회 결과" : ""}</small>
    </article>
    <article className="briefing-summary-paper" aria-label="고정 모의투자 기록"><p className="briefing-eyebrow">모의투자 기록 · {recordDate(PAPER_TRADING.startDate)}–{recordDate(PAPER_TRADING.endDate)}</p><strong className="briefing-summary-value briefing-paper-capital">{formatNumber(PAPER_TRADING.finalCapital / 10_000, 1)}만 원 <span className="briefing-fall">{formatPercent(PAPER_TRADING.modelReturnPercent, "percent")}</span></strong>
      <p>코스피200 대비 <strong className="briefing-rise">+{formatNumber(PAPER_TRADING.excessReturnPoints, 2)}%p</strong></p><div className="briefing-paper-footnote"><small>모의투자 · {PAPER_TRADING.tradingDays}거래일 · <span className="briefing-source-tag">고정 기록</span></small><details className="briefing-paper-details"><summary>기준</summary><p>{PAPER_TRADING.startDate.replace(/-/g, ".")}–{PAPER_TRADING.endDate.slice(5).replace("-", ".")} · 시작 {formatNumber(PAPER_TRADING.initialCapital / 10_000)}만 원 · 코스피200 {formatPercent(PAPER_TRADING.benchmarkReturnPercent, "percent")} ({formatNumber(PAPER_TRADING.benchmarkStart, 2)}→{formatNumber(PAPER_TRADING.benchmarkEnd, 2)}pt). 같은 시작자금 기준의 모의 기록이며 실시간 성과가 아닙니다.</p></details></div>
    </article>
    <article className="briefing-summary-data" aria-label="분석 및 데이터"><p className="briefing-eyebrow">분석 · 데이터</p><strong className="briefing-summary-value">{backend.isPending ? "실행 기록 조회 중" : finishedAt ? formatDate(finishedAt, true) : "완료 시각 미확인"}</strong>
      <p>{formatNumber(count ?? status?.results.rank.count)}종목 · {formatDuration(savedRunDuration(status, analysis.data?.data))}</p><small><span className="briefing-source-tag">{SOURCE_LABELS[status?.results.rank.source ?? "unknown"]}</span>{status?.runtime.state === "running" ? " · 새 분석 진행 중" : completed ? " · 최근 완료 기록" : " · 완료 기록 미확인"}</small>
      {(backend.isError || analysis.isError) && <small role="status">실행 상태 갱신 실패</small>}
    </article>
  </section>;
}
