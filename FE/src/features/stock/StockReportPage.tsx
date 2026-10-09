import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, RefreshCw, BookOpen } from "lucide-react";
import { queries, queryKeys } from "../../shared/api/queries";
import { formatAgreement, formatDate, formatNumber, formatPercent, formatWon } from "../../shared/lib/format";
import { usePageTitle } from "../../hooks/usePageTitle";
import { PerformancePanel } from "../history/PerformancePanel";
import { SIGNAL_DESCRIPTIONS, SIGNAL_RULE_VERSION } from "../../entities/signals";
import { briefingSignals, resolveMembership, type CandidateMembership } from "../briefing/membership";
import { useCandidateProduction, productionNotice } from "../briefing/candidateProduction";
import { mergeCandidateDetail } from "../briefing/DetailPanel";
import { SourceMeta } from "../briefing/SourceMeta";
import { SignalView } from "../briefing/SignalView";
import { ReportChart } from "./ReportChart";
import { safeArticleUrl } from "./reportData";
import { useAppPaths } from "../../app/paths";
import { WatchToggle, WatchlistNotice } from "../watchlist/WatchToggle";
import "../briefing/briefing.css";
import "./stock.css";

const membershipLabels: Record<CandidateMembership, string> = { pending: "최종 후보 여부 확인 중", unknown: "최종 후보 여부 미확인", candidate: "최종 후보", nonCandidate: "최종 후보 외 종목" };
const tone = (value: number | null | undefined) => value != null && value > 0 ? "report-rise" : value != null && value < 0 ? "report-fall" : "";

