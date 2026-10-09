import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import type { CandidateData } from "../../entities/candidate";
import type { DataResult } from "../../entities/source";
import { briefingSignals, type CandidateMembership, type CandidateProduction } from "./membership";
import { queries } from "../../shared/api/queries";
import { formatDate, formatNumber, formatPercent, formatWon } from "../../shared/lib/format";
import { SignalView } from "./SignalView";
import { SourceMeta } from "./SourceMeta";
import { BriefingChart } from "./BriefingChart";
import { EvidenceAgreementView } from "./EvidenceAgreementView";
import { evidenceSummary, formatBillions } from "./briefingData";
import { WatchToggle } from "../watchlist/WatchToggle";
import { safeArticleUrl } from "../stock/reportData";
import { useAppPaths } from "../../app/paths";

/** Candidate membership/model fields are authoritative for both table and panel. */
export function mergeCandidateDetail(candidate: CandidateData | undefined, detail: CandidateData | null | undefined): CandidateData | null {
  if (!candidate) return detail ?? null;
  if (!detail || detail.code !== candidate.code) return candidate;
  return { ...detail, isFinalCandidate: true, predictedReturn: candidate.predictedReturn, finalPredictedReturn: candidate.finalPredictedReturn,
    predictionTarget: candidate.predictionTarget, rank: candidate.rank, finalRank: candidate.finalRank, poolSize: candidate.poolSize, baseDate: candidate.baseDate };
}

export function DetailPanel({ code, candidate, candidateMeta, membership, production = "produced" }: { code: string; candidate?: CandidateData; candidateMeta?: Omit<DataResult<unknown>, "data">; membership: CandidateMembership; production?: CandidateProduction }) {
  const paths = useAppPaths(), modelOnly = production === "unproduced";
  const stock = useQuery({ ...queries.stock(code), enabled: !candidate || !modelOnly }), quote = useQuery({ ...queries.quote(code), retry: false, staleTime: 30_000, refetchOnMount: false });
  const detail = mergeCandidateDetail(candidate, stock.data?.data), signals = detail ? briefingSignals(detail, membership, production) : null;
  const analysisMeta = modelOnly ? candidateMeta : candidateMeta ?? (stock.data?.data ? stock.data : undefined), price = quote.isError || quote.data?.source === "sample" ? null : quote.data?.data;
  return <aside id="briefing-detail" className="briefing-card briefing-detail briefing-detail-compact" aria-labelledby="detail-title" data-detail-code={code}>
    <div className="briefing-detail-top"><div><h2 id="detail-title">{detail?.name ?? price?.name ?? code}</h2><p className="briefing-muted briefing-code" data-membership={membership}>{code}{!modelOnly && ` · ${membership === "pending" ? "최종 후보 여부 확인 중" : membership === "unknown" ? "최종 후보 여부 미확인" : membership === "candidate" ? "최종 후보" : "최종 후보 외 종목"}`}</p></div><a className="briefing-back-to-table" href="#candidate-heading">표로 돌아가기</a></div>
    <div className="briefing-detail-price"><strong data-testid="detail-price">{quote.isPending ? "조회 중" : formatWon(price?.currentPrice)}</strong><span className={price?.changeRate != null && price.changeRate > 0 ? "briefing-rise" : price?.changeRate != null && price.changeRate < 0 ? "briefing-fall" : ""}>{formatPercent(price?.changeRate, "percent")}</span></div>
    {quote.data && <SourceMeta source={quote.data.source} asOf={quote.data.asOf} label="시세" />}
    {quote.isError && <p className="briefing-footnote" role="status">가격 조회 실패 · —</p>}
    {stock.isPending && !candidate && <p role="status">종목 분석을 조회하고 있습니다.</p>}
    {stock.isError && <p className="briefing-notice" role="status">{stock.data?.data ? "이전 조회 결과 · 상세 갱신 실패" : candidate ? "상세 조회 실패 · 후보 분석 결과 표시" : "종목 분석 조회 실패"}</p>}
    <div className="briefing-detail-rank"><span>예측 {formatNumber(detail?.rank)}위 / {formatNumber(detail?.poolSize)}</span>{signals && <EvidenceAgreementView signals={signals} modelOnly={modelOnly} />}</div>
    <p className="briefing-template-summary">{detail ? evidenceSummary(detail) : "확인 가능한 분석 근거가 없습니다."}</p>
    <div className="briefing-detail-actions"><WatchToggle code={code} name={detail?.name} showLabel /><Link to={paths.stock(code)}>전체 리포트 열기<ArrowUpRight aria-hidden="true" size={14} /></Link></div>
    <BriefingChart code={code} />
    <h3>근거</h3>
    {signals && detail ? <div className="briefing-detail-signals">{(modelOnly ? ["model", "supply"] as const : ["model", "news", "supply"] as const).map(key => <div key={key} data-detail-evidence={key}><strong>{key === "model" ? "모델" : key === "news" ? "뉴스" : "수급"}</strong><SignalView signal={signals[key]} />
      {key === "model" ? <p>{formatNumber(detail.poolSize)}종목 중 {formatNumber(detail.rank)}위 · 예측수익률 {formatPercent(detail.predictedReturn)}</p> : key === "supply" ? <p>외국인 {formatBillions(detail.supply.foreignNetBuy)} / 기관 {formatBillions(detail.supply.institutionNetBuy)}<br />{detail.supply.window === null ? "조회 기간 미제공" : `${detail.supply.window}거래일`} · 합산 순매수 {formatNumber(detail.supply.combinedPositiveDays)}일 · 외국인 {formatNumber(detail.supply.foreignPositiveDays)}일 / 기관 {formatNumber(detail.supply.institutionPositiveDays)}일</p> : <p>{signals.news.reason}</p>}
      {signals[key].state === "unavailable" && key !== "news" && <p>{signals[key].reason}</p>}
    </div>)}</div> : <p className="briefing-muted">분석 근거 조회 중</p>}
    <dl className="briefing-detail-stats"><div><dt>모델 예측수익률</dt><dd>{formatPercent(detail?.predictedReturn)}</dd></div></dl>
    {detail?.predictedReturn === null && <p className="briefing-footnote">원본 모델 예측값이 없어 수익률 요약을 제공하지 않습니다.</p>}
    {!modelOnly && <><h3>대표 기사</h3>{detail?.news.length ? <ul className="briefing-news">{detail.news.slice(0, 3).map((news, index) => { const url = safeArticleUrl(news.url); return <li key={`${news.title}-${index}`}><strong>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{news.title ?? "제목 미확인"}</a> : news.title ?? "제목 미확인"}</strong><small>{news.source ?? "출처 미확인"} · {formatDate(news.publishedAt)}</small></li>; })}</ul> : <p className="briefing-muted briefing-footnote">{detail?.newsCollected ? "수집된 기사 0건" : "뉴스 수집 여부 미확인"}</p>}</>}
    {analysisMeta && <SourceMeta source={analysisMeta.source} asOf={analysisMeta.asOf} label="분석 저장 시각" />}
    <p className="briefing-muted briefing-footnote">예측과 가격 이력은 실제 투자 성과가 아닙니다.</p>
  </aside>;
}
