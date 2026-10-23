import type { FocusEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, MoveHorizontal } from "lucide-react";
import type { CandidateData } from "../../entities/candidate";
import { modelSignal } from "../../entities/signals";
import { formatNumber, formatRankScore } from "../../shared/lib/format";
import { PredictionDirection } from "../briefing/PredictionDirection";
import { useAppPaths } from "../../app/paths";
import { SignalView } from "../briefing/SignalView";
import { WatchToggle } from "../watchlist/WatchToggle";
import { noNewsEvidence, rankSignals, rankRowNote, type RankAnalysisState, type RankSort } from "./rankData";
import "../briefing/briefing.css";
import "./rank.css";
import type { CandidateProduction } from "../briefing/membership";

const columns: { key: RankSort; label: string }[] = [
  { key: "predictedReturn", label: "이전 모델 값" }, { key: "rank", label: "원본 모델 순위" },
  { key: "finalRank", label: "최종 보정 순위" }, { key: "finalPredictedReturn", label: "최종 보정 예측" },
];
export function RankTable({ rows, members, membershipState, sort, descending = false, onSort, missingCodes = new Set<string>(), analysisState = "confirmed", production = "produced", showFinal = production === "produced" && membershipState === "confirmed", modeReady = production === "unproduced" || (production === "produced" && membershipState === "confirmed"), scoreMode = rows.some(row => row.scoreKind === "rank_zscore") }: {
  rows: CandidateData[]; members: Set<string>; membershipState: "pending" | "unknown" | "confirmed";
  sort?: RankSort; descending?: boolean; onSort?: (key: RankSort) => void; missingCodes?: Set<string>;
  analysisState?: RankAnalysisState;
  production?: CandidateProduction;
  showFinal?: boolean;
  modeReady?: boolean;
  scoreMode?: boolean;
}) {
  const paths = useAppPaths(), modelOnly = production === "unproduced";
  const visibleColumns = showFinal ? columns : columns.filter(column => column.key !== "finalRank" && column.key !== "finalPredictedReturn");
  function sortHeading(key: RankSort, label: string) {
    const Icon = sort === key ? descending ? ArrowDown : ArrowUp : ArrowUpDown;
    return onSort ? <button type="button" onClick={() => onSort(key)} data-sort={key}>{label}<Icon aria-hidden="true" size={14} /></button> : label;
  }
  function keepFocusedControlVisible(event: FocusEvent<HTMLDivElement>) {
    const viewport = event.currentTarget, target = event.target;
    if (!(target instanceof HTMLElement) || target === viewport || target.closest<HTMLTableCellElement>("th,td")?.cellIndex === 0) return;
    // Native focus scrolling does not consistently account for a sticky column.
    requestAnimationFrame(() => {
      if (!viewport.isConnected || document.activeElement !== target) return;
      const fixed = viewport.querySelector("th:first-child")?.getBoundingClientRect();
      if (!fixed) return;
      const rect = target.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      const left = fixed.right + 8, right = bounds.right - 8;
      if (rect.left < left) viewport.scrollLeft += rect.left - left;
      else if (rect.right > right) viewport.scrollLeft += rect.right - right;
    });
  }
  if (scoreMode) return <>
    <p className="rank-scroll-hint is-narrow-only"><MoveHorizontal size={16} aria-hidden="true" />좌우로 이동해 비교하세요.</p>
    <div className="rank-table-scroll rank-score-scroll" role="region" tabIndex={0} aria-label="모델 순위표, 좁은 화면에서는 가로로 이동할 수 있습니다">
      <table className="rank-table rank-score-table"><caption className="watch-sr-only">모델 상대 순위와 확인 가능한 기사 수입니다. 순위 점수는 수익률이나 확률이 아닙니다.</caption>
        <thead><tr>
          <th scope="col" aria-sort={onSort ? sort === "rank" ? descending ? "descending" : "ascending" : "none" : undefined}>{sortHeading("rank", "순위")}</th>
          <th scope="col" aria-sort={onSort ? sort === "name" ? descending ? "descending" : "ascending" : "none" : undefined}>{sortHeading("name", "종목")}</th>
          <th scope="col" aria-sort={onSort ? sort === "predictedReturn" ? descending ? "descending" : "ascending" : "none" : undefined}>{sortHeading("predictedReturn", "순위 점수")}</th>
          <th scope="col">상위 %</th><th scope="col">관련 기사</th><th scope="col">관심</th>
        </tr></thead>
        <tbody>{rows.map(row => {
          const validRank = row.rank !== null && row.rank > 0 && row.poolSize !== null && row.poolSize >= row.rank;
          const percent = validRank ? row.rank! / row.poolSize! * 100 : null;
          const model = modelSignal(row), top = model.state === "positive";
          const membership = membershipState === "confirmed" ? members.has(row.code) ? "candidate" : "nonCandidate" : membershipState;
          const note = rankRowNote(analysisState, missingCodes.has(row.code), membership, modelOnly);
          return <tr key={row.code} data-rank-code={row.code} data-top-rank={top} data-membership={membership}>
            <td data-value="rank">{formatNumber(row.rank)}</td>
            <td><div className="rank-score-stock"><Link to={paths.stock(row.code)}><strong>{row.name ?? "이름 미확인"}</strong><small>{row.code}</small></Link>{top && <SignalView signal={model} model />}</div>{note && <small className="rank-row-note">{note}</small>}</td>
            <td data-value="predictedReturn">{formatRankScore(row.rankScore)}</td>
            <td>{percent === null ? "—" : `${formatNumber(percent, 2)}%`}</td>
            <td>{row.news.length || row.newsCollected ? `${row.news.length}건` : "—"}</td>
            <td><WatchToggle code={row.code} name={row.name} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </>;
  return <><p className="rank-scroll-hint"><MoveHorizontal size={16} aria-hidden="true" />좌우로 이동해 비교하세요 · 종목명은 고정됩니다.</p>
    <div className="rank-table-scroll" role="region" tabIndex={0} onFocusCapture={keepFocusedControlVisible} aria-label="종목 비교표, 좁은 화면에서는 가로로 이동할 수 있습니다">
    <table className={`rank-table${modelOnly ? " rank-model-table" : ""}`}><caption className="watch-sr-only">전체 순위 원본 비교. 모델 예측은 방향만 표시하며 실제 성과가 아닙니다. 누락값은 —입니다.</caption>
      <thead><tr><th scope="col" aria-sort={onSort ? sort === "name" ? descending ? "descending" : "ascending" : "none" : undefined}>{sortHeading("name", "종목")}</th>
        {visibleColumns.map(column => <th key={column.key} scope="col" aria-sort={onSort ? sort === column.key ? descending ? "descending" : "ascending" : "none" : undefined}>{sortHeading(column.key, column.label)}</th>)}
        <th scope="col">모델</th>{modeReady && !modelOnly && <th scope="col">뉴스</th>}</tr></thead>
      <tbody>{rows.map(row => {
        const membership = membershipState === "confirmed" ? members.has(row.code) ? "candidate" : "nonCandidate" : membershipState;
        const signals = rankSignals(row, membership, production), missing = missingCodes.has(row.code);
        const note = rankRowNote(analysisState, missing, membership, modelOnly);
        return <tr key={row.code} data-rank-code={row.code} data-membership={membership}>
          <td><div className="rank-stock"><WatchToggle code={row.code} name={row.name} /><Link to={paths.stock(row.code)}><strong>{row.name ?? "이름 미확인"}</strong><small>{row.code}</small></Link></div>
            {note && <small className="rank-row-note">{note}</small>}</td>
          <td data-value="predictedReturn"><PredictionDirection value={row.predictedReturn} rankScore={row.rankScore} scoreKind={row.scoreKind} /></td>
          <td data-value="rank">{formatNumber(row.rank)}</td>
          {showFinal && <><td data-value="finalRank">{formatNumber(row.finalRank)}</td>
          <td data-value="finalPredictedReturn"><PredictionDirection value={row.finalPredictedReturn} /></td></>}
          <td data-rank-signal="model"><SignalView signal={signals.model} model /></td>
          {modeReady && !modelOnly && <td data-rank-signal="news"><SignalView signal={signals.news} />{noNewsEvidence(row) && <small className="rank-row-note">뉴스 미분석 · 수집 미확인</small>}</td>}
        </tr>;
      })}</tbody>
    </table>
  </div></>;
}
