import { useState } from "react";
import type { MacroReference, ReferenceRow } from "../../entities/briefing";
import { ChevronDown, BarChart2 } from "lucide-react";
export type BriefingMacroReferenceProps = { reference: MacroReference | null | undefined };
const definitionLabel = (row: ReferenceRow) => row.definition === "close_to_close" ? "전일 종가→종가" : "시가→종가";
const conditionLabel = (row: ReferenceRow) => row.condition === "nasdaq_up" ? "나스닥 상승 뒤 코스피 상승" : "나스닥 하락 뒤 코스피 하락";
const ciLabel = (row: ReferenceRow) => row.ciLowPct !== null && row.ciHighPct !== null ? `${row.ciLowPct.toFixed(1)}% ~ ${row.ciHighPct.toFixed(1)}%` : "—";
const byDefinition = (a: ReferenceRow, b: ReferenceRow) => Number(a.definition === "open_to_close") - Number(b.definition === "open_to_close");
function ReferenceChart({ rows }: { rows: ReferenceRow[] }) {
  const groups = (["nasdaq_up", "nasdaq_down"] as const).map(condition => ({ condition,
    title: condition === "nasdaq_up" ? "나스닥 상승 뒤 코스피 상승 비율" : "나스닥 하락 뒤 코스피 하락 비율",
    items: rows.filter(row => row.condition === condition).sort(byDefinition) })).filter(group => group.items.length);
  let y = 40;
  const positioned = groups.map(group => {
    const headerY = y; y += 24;
    const items = group.items.map(row => { const rowY = y; y += 38; return { row, y: rowY }; });
    y += 18; return { ...group, headerY, items };
  });
  const start = 230, length = 240, height = y + 10;
  return <div className="briefing-reference-chart-wrap" data-testid="macro-reference-chart">
    <div className="briefing-reference-desktop" tabIndex={0} role="region" aria-label="조건별 코스피 방향 비율 차트, 좌우 방향키로 스크롤">
      <svg className="briefing-reference-svg" viewBox={`0 0 750 ${height}`} role="img"
        aria-label={rows.map(row => `${row.label || `${definitionLabel(row)} · ${conditionLabel(row)}`}: 조건부 비율 ${row.ratioPct.toFixed(1)}%, 같은 기간 기준선 ${row.baselinePct.toFixed(1)}%, ${row.count}/${row.total}건, 95% 신뢰구간 ${ciLabel(row)}`).join("; ")}>
        {[0, 50, 100].map(tick => <g key={tick}>
          <text x={start + tick / 100 * length} y={16} className="briefing-svg-scale-text" textAnchor="middle">{tick}%</text>
          <line x1={start + tick / 100 * length} x2={start + tick / 100 * length} y1={25} y2={height - 15} stroke="var(--ds-line)" strokeDasharray="2 3" />
        </g>)}
        {positioned.map(group => <g key={group.condition}>
          <text x={8} y={group.headerY} className="briefing-svg-group-title">{group.title}</text>
          {group.items.map(({ row, y: rowY }) => {
            const x = (value: number) => start + Math.max(0, Math.min(100, value)) / 100 * length;
            return <g key={`${row.definition}-${row.condition}`} className="briefing-svg-row">
              <title>{row.label}: {row.ratioPct.toFixed(1)}%, 기준 {row.baselinePct.toFixed(1)}%</title>
              <text x={start - 14} y={rowY + 12} textAnchor="end" className="briefing-svg-label">{definitionLabel(row)}</text>
              <rect x={start} y={rowY} width={length} height={16} rx={3} className="briefing-svg-bar-bg" />
              <rect x={start} y={rowY} width={x(row.ratioPct) - start} height={16} rx={3} className={`briefing-svg-bar ${row.definition === "open_to_close" ? "is-model-span" : "is-c2c"}`} />
              <line data-testid={`reference-baseline-${row.definition}-${row.condition}`} x1={x(row.baselinePct)} x2={x(row.baselinePct)} y1={rowY - 3} y2={rowY + 19} className="briefing-svg-baseline" />
              {row.ciLowPct !== null && row.ciHighPct !== null && <g className="briefing-svg-ci-group">
                <line x1={x(row.ciLowPct)} x2={x(row.ciHighPct)} y1={rowY + 8} y2={rowY + 8} className="briefing-svg-ci-line" />
                {[row.ciLowPct, row.ciHighPct].map((value, index) => <line key={index} x1={x(value)} x2={x(value)} y1={rowY + 4} y2={rowY + 12} className="briefing-svg-ci-cap" />)}
              </g>}
              <text x={start + length + 14} y={rowY + 12} className="briefing-svg-val-text">{row.ratioPct.toFixed(1)}% ({row.count}/{row.total}건) · 기준 {row.baselinePct.toFixed(1)}%</text>
            </g>;
          })}
        </g>)}
      </svg>
    </div>
    <div className="briefing-reference-mobile" aria-label="조건별 통계 상세">
      {groups.flatMap(group => group.items.map(row => <article className="briefing-reference-stat-row" key={`${row.definition}-${row.condition}`}>
        <h4>{conditionLabel(row)}</h4><p>{definitionLabel(row)}</p>
        <dl><div><dt>조건부 비율</dt><dd>{row.ratioPct.toFixed(1)}%</dd></div><div><dt>관측 건수</dt><dd>{row.count}/{row.total}건</dd></div>
          <div><dt>같은 기간 기준선</dt><dd>{row.baselinePct.toFixed(1)}%</dd></div><div><dt>95% 신뢰구간</dt><dd>{ciLabel(row)}</dd></div></dl>
      </article>))}
    </div>
  </div>;
}
export function BriefingMacroReference({ reference }: BriefingMacroReferenceProps) {
  const [isOpen, setIsOpen] = useState(false);
  if (!reference?.rows.length) return null;
  const upC2c = reference.rows.find(row => row.condition === "nasdaq_up" && row.definition === "close_to_close");
  const upO2c = reference.rows.find(row => row.condition === "nasdaq_up" && row.definition === "open_to_close");
  const summary = reference.note || (upC2c && upO2c
    ? `나스닥 상승 다음 날 코스피 상승 비율 — 종가 기준 ${upC2c.ratioPct.toFixed(1)}% (기준선 ${upC2c.baselinePct.toFixed(1)}%) · 시가→종가 ${upO2c.ratioPct.toFixed(1)}% (기준선 ${upO2c.baselinePct.toFixed(1)}%)`
    : "직전 미국장 방향과 코스피의 과거 조건부 통계입니다.");
  return <article className="briefing-macro-reference-card" data-testid="briefing-macro-reference-card" aria-labelledby="macro-reference-heading">
    <div className="briefing-macro-reference-header"><div className="briefing-macro-reference-title-block">
      <div className="briefing-macro-reference-title-row"><BarChart2 aria-hidden="true" size={15} /><h3 id="macro-reference-heading" className="briefing-macro-reference-title">{reference.title || "참고 통계"}</h3>
        <span className="briefing-macro-reference-tag">과거 조건부 비율 통계</span></div>
      <p className="briefing-macro-reference-summary" data-testid="macro-reference-summary">{summary}</p>
    </div><button type="button" className="briefing-macro-reference-toggle-btn" onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen} aria-controls="macro-reference-details" data-testid="macro-reference-toggle-btn">
      <span>{isOpen ? "상세 통계 접기" : "상세 통계 펼치기"}</span><ChevronDown aria-hidden="true" size={14} /></button></div>
    <div id="macro-reference-details" className="briefing-macro-reference-body" hidden={!isOpen}>
      {isOpen && <><ReferenceChart rows={reference.rows} />
        <div className="briefing-reference-legend"><span>조건부 비율 / 같은 기간 기준선</span>
          <span className="briefing-reference-legend-item"><i className="briefing-legend-swatch is-bar" aria-hidden="true" />전일 종가→종가</span>
          <span className="briefing-reference-legend-item"><i className="briefing-legend-swatch is-model-span" aria-hidden="true" />시가→종가</span>
          <span className="briefing-reference-legend-item"><i className="briefing-legend-swatch is-baseline" aria-hidden="true" />같은 기간 기준선 (점선)</span>
          <span className="briefing-reference-legend-item"><i className="briefing-legend-swatch is-ci" aria-hidden="true" />95% 신뢰구간</span></div>
        <div className="briefing-reference-meta"><p>방법·한계: 각 한국 거래일 직전의 미국 정규장을 연결한 1년 표본입니다. 기준선은 같은 기간 전체 거래일의 방향 비율이며, 표본 수와 신뢰구간을 함께 확인하세요. 거래 비용은 반영하지 않습니다.</p>
          <div className="briefing-reference-source-row"><span>관측 기간: {reference.periodStart || "—"} ~ {reference.periodEnd || "—"} (최종 관측일: {reference.lastObservedDate || "—"})</span>
            {reference.source && <span>출처: {reference.source}</span>}</div></div></>}
    </div>
  </article>;
}
