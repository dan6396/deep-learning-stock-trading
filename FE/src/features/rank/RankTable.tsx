import type { FocusEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, MoveHorizontal } from "lucide-react";
import type { CandidateData } from "../../entities/candidate";
import { formatAgreement, formatNumber, formatPercent } from "../../shared/lib/format";
import { useAppPaths } from "../../app/paths";
import { SignalView } from "../briefing/SignalView";
import { WatchToggle } from "../watchlist/WatchToggle";
import { noNewsEvidence, rankSignals, type RankSort } from "./rankData";
import "../briefing/briefing.css";
import "./rank.css";
import type { CandidateProduction } from "../briefing/membership";

const columns: { key: RankSort; label: string }[] = [
  { key: "rank", label: "원본 모델 순위" }, { key: "predictedReturn", label: "모델 예측" },
  { key: "finalRank", label: "최종 보정 순위" }, { key: "finalPredictedReturn", label: "최종 보정 예측" },
];
export function RankTable({ rows, members, membershipState, sort, descending = false, onSort, missingCodes = new Set<string>(), analysisState = "confirmed", production = "produced", showFinal = production === "produced" && membershipState === "confirmed", modeReady = production === "unproduced" || (production === "produced" && membershipState === "confirmed") }: {
  rows: CandidateData[]; members: Set<string>; membershipState: "pending" | "unknown" | "confirmed";
  sort?: RankSort; descending?: boolean; onSort?: (key: RankSort) => void; missingCodes?: Set<string>;
  analysisState?: "pending" | "unknown" | "previous" | "confirmed";
  production?: CandidateProduction;
  showFinal?: boolean;
  modeReady?: boolean;
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
  return <><p className="rank-scroll-hint"><MoveHorizontal size={16} aria-hidden="true" />좌우로 이동해 비교하세요 · 종목명은 고정됩니다.</p>
    <div className="rank-table-scroll" role="region" tabIndex={0} onFocusCapture={keepFocusedControlVisible} aria-label="종목 비교표, 좁은 화면에서는 가로로 이동할 수 있습니다">
    <table className={`rank-table${modelOnly ? " rank-model-table" : ""}`}><caption className="watch-sr-only">전체 순위 원본 비교. 예측값은 실제 성과가 아니며 누락값은 —입니다.</caption>
      <thead><tr><th scope="col" aria-sort={onSort ? sort === "name" ? descending ? "descending" : "ascending" : "none" : undefined}>{sortHeading("name", "종목")}</th>
        {visibleColumns.map(column => <th key={column.key} scope="col" aria-sort={onSort ? sort === column.key ? descending ? "descending" : "ascending" : "none" : undefined}>{sortHeading(column.key, column.label)}</th>)}
        <th scope="col">모델</th>{modeReady && !modelOnly && <th scope="col">뉴스</th>}<th scope="col">수급</th>{modeReady && <th scope="col">근거 일치도</th>}</tr></thead>
      <tbody>{rows.map(row => {
        const membership = membershipState === "confirmed" ? members.has(row.code) ? "candidate" : "nonCandidate" : membershipState;
        const signals = rankSignals(row, membership, production), missing = missingCodes.has(row.code);
        return <tr key={row.code} data-rank-code={row.code} data-membership={membership}>
          <td><div className="rank-stock"><WatchToggle code={row.code} name={row.name} /><Link to={paths.stock(row.code)}><strong>{row.name ?? "이름 미확인"}</strong><small>{row.code}</small></Link></div>
            {(!modelOnly || analysisState !== "confirmed" || missing) && <small className="rank-row-note">{analysisState === "pending" ? "분석 조회 중" : analysisState === "unknown" ? "분석 조회 실패 · 미확인" : analysisState === "previous" ? missing ? "이전 조회 결과 · 현재 분석 여부 미확인" : "이전 조회 결과" : missing ? "분석 미제공" : membership === "candidate" ? "최종 후보" : membership === "nonCandidate" ? "최종 후보 외 종목" : membership === "pending" ? "최종 후보 확인 중" : "최종 후보 미확인"}</small>}</td>
          <td data-value="rank">{formatNumber(row.rank)}</td>
          <td data-value="predictedReturn"><strong className={row.predictedReturn != null && row.predictedReturn > 0 ? "rank-rise" : row.predictedReturn != null && row.predictedReturn < 0 ? "rank-fall" : ""}>{formatPercent(row.predictedReturn)}</strong></td>
          {showFinal && <><td data-value="finalRank">{formatNumber(row.finalRank)}</td>
          <td data-value="finalPredictedReturn"><strong className={row.finalPredictedReturn != null && row.finalPredictedReturn > 0 ? "rank-rise" : row.finalPredictedReturn != null && row.finalPredictedReturn < 0 ? "rank-fall" : ""}>{formatPercent(row.finalPredictedReturn)}</strong></td></>}
          <td data-rank-signal="model"><SignalView signal={signals.model} /></td>
          {modeReady && !modelOnly && <td data-rank-signal="news"><SignalView signal={signals.news} />{noNewsEvidence(row) && <small className="rank-row-note">뉴스 미분석 · 수집 미확인</small>}</td>}
          <td data-rank-signal="supply"><SignalView signal={signals.supply} />{signals.supply.state === "unavailable" && <small className="rank-row-note">{row.supply.foreignNetBuy === null && row.supply.institutionNetBuy === null ? "수급 미분석" : row.supply.combinedPositiveDays === null ? "합산 순매수 일수 미제공" : "수급 판정 자료 부족"}</small>}</td>
          {modeReady && <td><strong>{formatAgreement(signals.agreement.ratio)}</strong><small className="rank-row-note">긍정 {signals.agreement.positive}/{signals.agreement.evaluable} · {modelOnly ? "뉴스 미사용" : `판정 불가 ${signals.agreement.unavailable}`}</small>{signals.agreement.evaluable === 1 && <small className="rank-row-note">평가 가능한 근거 1개 기준</small>}</td>}
        </tr>;
      })}</tbody>
    </table>
  </div></>;
}
