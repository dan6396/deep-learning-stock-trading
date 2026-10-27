import type { BriefingNarrative, MacroData, PreOpenIndicator } from "../../entities/briefing";
import { citationDomId } from "../../entities/briefing";
import { Sparkline } from "../../shared/ui/Sparkline";
import "./preOpenMarket.css";

function amount(value: number | null, unit: string, signed = false) {
  if (value === null) return "—";
  const digits = unit === "%p" ? 3 : 2, rounded = Number(value.toFixed(digits));
  return `${signed && rounded > 0 ? "+" : ""}${(Object.is(rounded, -0) ? 0 : rounded).toLocaleString("ko-KR", { minimumFractionDigits: unit === "%p" ? 3 : unit === "%" ? 2 : 0, maximumFractionDigits: digits })}${unit === "KRW" ? "원" : unit}`;
}
const displayedChange = (value: number | null, unit: string) => value === null ? 0 : Number(value.toFixed(unit === "%" ? 3 : 2));
function change(row: PreOpenIndicator, five = false) {
  const value = five ? row.fiveDayChange : row.change;
  return amount(value, row.unit === "%" ? "%p" : row.unit, true);
}
function asOf(value: string | null) {
  if (!value) return "기준 시각 미확인";
  return value.length === 10 ? `${value} 일봉 · 종가 시각 미확인` : new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + " KST";
}
export function PreOpenMarketSection({ macro, narrative, onCitationClick }: { macro: MacroData; narrative: BriefingNarrative; onCitationClick: (id: string) => void }) {
  if (!macro.preOpen) return null;
  const outlook = narrative.marketOutlook;
  return <section className="preopen-section" aria-labelledby="preopen-heading">
    <header><h2 id="preopen-heading">장전 시장 지표</h2><p>직전 미국장 종가 관측일 기준 · 휴장·결측일은 보간하지 않습니다</p></header>
    <div className="preopen-grid">{macro.preOpen.map(row => {
      const fiveChange = displayedChange(row.fiveDayChange, row.unit), dayChange = displayedChange(row.change, row.unit);
      const direction = fiveChange === 0 ? "flat" : fiveChange > 0 ? "rise" : "fall";
      if (row.status !== "ok" && row.id === "KOSPI200_FOREIGN_FUTURES") return <article key={row.id} id={citationDomId(`M:${row.id}`)} className="preopen-card preopen-unavailable" tabIndex={-1} data-testid={`preopen-${row.id}`}><h3>{row.name}</h3><span>출처 확인 중</span></article>;
      return <article key={row.id} id={citationDomId(`M:${row.id}`)} className="preopen-card" tabIndex={-1} data-testid={`preopen-${row.id}`}>
        <h3>{row.name}</h3><strong className="preopen-value">{row.status === "ok" ? amount(row.value, row.unit) : "자료 없음"}</strong>
        <p className={dayChange > 0 ? "is-rise" : dayChange < 0 ? "is-fall" : ""}>전일 대비 {change(row)}</p>
        <Sparkline segments={[row.history.map(p => ({ timestamp: Date.parse(p.date), price: p.value }))]} label={`${row.name} 최근 ${row.history.length}개 관측일 추세`} className="preopen-sparkline" color={direction === "rise" ? "var(--ds-rise)" : direction === "fall" ? "var(--ds-fall)" : "var(--ds-fg-2)"} />
        <p className={`preopen-trend is-${direction}`}>5일 · 첫날 대비 {change(row, true)}{row.fiveDayChangePct !== null && row.unit !== "%" ? ` (${amount(row.fiveDayChangePct, "%", true)})` : ""}</p>
        <p className="preopen-meta">{row.history.length}/5개 관측일 · 단위 {row.unit === "KRW" ? "원" : row.unit}{row.id === "KOSPI200_FOREIGN_FUTURES" && row.status !== "ok" ? "(제공 단위 미확인)" : ""} · {asOf(row.asOf)} · {row.source === "yahoo" ? "Yahoo Finance" : row.source === "kis" ? "KIS" : "출처 확인 중"}</p>
        <p className="preopen-comment"><span className="preopen-placeholder">임시 문구</span>{row.comment.text}</p>
      </article>;
    })}</div>
    {outlook && <article className="preopen-outlook" aria-labelledby="outlook-heading" data-testid="market-outlook">
      <header><h3 id="outlook-heading">AI 최종 의견</h3><span className={`preopen-stance ${outlook.stance === "상승 우위" ? "is-rise" : outlook.stance === "하락 우위" ? "is-fall" : ""}`}>{outlook.stance}</span></header>
      <p className="preopen-meta">AI 의견 · 투자 권유 아님{outlook.source === "template" ? " · 규칙 기반 대체" : ""}</p>
      <p>{outlook.text}</p>
      <div className="preopen-citations" aria-label="최종 의견 인용 근거">{outlook.citations.map(id => <button key={id} onClick={() => onCitationClick(id)}>{macro.preOpen?.find(row => `M:${row.id}` === id)?.name ?? id}</button>)}</div>
    </article>}
  </section>;
}
