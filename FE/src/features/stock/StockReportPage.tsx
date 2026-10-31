import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Info } from "lucide-react";
import { queries, queryKeys } from "../../shared/api/queries";
import { formatDate, formatNumber, formatPercent, formatRankScore, formatSessionDate, formatWon } from "../../shared/lib/format";
import { usePageTitle } from "../../hooks/usePageTitle";
import { briefingSignals, resolveMembership, type CandidateMembership } from "../briefing/membership";
import { useCandidateProduction, productionNotice } from "../briefing/candidateProduction";
import { mergeCandidateDetail } from "../briefing/DetailPanel";
import { useNextSession } from "../briefing/ModelTopFiveTable";
import { SourceMeta } from "../briefing/SourceMeta";
import { PastObservationTag } from "../briefing/PastObservationTag";
import { SignalView } from "../briefing/SignalView";
import { ReportChart } from "./ReportChart";
import { StockInsightDetails } from "./StockInsightSection";
import { useStockInsight } from "./useStockInsight";
import { StockNewsCard, reportNewsArticles } from "./StockNewsCard";
import { StockAiOpinionCard } from "./StockAiOpinionCard";
import type { OpinionCitationTarget } from "./StockCitationChips";
import { formatModelPercent } from "../../entities/modelEvidence";
import { useAppPaths } from "../../app/paths";
import { WatchToggle, WatchlistNotice } from "../watchlist/WatchToggle";
import "../briefing/briefing.css";
import "./stock.css";

const membershipLabels: Record<CandidateMembership, string> = { pending: "최종 후보 여부 확인 중", unknown: "최종 후보 여부 미확인", candidate: "최종 후보", nonCandidate: "최종 후보 외 종목" };
const tone = (value: number | null | undefined) => value != null && value > 0 ? "report-rise" : value != null && value < 0 ? "report-fall" : "";

