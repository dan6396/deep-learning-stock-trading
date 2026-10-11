import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Info, X, RefreshCw, ArrowRight } from "lucide-react";
import { useAppPaths } from "../../app/paths";
import { queries, queryKeys } from "../../shared/api/queries";
import { formatDate, formatNumber } from "../../shared/lib/format";
import { usePageTitle } from "../../hooks/usePageTitle";
import { modelTopFive, ModelTopFiveList } from "./ModelTopFiveTable";
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
  const rank = useQuery(queries.rank()), indices = useQuery(queries.indices());
  const paths = useAppPaths(), client = useQueryClient(), [params, setParams] = useSearchParams(), [intro, setIntro] = useState(showIntro);
  // Always use original model rank, including runs that also produced news-adjusted candidates.
  const rows = modelTopFive(rank.data?.data ?? []);
  const rawCode = params.get("code"), code = rawCode && /^\d{6}$/.test(rawCode) && rawCode !== "000000" ? rawCode : null;
  const selectedCode = code ?? (!rawCode ? rows[0]?.code ?? null : null);
  const selected = rank.data?.data.find(row => row.code === selectedCode);
  const dates = [...new Set(rows.map(row => row.baseDate).filter((date): date is string => date !== null))];
  const baseDate = dates.length === 1 ? formatDate(dates[0]) : dates.length > 1 ? "종목별 상이" : "—";
  const pools = [...new Set(rows.map(row => row.poolSize).filter((size): size is number => size !== null && size >= 1))], pool = pools.length === 1 ? pools[0] : null;
  // Single-column layout puts the detail panel below the list; bring it into view after a tap.
  const revealDetail = useRef(false);
  function scrollToDetail() {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("briefing-detail")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  useEffect(() => { if (revealDetail.current) { revealDetail.current = false; scrollToDetail(); } }, [selectedCode]);
  function select(nextCode: string, reason: "pointer" | "keyboard" = "pointer") {
    if (reason === "pointer" && window.matchMedia?.("(max-width: 900px)").matches) { if (nextCode === selectedCode) scrollToDetail(); else revealDetail.current = true; }
    const next = new URLSearchParams(params); next.set("code", nextCode); setParams(next, { replace: reason === "keyboard" }); }
  function dismissIntro() { setIntro(false); try { localStorage.setItem(INTRO_STORAGE_KEY, "dismissed"); } catch { /* session-only dismissal */ } }
  async function refresh() {
    const keys = [queryKeys.rank(), queryKeys.indices(), queryKeys.backendStatus(), ...rows.map(row => queryKeys.quote(row.code)), ...(selectedCode ? [queryKeys.stock(selectedCode), queryKeys.chart(selectedCode, "1M")] : [])];
    await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey, exact: true })));
    await Promise.all(keys.map(queryKey => client.refetchQueries({ queryKey, exact: true, type: "active" })));
  }
  return <div className="briefing-page briefing-dashboard">
    <div className="briefing-title-row"><h1>오늘의 브리핑</h1><button type="button" className="briefing-button" onClick={() => void refresh()}><RefreshCw aria-hidden="true" size={14} />다시 조회</button></div>
    <WatchlistNotice />
    <div className="briefing-columns"><div className="briefing-primary">
      <section className="briefing-card briefing-comparison-card" aria-labelledby="candidate-heading">
        <div className="briefing-section-heading"><h2 id="candidate-heading" tabIndex={-1}>모델 예측 TOP5</h2><span className="briefing-muted">원본 예측 순위</span></div>
        <div className="briefing-result-meta"><span>분석 기준일 <strong>{baseDate}</strong> · 모집단 {formatNumber(pool)}종목</span>{rank.data && <SourceMeta source={rank.data.source} asOf={rank.data.asOf} label="저장 시각" />}</div>
        {rank.data?.source === "sample" && <p className="briefing-notice" role="status">예시 데이터 · 실제 분석 결과가 아닙니다.</p>}
        {rank.isError && <p className="briefing-notice" role="status">{rank.data ? "이전 조회 결과 · 모델 순위 갱신 실패" : "모델 순위 조회 실패 · 분석 결과를 가져오지 못했습니다."}</p>}
        {rank.isPending ? <p className="briefing-empty" role="status">모델 예측 순위를 조회하고 있습니다.</p> : rows.length ? <ModelTopFiveList rows={rows} selectedCode={selectedCode} onSelect={select} /> : !rank.isError && <p className="briefing-empty">표시할 모델 예측이 없습니다.<small>AI 분석을 실행하면 원본 순위 상위 5개를 표시합니다.</small></p>}
        <div className="briefing-comparison-footer"><span>관련 기사는 순위에 반영하지 않습니다.</span><Link to={paths.rank}>전체 순위 보기 <ArrowRight aria-hidden="true" size={14} /></Link></div>
        <p className="briefing-table-help">모델 예측은 방향만 표시하며 실제 성과가 아닙니다. 예측 수치는 전체 리포트에서 확인하세요. 기사 시각은 한국시간입니다.</p>
      </section>
      <BriefingSummary indices={indices.data?.data ?? []} pending={indices.isPending} error={indices.isError} count={pool} rows={rows} rankPending={rank.isPending} rankError={rank.isError} rankSource={rank.data?.source} />
      {intro && <section className="briefing-intro briefing-intro-compact" aria-label="서비스 첫 방문 안내"><Info aria-hidden="true" size={15} /><p>예측과 근거를 읽는 기준은 <Link to={paths.about}>서비스 소개</Link>에서 확인하세요.</p><button type="button" className="briefing-icon-button" onClick={dismissIntro} aria-label="서비스 안내 닫기"><X aria-hidden="true" size={16} /></button></section>}
      <p className="briefing-disclaimer">모델 예측은 투자 추천·수익 보장·실제 성과가 아닙니다.</p>
    </div>
      {selectedCode ? <DetailPanel key={selectedCode} code={selectedCode} candidate={selected} candidateMeta={selected ? rank.data : undefined} membership={rank.isPending ? "pending" : "unknown"} production="unproduced" />
        : <aside id="briefing-detail" className="briefing-card briefing-detail-empty" aria-labelledby="detail-empty-heading"><Info aria-hidden="true" size={24} /><h2 id="detail-empty-heading">종목 상세</h2><p>{rawCode ? "유효한 6자리 종목 코드가 필요합니다." : "모델 예측을 조회하면 첫 종목의 상세가 표시됩니다."}</p></aside>}
    </div>
  </div>;
}
