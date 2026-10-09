import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Info, X, RefreshCw, ArrowRight } from "lucide-react";
import { useAppPaths } from "../../app/paths";
import { queries, queryKeys } from "../../shared/api/queries";
import { SIGNAL_DESCRIPTIONS, SIGNAL_RULE_VERSION } from "../../entities/signals";
import { MODEL_SUMMARY } from "../../entities/model";
import { formatDate, formatNumber } from "../../shared/lib/format";
import { usePageTitle } from "../../hooks/usePageTitle";
import { CandidateTable } from "./CandidateTable";
import { modelTopFive } from "./ModelTopFiveTable";
import { useCandidateProduction, productionNotice } from "./candidateProduction";
import { resolveMembership } from "./membership";
import { DetailPanel } from "./DetailPanel";
import { BriefingSummary } from "./BriefingSummary";
import { SourceMeta } from "./SourceMeta";
import { WatchlistNotice } from "../watchlist/WatchToggle";
import "./briefing.css";
import "./briefingDashboard.css";

export const INTRO_STORAGE_KEY = "kospi-briefing-intro.v1";
function showIntro() { try { return localStorage.getItem(INTRO_STORAGE_KEY) !== "dismissed"; } catch { return true; } }

export function BriefingPage() {
  usePageTitle("브리핑");
  const candidates = useQuery(queries.candidates()), indices = useQuery(queries.indices());
  const paths = useAppPaths(), production = useCandidateProduction(candidates), client = useQueryClient(), [params, setParams] = useSearchParams(), [intro, setIntro] = useState(showIntro);
  const rank = useQuery({ ...queries.rank(), enabled: production === "unproduced" });
  const modelOnly = production === "unproduced", modelRows = modelOnly && rank.isSuccess && !rank.isError ? modelTopFive(rank.data.data) : [];
  const rows = candidates.data?.data ?? [], showModel = modelRows.length > 0, displayRows = showModel ? modelRows : rows, result = showModel ? rank : candidates;
  const rawCode = params.get("code"), code = rawCode && /^\d{6}$/.test(rawCode) && rawCode !== "000000" ? rawCode : null;
  const selectedCode = code ?? (!rawCode ? displayRows[0]?.code ?? null : null);
  const selected = displayRows.find(row => row.code === selectedCode) ?? (modelOnly ? rank.data?.data.find(row => row.code === selectedCode) : undefined);
  const membership = resolveMembership(candidates, rows.some(row => row.code === selectedCode), production), notice = productionNotice(production);
  const dates = [...new Set(displayRows.map(row => row.baseDate).filter((date): date is string => date !== null))];
  const baseDate = dates.length === 1 ? formatDate(dates[0]) : dates.length > 1 ? "종목별 상이" : "—";
  const pools = [...new Set(displayRows.map(row => row.poolSize).filter((size): size is number => size !== null && size >= 1))], pool = pools.length === 1 ? pools[0] : null;
  const consecutiveRanks = displayRows.every((row, index) => row.rank === index + 1);
  function select(nextCode: string, reason: "pointer" | "keyboard" = "pointer") { const next = new URLSearchParams(params); next.set("code", nextCode); setParams(next, { replace: reason === "keyboard" }); }
  function dismissIntro() { setIntro(false); try { localStorage.setItem(INTRO_STORAGE_KEY, "dismissed"); } catch { /* session-only dismissal */ } }
  async function refresh() {
    const keys = [queryKeys.candidates(), queryKeys.indices(), queryKeys.backendStatus(), ...(modelOnly ? [queryKeys.rank()] : []), ...displayRows.map(row => queryKeys.quote(row.code)), ...(selectedCode ? [queryKeys.stock(selectedCode), queryKeys.chart(selectedCode, "1M")] : [])];
    await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey, exact: true })));
    await Promise.all(keys.map(queryKey => client.refetchQueries({ queryKey, exact: true, type: "active" })));
  }
  return <div className="briefing-page briefing-dashboard">
    <div className="briefing-title-row"><h1>오늘의 브리핑</h1><button type="button" className="briefing-button" onClick={() => void refresh()}><RefreshCw aria-hidden="true" size={14} />다시 조회</button></div>
    <WatchlistNotice />
    <div className="briefing-columns"><div className="briefing-primary">
      <BriefingSummary indices={indices.data?.data ?? []} pending={indices.isPending} error={indices.isError} count={pool ?? null} />
      <section className="briefing-card briefing-comparison-card" aria-labelledby="candidate-heading">
        <div className="briefing-section-heading"><h2 id="candidate-heading" tabIndex={-1}>{showModel ? "Transformer Ensemble Top-5" : rows.length ? `후보 ${rows.length}종목 비교` : "최종 후보 비교"}</h2><span className="briefing-muted">원본 예측 순위 · 행 선택으로 근거 보기</span></div>
        <p className="briefing-model-summary">{MODEL_SUMMARY}</p>
        <div className="briefing-result-meta"><span>분석 기준일 <strong>{baseDate}</strong> · 모집단 {formatNumber(pool)}종목</span>{result.data && <SourceMeta source={result.data.source} asOf={result.data.asOf} label="저장 시각" />}</div>
        {result.data?.source === "sample" && <p className="briefing-notice" role="status">예시 데이터 · 실제 분석 결과가 아닙니다.</p>}
        {candidates.isError && <p className="briefing-notice" role="status">{candidates.data ? "이전 조회 결과 · 후보 갱신 실패" : "후보 조회 실패 · 분석 결과를 가져오지 못했습니다."}</p>}
        {candidates.isPending ? <p className="briefing-empty" role="status">후보를 조회하고 있습니다.</p> : displayRows.length ? <div data-candidate-production={production}><CandidateTable candidates={displayRows} selectedCode={selectedCode} onSelect={select} membershipConfirmed={!candidates.isError} production={production} /></div> : !candidates.isError && (production === "produced" ? <p className="briefing-empty">최종 후보가 없습니다.<small>최신 분석 결과가 비어 있습니다.</small></p>
          : production === "pending" ? <p className="briefing-empty" role="status">최종 후보 생성 여부를 확인하고 있습니다.</p>
          : <p className="briefing-empty" role="status" data-candidate-production={production}>{notice}<small>모델 예측 순위는 <Link to={paths.rank}>전체 순위</Link>에서 확인하세요.</small></p>)}
        {displayRows.length > 0 && <div className="briefing-comparison-footer"><span>{modelOnly && consecutiveRanks && pool !== null && pool >= displayRows.length ? `원본 순위 ${displayRows.length + 1}위 이하 ${formatNumber(pool - displayRows.length)}종목은 전체 순위에서 확인` : "나머지 종목은 전체 순위에서 확인"}</span><Link to={paths.rank}>전체 순위 보기 <ArrowRight aria-hidden="true" size={14} /></Link></div>}
        <p className="briefing-table-help">예측수익률: 다음 거래일 시가→종가 모델 예측 · 실제 성과 아님{modelOnly ? " · 모델·수급 2개 근거 기준" : " · 모델·뉴스·수급 3개 근거 기준"}</p>
      </section>
      {intro && <section className="briefing-intro briefing-intro-compact" aria-label="서비스 첫 방문 안내"><Info aria-hidden="true" size={15} /><p>예측과 근거를 읽는 기준은 <Link to={paths.about}>서비스 소개</Link>에서 확인하세요.</p><button type="button" className="briefing-icon-button" onClick={dismissIntro} aria-label="서비스 안내 닫기"><X aria-hidden="true" size={16} /></button></section>}
      <details className="briefing-card briefing-rules"><summary>근거 판정 기준 <span>{SIGNAL_RULE_VERSION}</span></summary><dl>{Object.entries(SIGNAL_DESCRIPTIONS).filter(([key]) => !modelOnly || key !== "news").map(([key, text]) => <div key={key}><dt>{key === "model" ? "모델" : key === "news" ? "뉴스" : key === "supply" ? "수급" : key === "agreement" ? "근거 일치도" : "다음 거래일"}</dt><dd>{key === "agreement" ? `${modelOnly ? "모델·수급 2개" : "모델·뉴스·수급 3개"} 근거 중 긍정 개수입니다. 판정 불가는 별도로 표시합니다.` : text}</dd></div>)}</dl></details>
      <p className="briefing-disclaimer">모델 예측과 모의투자 기록은 투자 추천·수익 보장·실제 성과가 아닙니다.</p>
    </div>
      {selectedCode ? <DetailPanel key={selectedCode} code={selectedCode} candidate={selected} candidateMeta={selected ? modelOnly ? rank.data : candidates.data : undefined} membership={membership} production={production} />
        : <aside id="briefing-detail" className="briefing-card briefing-detail-empty" aria-labelledby="detail-empty-heading"><Info aria-hidden="true" size={24} /><h2 id="detail-empty-heading">근거를 더 가까이</h2><p>{rawCode ? "유효한 6자리 종목 코드가 필요합니다." : "후보를 조회하면 첫 종목의 근거가 표시됩니다."}</p></aside>}
    </div>
  </div>;
}