function StockReport({ code }: { code: string }) {
  const paths = useAppPaths();
  const location = useLocation();
  const from = location.state?.rankReturnTo;
  const rankReturnTo = typeof from === "string" && (from === paths.rank || from.startsWith(`${paths.rank}?`)) ? from : null;
  const stock = useQuery(queries.stock(code)), quote = useQuery(queries.quote(code)), candidates = useQuery(queries.candidates()), client = useQueryClient();
  const candidate = candidates.data?.data.find(row => row.code === code), detail = mergeCandidateDetail(candidate, stock.data?.data);
  const insight = useStockInsight(code);
  const rank = detail ? detail.rank : insight.data?.model?.rank ?? null, poolSize = detail ? detail.poolSize : insight.data?.model?.poolSize ?? null;
  const rankBased = detail?.scoreKind === "rank_zscore" || (!detail && Boolean(insight.data?.model));
  const rankScore = detail ? detail.rankScore : insight.data?.model?.rankScore;
  const articles = reportNewsArticles(code, detail?.news ?? [], insight.data?.news);
  const citationTargets = new Map<string, OpinionCitationTarget>();
  if (detail?.rank != null || insight.data?.model) citationTargets.set(`R:${code}`, { targetId: `report-model-card-${code}`, label: "모델 순위" });
  if (rankBased && rank != null && poolSize != null) {
    citationTargets.set(`R:${code}:raw`, { targetId: `stock-model-raw-${code}`, label: "원본 모델 순위" });
    citationTargets.set(`E:${code}:1`, { targetId: `report-model-card-${code}`, label: "모델 순위 근거" });
    citationTargets.set(`C:${code}:1`, { targetId: `stock-rank-interpretation-${code}`, label: "점수 해석 주의" });
  }
  if (insight.data?.model?.lookbacks.length === 2) for (const lb of insight.data.model.lookbacks) citationTargets.set(`R:${code}:${lb.sessions}`, { targetId: `stock-model-${code}-${lb.sessions}`, label: `${lb.sessions}일 모델` });
  for (const feature of insight.data?.model?.features ?? []) citationTargets.set(`E:${code}:feature:${feature.key}`, { targetId: `stock-feature-${code}-${feature.key}`, label: feature.label });
  articles.forEach((article, index) => article.citationIds.forEach(id => citationTargets.set(id, { targetId: article.targetId, label: `관련 기사 ${index + 1}` })));
  const production = useCandidateProduction(candidates), notice = productionNotice(production);
  const membership: CandidateMembership = resolveMembership(candidates, Boolean(candidate), production);
  const signals = detail ? briefingSignals(detail, membership, production) : null, modelMeta = candidate ? candidates.data : stock.data;
  // News-adjusted (final) figures exist only when a news run produced the final list.
  const showFinal = production === "produced", nextSession = useNextSession(detail?.baseDate);
  if (showFinal && detail?.finalRank != null) citationTargets.set(`R:${code}:adjusted`, { targetId: `stock-model-adjusted-${code}`, label: "최종 보정 순위" });
  const nextSessionLabel = detail?.predictionTarget === "next_session_open_to_close" && nextSession.data ? formatSessionDate(nextSession.data) : null;
  usePageTitle(`${detail?.name ?? quote.data?.data?.name ?? code} · 종목 리포트`);
  async function refresh() {
    const keys = [queryKeys.stock(code), queryKeys.quote(code), queryKeys.candidates(), ["chart", code], ["stock-insight", code]];
    await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey })));
    await Promise.all(keys.map(queryKey => client.refetchQueries({ queryKey })));
  }
  return <div className="stock-report" data-report-code={code}>
    {/* 1. Header: Back link, stock name, membership, actions */}
    <div className="report-title-row">
      <div>
        <Link className="report-back" to={rankReturnTo ?? `${paths.briefing}?code=${code}`}>
          <ArrowLeft aria-hidden="true" size={16} />{rankReturnTo ? "전체 순위로" : "브리핑으로"}
        </Link>
        <h1>{detail?.name ?? quote.data?.data?.name ?? code}</h1>
        <p className="report-muted" data-membership={membership}>{code}{production === "unproduced" ? "" : ` · ${membershipLabels[membership]}`}</p>
      </div>
      <div className="report-title-actions">
        <button className="stock-report-button" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" size={16} />다시 조회
        </button>
        <WatchToggle code={code} name={detail?.name ?? quote.data?.data?.name} />
      </div>
    </div>
    <WatchlistNotice />

    {candidates.isError && <p className="report-notice" role="status">{candidates.data ? "이전 조회 결과 · 후보 갱신 실패 · 현재 멤버십 미확인" : "후보 조회 실패 · 현재 멤버십 미확인"}</p>}
    {notice && production !== "unproduced" && !candidates.isError && !candidate && <p className="report-notice" role="status" data-candidate-production={production}><Info aria-hidden="true" size={16} />{notice}</p>}
    {stock.isError && <p className="report-notice" role="status">{stock.data?.data ? "이전 조회 결과 · 분석 갱신 실패" : stock.error.message.includes("예시") ? "예시 분석 응답은 제공하지 않습니다. 후보 목록의 분석을 표시합니다." : stock.error.message.includes("코드") ? "종목 코드가 일치하지 않아 분석 응답을 표시하지 않습니다." : "종목 분석 조회 실패 · 후보 목록의 분석을 표시합니다."}</p>}
    {stock.isPending && <p className="report-muted" role="status">종목 분석을 조회하고 있습니다.</p>}
    {stock.isSuccess && stock.data.data === null && <p className="report-notice" role="status">상세 분석 결과가 없습니다.{candidate ? " 후보 목록 원본을 표시합니다." : ""}</p>}
    {(candidates.data?.source === "sample" || stock.data?.source === "sample") && <p className="report-notice" role="status">예시 데이터 · 실제 분석 결과가 아닙니다.</p>}

    <nav className="report-section-nav" aria-label="리포트 빠른 탐색"><a href="#report-price-title">가격</a>{(detail || insight.data) && <a href="#report-news-title">기사</a>}<a href="#report-model-title">모델 근거</a></nav>
    {/* Price summary and history share one card. */}
    <section className="report-card report-price-card" aria-labelledby="report-price-title">
      <div className="report-price-summary">
        <div>
          <h2 id="report-price-title">가격</h2>
          {!quote.data?.data ? quote.isError && <p className="report-price-missing">시세 조회 실패. 아래 차트의 마지막 관측가를 참고하세요.</p> : <>
          <p className="report-price" data-testid="report-price">{formatWon(quote.data?.data?.currentPrice)}</p>
          <p className={tone(quote.data?.data?.changeRate)}>
            전일 대비 {formatPercent(quote.data?.data?.changeRate, "percent")} · {formatWon(quote.data?.data?.change)}
          </p></>}
        </div>
        {quote.data && (
          <div className="report-price-meta">
            <SourceMeta source={quote.data.source} asOf={quote.data.asOf} label="시세 기준 시각" />
            <PastObservationTag asOf={quote.data.asOf} />
          </div>
        )}
      </div>
    <dl className="report-model-compact" aria-label="모델 핵심 요약">
      <div><dt>원본 모델 순위</dt><dd>{rank != null ? `${formatNumber(rank)}위` : "미제공"}</dd></div>
      <div><dt>{rankBased ? "순위 점수" : "모델 예측"}</dt><dd>{rankBased ? rankScore != null ? formatRankScore(rankScore, 2) : "미제공" : detail?.predictedReturn != null ? formatPercent(detail.predictedReturn) : "미제공"}</dd></div>
      <div><dt>예측 대상일</dt><dd>{nextSessionLabel ?? "미제공"}</dd></div>
      <div><dt>20·120일 모델 일치</dt><dd>{insight.data?.model?.agreement ?? "미제공"}</dd></div>
    </dl>
      {quote.isPending && <p role="status" className="report-muted">시세를 조회하고 있습니다.</p>}
      {quote.isError && quote.data && <p className="report-notice" role="status">이전 조회 결과 · 시세 갱신 실패</p>}
      {quote.isSuccess && quote.data.data === null && <p className="report-muted">시세 결과가 없습니다.</p>}
      <dl className="report-stats report-price-stats">
        {quote.data?.data?.volume != null && <div><dt>거래량</dt><dd>{formatNumber(quote.data.data.volume)}</dd></div>}
        {quote.data?.data?.tradingValue != null && <div><dt>거래대금</dt><dd>{formatWon(quote.data.data.tradingValue)}</dd></div>}
      </dl>
      <ReportChart key={code} code={code} />
    </section>

    <StockAiOpinionCard opinion={insight.data?.aiOpinion} news={insight.data?.news} targets={citationTargets} />
    {(detail || insight.data) && <StockNewsCard articles={articles} news={insight.data?.news} targets={citationTargets} showSummary={!insight.data?.aiOpinion} />}

    {/* 3. 모델 순위 요약 한 줄 */}
    <section id={`report-model-card-${code}`} tabIndex={-1} className="report-card report-model-card stock-citation-target" data-report-signal={signals ? "model" : undefined} aria-labelledby="report-model-title">
      <h2 id="report-model-title">{showFinal ? "모델 순위와 최종 보정" : "모델 순위"}</h2>
      <div className="report-model-topline">
      <p id={`stock-model-raw-${code}`} tabIndex={-1} className="report-model-one-liner stock-citation-target">
        {poolSize != null && rank != null
          ? <>{formatNumber(poolSize)}종목 중 <strong>{formatNumber(rank)}위</strong> · 상위 {formatModelPercent(rank / poolSize * 100)}</>
          : "순위 정보 없음"}
      </p>
      {signals && <SignalView signal={signals.model.modelLabel?.startsWith("모델 순위 ") ? { ...signals.model, modelLabel: "모델 순위" } : signals.model} model />}
      </div>
      <dl className="report-predictions">
        <div>
          <dt>{rankBased ? "순위 점수" : "모델 예측수익률"}</dt>
          <dd
            className="report-model-value"
            data-testid="report-prediction"
            title={rankScore != null ? String(rankScore) : undefined}
          >
            {rankBased ? formatRankScore(rankScore, 2) : formatPercent(detail?.predictedReturn)}
          </dd>
        </div>
        {showFinal && (
          <div>
            <dt>최종 보정 예측수익률</dt>
            <dd className="report-model-value" data-testid="report-final-prediction">
              {formatPercent(detail?.finalPredictedReturn)}
            </dd>
          </div>
        )}
      </dl>
      <dl className="report-stats">
        {showFinal && detail?.finalRank != null && <div id={`stock-model-adjusted-${code}`} tabIndex={-1} className="stock-citation-target"><dt>최종 보정 순위</dt><dd data-testid="report-final-rank">{formatNumber(detail.finalRank)}위</dd></div>}
        {detail?.baseDate && <div><dt>분석 기준일</dt><dd>{formatDate(detail.baseDate)}</dd></div>}
        {detail?.predictionTarget === "next_session_open_to_close" && <div><dt>예측 대상</dt><dd>다음 거래일 시가→종가</dd></div>}
        {nextSessionLabel && <div><dt>다음 거래일</dt><dd data-testid="report-next-session">{nextSessionLabel}</dd></div>}
      </dl>
      {modelMeta && <SourceMeta source={modelMeta.source} asOf={modelMeta.asOf} label="분석 시각" />}
      {signals ? <p className="report-muted report-model-reason">{signals.model.reason}</p> : <p className="report-empty">분석 근거가 없습니다.</p>}
      {signals && production !== "unproduced" && <div className="report-signals"><div data-report-signal="news"><div><strong>뉴스</strong><SignalView signal={signals.news} /></div><p className="report-muted">{signals.news.reason}</p></div></div>}
      {detail && detail.scoreKind !== "rank_zscore" && <p className="report-muted report-footnote">모델의 긍정 표시는 최종 후보에 포함됐다는 뜻일 수 있습니다. 원본 예측이 음수인 종목도 후보에 포함될 수 있습니다.</p>}
      {rankBased && <p id={`stock-rank-interpretation-${code}`} tabIndex={-1} className="report-muted stock-citation-target">순위 점수는 수익률·확률이 아닙니다.</p>}
      {insight.data && <StockInsightDetails insight={insight.data} embedded />}
    </section>

    {/* 6. 한계·고지 */}
    <p className="report-muted report-disclaimer">모델 순위는 투자 추천·수익 보장·실현 성과가 아닙니다. 투자 판단과 책임은 투자자에게 있습니다.</p>
  </div>;
}

export function StockReportPage() {
  const { code } = useParams();
  const paths = useAppPaths();
  if (!code || !/^\d{6}$/.test(code) || code === "000000") return <div className="stock-report"><h1>종목 코드를 확인하세요</h1><p className="report-empty">유효한 6자리 종목 코드가 필요합니다.</p><Link className="report-back" to={paths.briefing}>브리핑으로</Link></div>;
  return <StockReport key={code} code={code} />;
}
