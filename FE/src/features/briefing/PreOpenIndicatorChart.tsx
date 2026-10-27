import { useEffect, useRef, useState } from "react";
import type { PreOpenIndicator } from "../../entities/briefing";

type Observation = PreOpenIndicator["history"][number];
const dateLabel = (date: string) => date.slice(5).replace("-", "/");
export function formatObservation(value: number, unit: string, withUnit = true): string {
  const digits = unit === "%" ? 3 : unit === "계약" ? 0 : 2;
  const rounded = Number(value.toFixed(digits));
  return `${unit === "계약" && rounded > 0 ? "+" : ""}${(Object.is(rounded, -0) ? 0 : rounded).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: unit === "%" ? 3 : 0 })}${withUnit ? unit === "KRW" ? "원" : unit : ""}`;
}

/** Conservative 12px label widths, including full-width Korean unit glyphs. */
export const chartLabelWidth = (text: string) => Array.from(text).reduce((width, character) => width + (/[가-힣]/.test(character) ? 12 : /[.,]/.test(character) ? 4 : 8), 0);

/** Actual observations only. Labels have a separate band above the plot. */
export function indicatorChartLayout(history: readonly Observation[], unit: string, width: number) {
  const data = history.filter(row => Number.isFinite(row.value));
  if (!data.length) return null;
  const values = data.map(row => row.value), futures = unit === "계약";
  const min = Math.min(...values, ...(futures ? [0] : [])), max = Math.max(...values, ...(futures ? [0] : []));
  const tickValues = futures ? [0] : [...new Set([max, min])];
  const left = Math.max(...tickValues.map(value => chartLabelWidth(formatObservation(value, unit)))) + 16;
  const right = width - 24, narrow = width < 400;
  const x = (index: number) => data.length === 1 ? (left + right) / 2 : left + (right - left) * index / (data.length - 1);
  const last = data.length - 1;
  // Axis labels already expose the extrema. Every observation remains in aria/tooltip.
  const axisValues = new Set(tickValues.map(value => formatObservation(value, unit, false)));
  const selected = data.map((_row, index) => index).filter(index => futures || !axisValues.has(formatObservation(data[index].value, unit, false)));
  const occupied: { left: number; right: number; lane: number }[] = [];
  const labels = selected.map(index => {
    const text = formatObservation(data[index].value, unit, false), size = chartLabelWidth(text) + 4;
    const center = Math.max(size / 2 + 2, Math.min(width - size / 2 - 2, x(index)));
    const bounds = { left: center - size / 2, right: center + size / 2 };
    let lane = 0;
    while (occupied.some(other => other.lane === lane && other.left < bounds.right + 6 && other.right + 6 > bounds.left)) lane++;
    occupied.push({ ...bounds, lane });
    return { index, text, x: center, y: 14 + lane * 16 };
  });
  const plotTop = 26 + Math.max(0, ...occupied.map(label => label.lane)) * 16, plotBottom = plotTop + 52;
  const y = (value: number) => max === min ? (plotTop + plotBottom) / 2 : plotBottom - (value - min) / (max - min) * 52;
  const ticks = tickValues.map(value => ({ value, text: formatObservation(value, unit), y: y(value) }));
  const dates = [...new Set(narrow ? [0, Math.floor(last / 2), last] : data.map((_row, index) => index))];
  return { data, labels, ticks, dates, x, y, left, right, plotTop, plotBottom, height: plotBottom + 28, zero: futures ? y(0) : null };
}

export function PreOpenIndicatorChart({ row, color }: { row: PreOpenIndicator; color: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(460), [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  const chart = indicatorChartLayout(row.history, row.unit, width);
  if (!chart) return <div className="preopen-chart" ref={host} role="img" aria-label={`${row.name}: 관측 자료 없음`}>관측 자료 없음</div>;
  const { data } = chart, futures = row.unit === "계약";
  const values = data.map(point => point.value), last = data[data.length - 1];
  const summary = `${row.name}: ${data[0].date}~${last.date} · ${data.length}개 관측 · 최소 ${formatObservation(Math.min(...values), row.unit)} · 최대 ${formatObservation(Math.max(...values), row.unit)} · 마지막 ${last.date} ${formatObservation(last.value, row.unit)}`;
  return <div className="preopen-chart" ref={host}>
    <svg width="100%" height={chart.height} viewBox={`0 0 ${width} ${chart.height}`} role="group" aria-label={summary}>
      {chart.ticks.map(tick => <g key={tick.value}>
        <text aria-hidden="true" className="preopen-chart-label" data-chart-label="axis" x={chart.left - 12} y={tick.y + 4} textAnchor="end">{tick.text}</text>
        <line x1={chart.left} x2={chart.right} y1={tick.y} y2={tick.y} className="preopen-chart-grid" />
      </g>)}
      {chart.zero !== null && <line data-testid="futures-zero-line" x1={chart.left} x2={chart.right} y1={chart.zero} y2={chart.zero} className="preopen-chart-zero" />}
      {!futures && data.length > 1 && <path d={data.map((point, index) => `${index ? "L" : "M"} ${chart.x(index)} ${chart.y(point.value)}`).join(" ")} fill="none" stroke={color} strokeWidth="1.5" />}
      {data.map((point, index) => <g key={point.date} tabIndex={0} role="button" aria-label={`${point.date} ${formatObservation(point.value, row.unit)}`}
        onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)}
        onKeyDown={event => { if (event.key === "Escape") setActive(null); if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(index); } }}>
        <rect data-chart-hit-area="true" aria-hidden="true" x={chart.x(index) - 22} y={chart.y(point.value) - 22} width="44" height="44" fill="transparent" />
        {futures && <rect data-testid="futures-bar" x={chart.x(index) - 9} width="18" y={Math.min(chart.y(point.value), chart.zero!)} height={Math.max(1, Math.abs(chart.y(point.value) - chart.zero!))} fill={point.value > 0 ? "var(--ds-rise)" : point.value < 0 ? "var(--ds-fall)" : "var(--ds-fg-2)"} />}
        <circle cx={chart.x(index)} cy={chart.y(point.value)} r={index === data.length - 1 || active === index ? 4 : 2.5} fill={futures ? point.value > 0 ? "var(--ds-rise)" : point.value < 0 ? "var(--ds-fall)" : "var(--ds-fg-2)" : color} stroke="var(--ds-surface)" strokeWidth="1" />
        <circle aria-hidden="true" className="preopen-chart-focus-ring" cx={chart.x(index)} cy={chart.y(point.value)} r="7" />
      </g>)}
      {chart.labels.map(label => <text aria-hidden="true" key={label.index} className="preopen-chart-label" data-chart-label="value" x={label.x} y={label.y} textAnchor="middle">{label.text}</text>)}
      {chart.dates.map(index => <text aria-hidden="true" key={index} className="preopen-chart-label" data-chart-label="date" x={chart.x(index)} y={chart.plotBottom + 22} textAnchor="middle">{dateLabel(data[index].date)}</text>)}
    </svg>
    {active !== null && data[active] && <div role="tooltip" aria-hidden="true" className="preopen-chart-tooltip">{data[active].date} · {formatObservation(data[active].value, row.unit)}</div>}
  </div>;
}
