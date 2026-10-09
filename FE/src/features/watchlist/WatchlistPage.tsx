import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Star, RefreshCw } from "lucide-react";
import { useAppPaths } from "../../app/paths";
import { adaptCandidate } from "../../entities/candidate";
import { useWatchlist } from "../../shared/lib/watchlist";
import { queries } from "../../shared/api/queries";
import { usePageTitle } from "../../hooks/usePageTitle";
import { SourceMeta } from "../briefing/SourceMeta";
import { mergeCandidateDetail } from "../briefing/DetailPanel";
import { RankTable } from "../rank/RankTable";
import { WatchlistNotice } from "./WatchToggle";
import { useCandidateProduction, productionNotice } from "../briefing/candidateProduction";
import "../rank/rank.css";

export function WatchlistPage() {
  usePageTitle("관심 종목");
  const paths = useAppPaths(), watchlist = useWatchlist(), rank = useQuery(queries.rank()), candidates = useQuery(queries.candidates());
  const production = useCandidateProduction(candidates), notice = productionNotice(production);
  const confirmed = candidates.isSuccess && !candidates.isError && production === "produced", members = new Map(confirmed ? candidates.data.data.map(row => [row.code, row] as const) : []);
  const analysisState = rank.isPending ? "pending" : rank.isError ? rank.data ? "previous" : "unknown" : "confirmed";
  const index = new Map((rank.data?.data ?? []).map(row => [row.code, row] as const)), missingCodes = new Set(watchlist.codes.filter(code => !index.has(code)));
  const rows = watchlist.codes.map(code => index.has(code) ? mergeCandidateDetail(members.get(code), index.get(code))! : adaptCandidate({ input_row: { ticker: code } }).data);
  async function refresh() { await Promise.all([rank.refetch({ cancelRefetch: true }), candidates.refetch({ cancelRefetch: true })]); }
  return <div className="rank-page"><div className="rank-title-row"><div><p className="rank-eyebrow">YOUR WATCHLIST</p><h1>관심 종목 <span className="rank-muted">{watchlist.codes.length}개</span></h1><p className="rank-muted">별을 눌러 직접 고른 종목입니다. 이 브라우저에 저장합니다.</p></div><button className="rank-button" onClick={() => void refresh()}><RefreshCw aria-hidden="true" size={16} />다시 조회</button></div>
    <WatchlistNotice />
    {rank.data && <SourceMeta source={rank.data.source} asOf={rank.data.asOf} label="전체 순위 저장 시각" />}
    {rank.data?.source === "sample" && <p className="rank-notice" role="status">예시 데이터 · 실제 분석 결과가 아닙니다.</p>}
    {rank.isError && <p className="rank-notice" role="status">{rank.data ? "이전 조회 결과 · 관심 종목 분석 갱신 실패" : "전체 순위 조회 실패 · 저장한 종목 코드는 유지합니다."}</p>}
    {candidates.isError && <p className="rank-notice" role="status">최종 후보 조회 실패 · 현재 모델 멤버십 미확인</p>}
    {notice && !candidates.isError && <p className="rank-notice" role="status" data-candidate-production={production}>{notice}</p>}
    {candidates.data?.source === "sample" && <p className="rank-notice" role="status">후보 멤버십은 예시 데이터입니다.</p>}
    <section className="rank-card" aria-labelledby="watchlist-heading"><div className="rank-section-heading"><h2 id="watchlist-heading">저장한 종목</h2><Link className="rank-button" to={paths.rank}>전체 순위에서 찾기</Link></div>
      {!rows.length ? <div className="rank-empty"><Star aria-hidden="true" size={30} /><p>아직 관심 종목이 없습니다.<br />전체 순위나 검색에서 별을 눌러 추가하세요.</p></div>
        : <>{rank.isPending && <p role="status" className="rank-muted">분석 결과 조회 중 · 저장한 종목 코드는 먼저 표시합니다.</p>}<RankTable production={production} rows={rows} missingCodes={missingCodes} members={new Set(members.keys())} membershipState={candidates.isPending || (candidates.isSuccess && production === "pending") ? "pending" : confirmed ? "confirmed" : "unknown"} analysisState={analysisState} /></>}
      <p className="rank-help rank-muted">저장한 코드는 전체 순위 조회 여부와 관계없이 유지합니다. 조회가 성공한 뒤 분석 결과에 없는 코드를 구분하며, 리포트를 열거나 별을 눌러 삭제할 수 있습니다. 예측은 투자 추천·수익 보장·실제 성과가 아닙니다.</p>
    </section></div>;
}
