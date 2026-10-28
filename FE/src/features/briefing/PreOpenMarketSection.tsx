import { useId, useState } from "react";
import type { BriefingNarrative, MacroData, PreOpenIndicator } from "../../entities/briefing";
import { citationDomId } from "../../entities/briefing";
import { PreOpenIndicatorChart } from "./PreOpenIndicatorChart";
import "./preOpenMarket.css";

function amount(value: number | null, unit: string, signed = false) {
  if (value === null) return "—";
  const digits = unit === "%p" || unit === "%" ? 3 : unit === "계약" ? 0 : 2, rounded = Number(value.toFixed(digits));
  return `${signed && rounded > 0 ? "+" : ""}${(Object.is(rounded, -0) ? 0 : rounded).toLocaleString("ko-KR", { minimumFractionDigits: unit === "%p" || unit === "%" ? 3 : 0, maximumFractionDigits: digits })}${unit === "KRW" ? "원" : unit}`;
}
const displayedChange = (value: number | null, unit: string) => value === null ? 0 : Number(value.toFixed(unit === "%" ? 3 : 2));
function change(row: PreOpenIndicator) {
  return amount(row.change, row.unit === "%" ? "%p" : row.unit, true);
}
function asOf(value: string | null) {
  if (!value) return "기준 시각 미확인";
  return value.length === 10 ? `${value} 일봉 · 종가 시각 미확인` : new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + " KST";
}
export function PreOpenMarketSection({ macro, narrative, onCitationClick }: { macro: MacroData; narrative: BriefingNarrative; onCitationClick: (id: string) => void }) {
  const contentId = useId();
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(() => new Set());
  const [outlookExpanded, setOutlookExpanded] = useState(false);
  if (!macro.preOpen) return null;
  const outlook = narrative.marketOutlook;
  const order = ["NASDAQ", "UST10Y", "SOX", "KOSPI200_FOREIGN_FUTURES", "USDKRW"];
  const indicators = [...macro.preOpen].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const canExpandOutlook = Boolean(outlook && outlook.text.length > 120);
  const outlookCollapsed = canExpandOutlook && !outlookExpanded;
  return <section className="preopen-section" aria-labelledby="preopen-heading">
    <header><h2 id="preopen-heading">장전 시장 지표</h2><p>미국장 종가·국내 직전 거래일 기준 · 휴장·결측일은 보간하지 않습니다</p><p>분석 의견은 지표 구간에 따라 미리 정해진 문구가 표시되며 투자 권유가 아닙니다</p></header>
    <div className={`preopen-grid ${indicators.length === 5 ? "has-five-cards" : indicators.length === 4 ? "has-four-cards" : ""}`}>{indicators.map(row => {
      const fiveChange = displayedChange(row.fiveDayChange, row.unit), dayChange = displayedChange(row.change, row.unit);
      const futures = row.id === "KOSPI200_FOREIGN_FUTURES";
      const showComment = Boolean(row.comment.text);
      const metadata = `${row.history.length}/5개 관측일 · 단위 ${row.unit === "KRW" ? "원" : row.unit} · ${futures ? `기준일 ${row.asOf ?? "미확인"} · KIS 시장별 투자자매매동향(일별) · 직전 거래일` : `${asOf(row.asOf)} · ${row.source === "yahoo" ? "Yahoo Finance" : row.source === "kis" ? "KIS" : "출처 확인 중"}`}`;
      const colorValue = futures ? row.value ?? 0 : fiveChange;
      const direction = colorValue === 0 ? "flat" : colorValue > 0 ? "rise" : "fall";
      if (row.status !== "ok" && row.id === "KOSPI200_FOREIGN_FUTURES") return <article key={row.id} id={citationDomId(`M:${row.id}`)} className="preopen-card preopen-unavailable" tabIndex={-1} data-testid={`preopen-${row.id}`}><h3>{row.name}</h3><span>출처 확인 중</span></article>;
      return <article key={row.id} id={citationDomId(`M:${row.id}`)} className="preopen-card" title={metadata} aria-labelledby={`${contentId}-${row.id}-heading`} aria-describedby={`${contentId}-${row.id}-metadata`} tabIndex={-1} data-testid={`preopen-${row.id}`}>
        <span id={`${contentId}-${row.id}-metadata`} hidden>{metadata}</span>
        <h3 id={`${contentId}-${row.id}-heading`}>{row.name}</h3><strong className={`preopen-value ${futures ? `is-${direction}` : ""}`}>{row.status === "ok" ? amount(row.value, row.unit, futures) : "자료 없음"}</strong>
        <p className={`preopen-day-change ${dayChange > 0 ? "is-rise" : dayChange < 0 ? "is-fall" : ""}`}>전일 대비 {change(row)}</p>
        {!futures && <p className="preopen-trend-label">5일 추세</p>}
        <PreOpenIndicatorChart row={row} color={direction === "rise" ? "var(--ds-rise)" : direction === "fall" ? "var(--ds-fall)" : "var(--ds-fg-2)"} />
        {futures && <p className={`preopen-trend is-${(row.fiveDaySum ?? 0) > 0 ? "rise" : (row.fiveDaySum ?? 0) < 0 ? "fall" : "flat"}`}>5일 합계 {amount(row.fiveDaySum ?? null, "계약", true)}</p>}
        {showComment && <button type="button" className="preopen-detail-toggle" aria-label={`${row.name} ${expandedDetails.has(row.id) ? "접기" : "자세히"}`} aria-expanded={expandedDetails.has(row.id)} aria-controls={`${contentId}-${row.id}`} onClick={() => setExpandedDetails(previous => {
          const next = new Set(previous); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next;
        })}>{expandedDetails.has(row.id) ? "접기" : "자세히"}</button>}
        {showComment && <div id={`${contentId}-${row.id}`} className={`preopen-card-details ${expandedDetails.has(row.id) ? "is-expanded" : "is-collapsed"}`}>
          <p className="preopen-comment"><span className="preopen-analysis-label">분석 의견</span>{row.comment.text}</p>
        </div>}
      </article>;
    })}</div>
    {outlook && <article className={`preopen-outlook ${outlookCollapsed ? "is-collapsed" : "is-expanded"}`} aria-labelledby="outlook-heading" data-testid="market-outlook">
      <header><h3 id="outlook-heading">AI 최종 의견</h3><span className={`preopen-stance ${outlook.stance === "상승 우위" ? "is-rise" : outlook.stance === "하락 우위" ? "is-fall" : ""}`}>{outlook.stance}</span></header>
      <p className="preopen-meta">AI 의견 · 투자 권유 아님{outlook.source === "template" ? " · 규칙 기반 대체" : ""}</p>
      <p id={`${contentId}-outlook`} className="preopen-outlook-text">{outlook.text}</p>
      {canExpandOutlook && <button type="button" className="preopen-outlook-toggle" aria-label={`AI 최종 의견 ${outlookExpanded ? "접기" : "더 보기"}`} aria-expanded={outlookExpanded} aria-controls={`${contentId}-outlook ${contentId}-citations`} onClick={() => setOutlookExpanded(previous => !previous)}>{outlookExpanded ? "접기" : "더 보기"}</button>}
      <div id={`${contentId}-citations`} className="preopen-citations" aria-label="최종 의견 인용 근거">{outlook.citations.filter(id => id !== "M:SP500").map(id => <button key={id} onClick={() => onCitationClick(id)}>{macro.preOpen?.find(row => `M:${row.id}` === id)?.name ?? id}</button>)}</div>
    </article>}
  </section>;
}
