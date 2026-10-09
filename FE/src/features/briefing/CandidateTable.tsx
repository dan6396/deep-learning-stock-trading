import { useRef, type KeyboardEvent } from "react";
import { useQueries } from "@tanstack/react-query";
import type { CandidateData } from "../../entities/candidate";
import { briefingSignals, type CandidateProduction } from "./membership";
import { queries } from "../../shared/api/queries";
import { SOURCE_LABELS } from "../../entities/source";
import { formatDate, formatPercent, formatWon } from "../../shared/lib/format";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../shared/ui/table";
import { SignalView } from "./SignalView";
import { EvidenceAgreementView } from "./EvidenceAgreementView";

export function CandidateTable({ candidates, selectedCode, onSelect, membershipConfirmed = true, production = "produced" }: { candidates: CandidateData[]; selectedCode: string | null; onSelect: (code: string, reason?: "pointer" | "keyboard") => void; membershipConfirmed?: boolean; production?: CandidateProduction }) {
  const buttons = useRef(new Map<string, HTMLButtonElement>()), modelOnly = production === "unproduced";
  const quotes = useQueries({ queries: candidates.map(row => ({ ...queries.quote(row.code), retry: false, staleTime: 30_000, refetchOnMount: false })) });
  const maximum = Math.max(0, ...candidates.map(row => row.predictedReturn ?? 0));
  const successful = quotes.filter(quote => !quote.isError && quote.data), sources = [...new Set(successful.map(quote => quote.data!.source))];
  const times = successful.map(quote => quote.data!.asOf).filter((time): time is string => time !== null && Number.isFinite(Date.parse(time))).sort((left, right) => Date.parse(left) - Date.parse(right)), failed = quotes.filter(quote => quote.isError).length;
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? candidates.length - 1 : index + offset;
    if (!offset && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault(); const row = candidates[Math.max(0, Math.min(candidates.length - 1, next))];
    if (row) { onSelect(row.code, "keyboard"); buttons.current.get(row.code)?.focus(); }
  }
  return <><div className="briefing-table-scroll" role="region" tabIndex={0} aria-label="후보 비교표, 좁은 화면에서는 가로로 이동할 수 있습니다">
    <Table className={`briefing-table briefing-comparison-table${modelOnly ? " briefing-model-table" : ""}`}>
      <caption className="briefing-sr-only">후보 비교. 종목 버튼으로 오른쪽 상세를 열고 위·아래 화살표로 선택을 이동할 수 있습니다. 화면 순서를 원본 순위로 사용하지 않습니다.</caption>
      <TableHeader><TableRow><TableHead>원본 순위</TableHead><TableHead>종목</TableHead><TableHead>예측<small>시가→종가</small></TableHead><TableHead>모델</TableHead>{!modelOnly && <TableHead>뉴스</TableHead>}<TableHead>수급</TableHead><TableHead>근거 일치</TableHead><TableHead>현재가</TableHead></TableRow></TableHeader>
      <TableBody>{candidates.map((row, index) => {
        const signals = briefingSignals(row, modelOnly ? "unknown" : membershipConfirmed ? "candidate" : "unknown", production), selected = selectedCode === row.code;
        const quote = quotes[index], sample = quote.data?.source === "sample", price = quote.isError || sample ? null : quote.data?.data;
        return <TableRow key={row.code} data-selected={selected ? "true" : undefined} data-candidate-code={row.code} data-model-code={modelOnly ? row.code : undefined} onClick={event => { if (!(event.target as HTMLElement).closest("button")) onSelect(row.code); }}>
          <TableCell data-value="rank">{row.rank === null ? "—" : String(row.rank).padStart(2, "0")}</TableCell>
          <TableCell><button ref={node => { if (node) buttons.current.set(row.code, node); else buttons.current.delete(row.code); }} type="button" className="briefing-stock-button" aria-pressed={selected} aria-controls="briefing-detail" onClick={() => onSelect(row.code)} onKeyDown={event => navigate(event, index)}>
            <span><strong>{row.name ?? row.code}</strong><small>{row.code}{selected ? <span className="briefing-sr-only"> · 선택됨</span> : null}</small></span><span className="briefing-sr-only"> 상세 보기</span>
          </button></TableCell>
          <TableCell data-value="predictedReturn"><strong className={row.predictedReturn !== null && row.predictedReturn > 0 ? "briefing-rise" : row.predictedReturn !== null && row.predictedReturn < 0 ? "briefing-fall" : ""}>{formatPercent(row.predictedReturn)}</strong>{row.predictedReturn !== null && row.predictedReturn > 0 && maximum > 0 && <span className="briefing-prediction-bar" aria-hidden="true"><i style={{ width: `${row.predictedReturn / maximum * 100}%` }} /></span>}</TableCell>
          <TableCell><SignalView signal={signals.model} /></TableCell>{!modelOnly && <TableCell><SignalView signal={signals.news} /></TableCell>}<TableCell><SignalView signal={signals.supply} /></TableCell>
          <TableCell><EvidenceAgreementView signals={signals} modelOnly={modelOnly} /></TableCell>
          <TableCell className="briefing-quote-cell" aria-label={quote.isError ? `${row.name ?? ""} ${row.code} 현재가 조회 실패` : sample ? `${row.name ?? ""} ${row.code} 예시 시세 · 실제 가격 미표시` : undefined} title={quote.isError ? "현재가 조회 실패" : sample ? "예시 시세 · 실제 가격 미표시" : undefined}><strong>{quote.isPending ? "조회 중" : formatWon(price?.currentPrice)}</strong><small className={price?.changeRate != null && price.changeRate > 0 ? "briefing-rise" : price?.changeRate != null && price.changeRate < 0 ? "briefing-fall" : ""}>{quote.isError ? "조회 실패" : sample ? "예시" : formatPercent(price?.changeRate, "percent")}</small></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </div><p className="briefing-quote-meta" role="status">시세 {quotes.some(quote => quote.isPending) ? "조회 중" : sources.length > 1 ? "혼합" : SOURCE_LABELS[sources[0] ?? "unknown"]} · 조회/저장 {times.length ? formatDate(times[0], true) : "시각 미확인"}{times.length > 1 && times[0] !== times[times.length - 1] ? " (가장 오래된 시각)" : ""}{failed > 0 ? ` · ${failed}건 조회 실패` : ""}</p></>;
}