function StockReport({ code }: { code: string }) {
  const paths = useAppPaths();
  const stock = useQuery(queries.stock(code)), quote = useQuery(queries.quote(code)), candidates = useQuery(queries.candidates()), client = useQueryClient();
  const candidate = candidates.data?.data.find(row => row.code === code), detail = mergeCandidateDetail(candidate, stock.data?.data);
  const production = useCandidateProduction(candidates), notice = productionNotice(production);
  const membership: CandidateMembership = resolveMembership(candidates, Boolean(candidate), production);
  const signals = detail ? briefingSignals(detail, membership, production) : null, modelMeta = candidate ? candidates.data : stock.data;
  usePageTitle(`${detail?.name ?? quote.data?.data?.name ?? code} · 종목 리포트`);
  async function refresh() {
    const keys = [queryKeys.stock(code), queryKeys.quote(code), queryKeys.candidates(), ["chart", code]];
    await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey })));
    await Promise.all(keys.map(queryKey => client.refetchQueries({ queryKey })));
  }
  return <div className="stock-report" data-report-code={code}>
    <div className="report-title-row"><div><Link className="report-back" to={`${paths.briefing}?code=${code}`}><ArrowLeft aria-hidden="true" size={16} />브리핑으로</Link><p className="report-eyebrow">STOCK REPORT · {code}</p><h1>{detail?.name ?? quote.data?.data?.name ?? code}</h1><p className="report-muted" data-membership={membership}>{code} · {membershipLabels[membership]}</p></div><button className="stock-report-button" onClick={() => void refresh()}><RefreshCw aria-hidden="true" size={16} />다시 조회</button><WatchToggle code={code} name={detail?.name ?? quote.data?.data?.name} /></div><WatchlistNotice />
    {candidates.isError && <p className="report-notice" role="status">{candidates.data ? "이전 조회 결과 · 후보 갱신 실패 · 현재 멤버십 미확인" : "후보 조회 실패 · 현재 멤버십 미확인"}</p>}
    {notice && !candidates.isError && !candidate && <p className="report-notice" role="status" data-candidate-production={production}>{notice}</p>}
    {stock.isError && <p className="report-notice" role="status">{stock.data?.data ? "이전 조회 결과 · 분석 갱신 실패" : stock.error.message.includes("예시") ? "예시 분석 응답은 제공하지 않습니다. 확인 가능한 후보 원본만 표시합니다." : stock.error.message.includes("코드") ? "종목 코드가 일치하지 않아 분석 응답을 표시하지 않습니다." : "종목 분석 조회 실패 · 확인 가능한 후보 원본만 표시합니다."}</p>}
    {stock.isPending && <p className="report-muted" role="status">종목 분석을 조회하고 있습니다.</p>}
    {stock.isSuccess && stock.data.data === null && <p className="report-notice" role="status">상세 분석 결과가 없습니다.{candidate ? " 후보 목록 원본을 표시합니다." : ""}</p>}
    {(candidates.data?.source === "sample" || stock.data?.source === "sample") && <p className="report-notice" role="status">예시 데이터 · 실제 분석 결과가 아닙니다.</p>}
    <div className="report-top-grid"><section className="report-card" aria-labelledby="report-price-title"><p className="report-eyebrow">QUOTE</p><h2 id="report-price-title">조회 가격</h2><p className="report-price" data-testid="report-price">{formatWon(quote.data?.data?.currentPrice)}</p><p className={tone(quote.data?.data?.changeRate)}>{formatPercent(quote.data?.data?.changeRate, "percent")} · {formatWon(quote.data?.data?.change)}</p>
      {quote.data && <SourceMeta source={quote.data.source} asOf={quote.data.asOf} label="시세 기준 시각" />}
      {quote.isPending && <p role="status" className="report-muted">시세를 조회하고 있습니다.</p>}
      {quote.isError && <p className="report-notice" role="status">{quote.data ? "이전 조회 결과 · 시세 갱신 실패" : "시세 조회 실패"}</p>}
      {quote.isSuccess && quote.data.data === null && <p className="report-muted">시세 결과가 없습니다.</p>}
      <dl className="report-stats"><div><dt>거래량</dt><dd>{formatNumber(quote.data?.data?.volume)}</dd></div><div><dt>거래대금</dt><dd>{formatWon(quote.data?.data?.tradingValue)}</dd></div></dl>
    </section><section className="report-card" aria-labelledby="report-model-title"><p className="report-eyebrow">PREDICTION · 실제 성과 아님</p><h2 id="report-model-title">모델과 최종 보정</h2><dl className="report-predictions"><div><dt>원본 모델 예측수익률</dt><dd className={tone(detail?.predictedReturn)} data-testid="report-prediction">{formatPercent(detail?.predictedReturn)}</dd></div><div><dt>최종 보정 예측수익률</dt><dd className={tone(detail?.finalPredictedReturn)} data-testid="report-final-prediction">{formatPercent(detail?.finalPredictedReturn)}</dd></div></dl>
      <dl className="report-stats"><div><dt>원본 모델 순위 / 모집단</dt><dd>{formatNumber(detail?.rank)} / {formatNumber(detail?.poolSize)}</dd></div><div><dt>최종 보정 순위</dt><dd data-testid="report-final-rank">{formatNumber(detail?.finalRank)}{detail?.finalRank == null ? " · 원본 미제공" : "위"}</dd></div><div><dt>분석 기준일</dt><dd>{formatDate(detail?.baseDate)}</dd></div><div><dt>예측 대상</dt><dd>{detail?.predictionTarget === "next_session_open_to_close" ? "다음 거래일 시가→종가" : "미확인"}</dd></div><div><dt>다음 거래일</dt><dd>미확인 · 거래일 달력 미연결</dd></div></dl>
      {modelMeta && <SourceMeta source={modelMeta.source} asOf={modelMeta.asOf} label="모델 결과 저장 시각" />}
      {stock.data && <SourceMeta source={stock.data.source} asOf={stock.data.asOf} label="상세 분석 저장 시각" />}
    </section></div>
    <div className="report-columns"><div className="report-primary"><ReportChart key={code} code={code} />
      <section className="report-card" aria-labelledby="report-news-title"><div className="report-section-heading"><div><p className="report-eyebrow">NEWS EVIDENCE</p><h2 id="report-news-title">뉴스 원본 근거</h2></div><span className="report-muted">{detail?.newsMethod === "llm" ? "LLM 판정" : detail?.newsMethod === "keyword" ? "키워드 추정 · 신호에 사용하지 않음" : "판정 방법 미확인"}</span></div>
        <p className="report-muted">수집 상태: {detail?.newsStatus ?? "미확인"} · 확인된 기사 감성을 그대로 표시합니다.</p>
        {detail?.news.length ? <ul className="report-news">{detail.news.map((article, index) => { const url = safeArticleUrl(article.url); return <li key={`${article.title}-${index}`}><div className="report-news-heading"><h3>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{article.title ?? "제목 미확인"}<ExternalLink aria-hidden="true" size={14} /></a> : article.title ?? "제목 미확인"}</h3><span className="report-news-sentiment" data-article-sentiment={article.sentiment ?? "unknown"}>{article.sentiment === "positive" ? "긍정" : article.sentiment === "negative" ? "부정" : article.sentiment === "neutral" ? "중립" : "감성 미확인"}</span></div><p className="report-muted">{article.source ?? "발행처 미확인"} · {formatDate(article.publishedAt, true)}</p><p>{article.reason ?? "판정 근거 미제공"}</p>{article.description && <p className="report-muted">{article.description}</p>}</li>; })}</ul>
          : <p className="report-empty">{detail?.newsCollected ? "실제 뉴스 수집 결과 0건입니다." : "뉴스 수집 여부를 확인할 수 없습니다."}</p>}
      </section>
      <PerformancePanel code={code} />
    </div><div className="report-secondary"><section className="report-card" aria-labelledby="report-evidence-title"><p className="report-eyebrow">MODEL & EVIDENCE</p><h2 id="report-evidence-title">신호와 근거 일치도</h2>
      {signals ? <><div className="report-signals">{(["model", "news", "supply"] as const).map(key => <div key={key} data-report-signal={key}><div><strong>{key === "model" ? "모델" : key === "news" ? "뉴스" : "수급"}</strong><SignalView signal={signals[key]} /></div><p className="report-muted">{signals[key].reason}</p></div>)}</div><p className="report-agreement"><strong>{formatAgreement(signals.agreement.ratio)}</strong> · 긍정 {signals.agreement.positive}/{signals.agreement.evaluable}<small>판정 불가 {signals.agreement.unavailable}개는 분모에서 제외</small></p></> : <p className="report-empty">모델·뉴스·수급 — · 판정 불가. 확인 가능한 분석 근거가 없습니다.</p>}
      <p className="report-muted report-footnote">모델 긍정은 최종 후보 선정 멤버십을 뜻할 수 있습니다. 확정 규칙상 원본 예측이 음수인 최종 후보도 긍정이며, 상승이나 수익을 보장하지 않습니다.</p>
      <p className="report-summary">{!detail || detail.predictedReturn === null ? "원본 모델 예측값이 없어 수익률 요약을 제공하지 않습니다." : `원본 모델 예측은 ${formatPercent(detail.predictedReturn)}이며 최종 보정 예측은 ${formatPercent(detail.finalPredictedReturn)}입니다. 예측값은 확률이나 실현 성과가 아닙니다.`}</p>
    </section><section className="report-card" aria-labelledby="report-supply-title"><p className="report-eyebrow">SUPPLY INPUTS</p><h2 id="report-supply-title">수급 원본</h2><dl className="report-stats"><div><dt>외국인 합계</dt><dd>{formatWon(detail?.supply.foreignNetBuy)}</dd></div><div><dt>기관 합계</dt><dd>{formatWon(detail?.supply.institutionNetBuy)}</dd></div><div><dt>외국인·기관 합계</dt><dd>{formatWon(detail?.supply.combinedNetBuy)}</dd></div><div><dt>외국인 양수일수</dt><dd>{formatNumber(detail?.supply.foreignPositiveDays)}</dd></div><div><dt>기관 양수일수</dt><dd>{formatNumber(detail?.supply.institutionPositiveDays)}</dd></div><div><dt>합산 순매수 일수</dt><dd>{formatNumber(detail?.supply.combinedPositiveDays)}</dd></div><div><dt>조회 기간 / 확보 일수</dt><dd>{formatNumber(detail?.supply.window)} / {formatNumber(detail?.supply.dataDays)}</dd></div><div><dt>충분성 / 상태</dt><dd>{detail?.supply.enough === true ? "충분" : detail?.supply.enough === false ? "불충분" : "미확인"} / {detail?.supply.status ?? "미확인"}</dd></div></dl>
      <p className="report-muted">합산 순매수 일수 원본이 없으면 수급 신호는 판정 불가입니다. 개별 양수일수를 더하거나 양쪽 각각 절반이라는 규칙으로 바꾸지 않습니다.</p>
    </section></div></div>
    <details className="report-card report-rules"><summary>근거 판정 기준 <span>{SIGNAL_RULE_VERSION}</span></summary><dl>{Object.entries(SIGNAL_DESCRIPTIONS).map(([key, description]) => <div key={key}><dt>{key === "model" ? "모델" : key === "news" ? "뉴스" : key === "supply" ? "수급" : key === "agreement" ? "근거 일치도" : "다음 거래일"}</dt><dd>{description}</dd></div>)}</dl></details>
    <p className="report-muted report-disclaimer">모델 예측은 투자 추천·수익 보장·실현 성과가 아닙니다. 투자 판단과 책임은 투자자에게 있습니다.</p>
  </div>;
}

export function StockReportPage() {
  const { code } = useParams();
  const paths = useAppPaths();
  if (!code || !/^\d{6}$/.test(code) || code === "000000") return <div className="stock-report"><h1>종목 코드를 확인하세요</h1><p className="report-empty">유효한 6자리 종목 코드가 필요합니다.</p><Link className="report-back" to={paths.briefing}>브리핑으로</Link></div>;
  return <StockReport key={code} code={code} />;
}
