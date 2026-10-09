import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { queries } from "../../shared/api/queries";
import { usePageTitle } from "../../hooks/usePageTitle";
import { SourceMeta } from "../briefing/SourceMeta";
import { WatchlistNotice } from "../watchlist/WatchToggle";
import { RankTable } from "./RankTable";
import { useCandidateProduction, productionNotice } from "../briefing/candidateProduction";
import { rankRows, type RankFilter, type RankSort } from "./rankData";
import "./rank.css";

const pageSize = 20;
export function RankPage() {
  usePageTitle("전체 순위");
  const rank = useQuery(queries.rank()), candidates = useQuery(queries.candidates());
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<RankFilter>("all"), [sort, setSort] = useState<RankSort>("rank"), [descending, setDescending] = useState(false), [page, setPage] = useState(0);
  const production = useCandidateProduction(candidates), notice = productionNotice(production), modelOnly = production === "unproduced";
  // A failed refresh may retain old candidates; never expose their final values as confirmed.
  const showFinal = production === "produced" && candidates.isSuccess && !candidates.isError;
  const modeReady = modelOnly || showFinal, activeFilter = !showFinal && filter === "candidate" ? "all" : filter;
  const activeSort = !showFinal && (sort === "finalRank" || sort === "finalPredictedReturn") ? "rank" : sort;
  const activeDescending = activeSort === sort && descending;
  const confirmed = candidates.isSuccess && !candidates.isError && production === "produced", membershipState = candidates.isPending || (candidates.isSuccess && production === "pending") ? "pending" : confirmed ? "confirmed" : "unknown";
  const rows = useMemo(() => rankRows(rank.data?.data ?? [], candidates.data?.data ?? [], confirmed, query, activeFilter, activeSort, activeDescending), [rank.data, candidates.data, confirmed, query, activeFilter, activeSort, activeDescending]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), current = Math.min(page, pages - 1);
  const members = new Set(confirmed ? candidates.data.data.map(row => row.code) : []);
  function changeSort(next: RankSort) { setDescending(activeSort === next ? !activeDescending : next === "predictedReturn" || next === "finalPredictedReturn"); setSort(next); setPage(0); }
  async function refresh() { await Promise.all([rank.refetch({ cancelRefetch: true }), candidates.refetch({ cancelRefetch: true })]); }
  return <div className="rank-page"><div className="rank-title-row"><div><p className="rank-eyebrow">MODEL UNIVERSE</p><h1>전체 순위</h1><p className="rank-muted">{modelOnly ? "Transformer Ensemble의 원본 모델 예측 순위를 비교하세요." : "전체 분석 집합을 비교하세요. 최종 후보와 원본 모델 순위는 다른 기준입니다."}</p></div><button className="rank-button" onClick={() => void refresh()}><RefreshCw aria-hidden="true" size={16} />다시 조회</button></div>
    <WatchlistNotice />
    {rank.data && <SourceMeta source={rank.data.source} asOf={rank.data.asOf} label="전체 순위 저장 시각" />}
    {rank.data?.source === "sample" && <p className="rank-notice" role="status">예시 데이터 · 실제 전체 분석 결과가 아닙니다.</p>}
    {rank.isError && <p className="rank-notice" role="status">{rank.data ? "이전 조회 결과 · 전체 순위 갱신 실패" : "전체 순위 조회 실패 · 다시 조회해 주세요."}</p>}
    {notice && !candidates.isError && <p className={modelOnly ? "rank-muted" : "rank-notice"} role="status" data-candidate-production={production}>{modelOnly ? "뉴스 보정 미사용 · 모델 예측 순위 기준" : `${notice} 원본 뉴스·수급은 별도로 평가합니다.`}</p>}
    {candidates.isError && <p className="rank-notice" role="status">최종 후보 조회 실패 · 모델 신호의 후보 멤버십은 미확인입니다. 원본 뉴스·수급은 별도로 평가합니다.</p>}
    {candidates.data?.source === "sample" && <p className="rank-notice" role="status">후보 목록은 예시 데이터입니다. 후보 멤버십과 관련 모델 신호를 실제 분석으로 해석하지 마세요.</p>}
    <section className="rank-card" aria-labelledby="rank-list-heading"><div className="rank-section-heading"><h2 id="rank-list-heading">모델 원본 비교 <span>{rank.data?.data.length ?? "—"}종목</span></h2><p className="rank-muted">다음 거래일 시가→종가 예측 · 실제 성과 아님</p></div>
      <div className="rank-controls"><label className="rank-search"><Search aria-hidden="true" size={17} /><span className="watch-sr-only">종목 이름 또는 코드</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="이름 또는 6자리 코드" /></label>
        <label className="rank-filter">보기<select value={activeFilter} onChange={event => { setFilter(event.target.value as RankFilter); setPage(0); }}><option value="all">전체 종목</option>{showFinal && <option value="candidate">최종 후보만</option>}<option value="positive">원본 예측 양수</option><option value="negative">원본 예측 0 이하</option><option value="missing">원본 예측 미제공</option></select></label></div>
      {rank.isPending ? <p className="rank-empty" role="status">전체 순위를 조회하고 있습니다.</p> : rows.length ? <RankTable production={production} showFinal={showFinal} modeReady={modeReady} rows={rows.slice(current * pageSize, (current + 1) * pageSize)} members={members} membershipState={membershipState} sort={activeSort} descending={activeDescending} onSort={changeSort} />
        : !rank.isError && <p className="rank-empty">{rank.data?.data.length ? activeFilter === "candidate" && !confirmed ? "최종 후보 목록을 확인할 수 없어 필터 결과를 제공하지 않습니다." : "검색 조건에 맞는 종목이 없습니다." : "최신 전체 분석 결과가 비어 있습니다."}</p>}
      {rows.length > 0 && <nav className="rank-pagination" aria-label="전체 순위 페이지"><span aria-live="polite">{current + 1} / {pages}페이지 · {rows.length}종목</span><button className="rank-button" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="이전 순위 페이지"><ChevronLeft aria-hidden="true" size={16} />이전</button><button className="rank-button" disabled={current === pages - 1} onClick={() => setPage(current + 1)} aria-label="다음 순위 페이지">다음<ChevronRight aria-hidden="true" size={16} /></button></nav>}
      <p className="rank-muted rank-help">누락값은 —이며 양방향 정렬 모두 마지막에 표시합니다. 화면 순서를 모델 순위로 만들지 않습니다. {modelOnly ? "근거 일치도는 판정 가능한 원본 모델·수급 근거의 긍정 비율이며, 뉴스 미실행은 분모에서 제외합니다." : "최종 후보 여부는 모델 판정에만 사용하고, 뉴스·수급은 실제 원본 근거로 평가합니다."}</p>
    </section><p className="rank-muted">모델 예측은 투자 추천·수익 보장·실현 성과가 아닙니다. 다음 거래일은 거래일 달력 미연결로 미확인입니다.</p></div>;
}
