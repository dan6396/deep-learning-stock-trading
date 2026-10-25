import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChartData } from "../../entities/market";
import type { ChartMode, TimeRange } from "../../types/stockChart";
import { validatedChart } from "./reportData";
import "./priceChart.css";

const won = (value: number) => `${value.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원`;
const percent = (value: number, basis: number) => (value / basis - 1) * 100;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const rangeLabels: Record<TimeRange, string> = { "1D": "1일", "1M": "1개월", "3M": "3개월", "1Y": "1년", "3Y": "3년", "5Y": "5년" };
export function nicePriceTicks(min: number, max: number, count = 4): number[] {
  if (![min, max].every(Number.isFinite) || min > max || count < 2) return [];
  const padding = Math.max((max - min) * .12, max * .005, 1), lo = Math.max(0, min - padding), hi = max + padding;
  const rough = (hi - lo) / Math.max(1, count - 1), magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(value => value * magnitude).find(value => value >= rough) ?? magnitude * 10;
  const bottom = Math.floor(lo / step) * step, top = Math.ceil(hi / step) * step;
  return Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => Number((bottom + i * step).toFixed(6)));
}
function dateLabel(value: number, range: TimeRange, full = false): string {
  const date = new Date(value + 9 * 3600_000).toISOString();
  return range === "1D" ? `${date.slice(0, 10)} ${date.slice(11, 16)}`.slice(full ? 0 : 11)
    : full ? date.slice(0, 10) : range === "3Y" || range === "5Y" ? date.slice(0, 7) : date.slice(5, 10).replace("-", "/");
}
export function PriceChart({ data, mode = "area", label }: { data: ChartData; mode?: ChartMode; label?: string }) {
  const view = validatedChart(data), container = useRef<HTMLDivElement>(null), [width, setWidth] = useState(640), [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const element = container.current; if (!element) return;
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth); }; measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  const points = mode === "candle" ? view.candles : view.prices.map(point => ({ time: point.date, timestamp: point.timestamp, open: point.price, close: point.price, high: point.price, low: point.price, volume: null }));
  if (!points.length) return <p className="report-empty">{mode === "candle" ? "원본 시각·시가·고가·저가·종가를 확인할 수 없어 캔들 차트를 제공하지 않습니다. 가격 선에서 확인하세요." : "유효한 관측 시각과 가격이 없습니다."}</p>;
  const first = points[0], last = points[points.length - 1], index = Math.max(0, Math.min(points.length - 1, active ?? points.length - 1)), selected = points[index];
  const low = Math.min(...points.map(point => point.low)), high = Math.max(...points.map(point => point.high));
  const ticks = nicePriceTicks(low, high, width < 500 ? 3 : 4), bottom = ticks[0], top = ticks[ticks.length - 1];
  const w = Math.max(280, width), h = width < 500 ? 280 : 310, left = width < 500 ? 76 : 86, right = w - (width < 500 ? 83 : 100), yTop = 40, yBottom = h - 43;
  let start = first.timestamp, end = last.timestamp;
  if (data.range === "1D") { const day = new Date(first.timestamp + 9 * 3600_000).toISOString().slice(0, 10); start = Math.min(start, Date.parse(`${day}T09:00:00+09:00`)); end = Math.max(end, Date.parse(`${day}T15:30:00+09:00`)); }
  const x = (time: number) => left + (time - start) / Math.max(end - start, 1) * (right - left), y = (price: number) => yBottom - (price - bottom) / Math.max(1, top - bottom) * (yBottom - yTop);
  const change = percent(last.close, first.close), direction = change > 0 ? "rise" : change < 0 ? "fall" : "flat", symbol = change > 0 ? "▲" : change < 0 ? "▼" : "●";
  const color = direction === "rise" ? "var(--ds-rise)" : direction === "fall" ? "var(--ds-fall)" : "var(--ds-fg-2)";
  const highPoint = points.find(point => point.high === high)!, lowPoint = points.find(point => point.low === low)!;
  let xTicks: number[];
  if (data.range === "1D") { const day = new Date(first.timestamp + 9 * 3600_000).toISOString().slice(0, 10); xTicks = (width < 500 ? ["09:00", "15:30"] : ["09:00", "11:00", "13:00", "15:30"]).map(time => Date.parse(`${day}T${time}:00+09:00`)); }
  else { const count = width < 500 ? 2 : 4; xTicks = [...new Set(Array.from({ length: count }, (_, i) => points[Math.round(i / (count - 1) * (points.length - 1))].timestamp))]; }
  const move = (delta: number) => setActive(current => Math.max(0, Math.min(points.length - 1, (current ?? points.length - 1) + delta)));
  const summary = label ?? `${rangeLabels[data.range]} 요청 · ${points.length}개 가격 관측 · ${dateLabel(first.timestamp, data.range, true)} ${won(first.close)}부터 ${dateLabel(last.timestamp, data.range, true)} ${won(last.close)}까지. 최고 ${won(high)}, 최저 ${won(low)}.`;
  const selectedSummary = `${dateLabel(selected.timestamp, data.range, true)} · ${data.range === "1D" ? "가격" : "종가"} ${won(selected.close)} · 기간 시작가 대비 ${signed(percent(selected.close, first.close))}${mode === "candle" ? ` · 시가 ${won(selected.open)} · 고가 ${won(selected.high)} · 저가 ${won(selected.low)} · 거래량 ${selected.volume === null ? "—" : selected.volume.toLocaleString("ko-KR")}` : ""}`;
  return <div className="price-chart" ref={container} data-chart-range={data.range} data-chart-code={data.code} data-chart-mode={mode}>
    <p className="price-chart-heading">마지막 관측 <strong>{won(last.close)}</strong> <span data-price-direction={direction} style={{ color }}>{symbol} {signed(change)}</span><span className="price-chart-muted"> · 기간 시작가 {won(first.close)} 대비</span></p>
    <div className="price-chart-interactive" tabIndex={0} role="group" aria-label="가격 탐색 · 좌우 화살표로 관측 이동" onKeyDown={event => { if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) { event.preventDefault(); if (event.key === "Home") setActive(0); else if (event.key === "End") setActive(points.length - 1); else move(event.key === "ArrowRight" ? 1 : -1); } }}>
      {active !== null && <div className="price-chart-tooltip" aria-hidden="true" style={{ left: Math.max(0, Math.min(w - 185, x(selected.timestamp) - 90)) }}><span>{dateLabel(selected.timestamp, data.range, true)}</span><strong>{won(selected.close)} · {signed(percent(selected.close, first.close))}</strong></div>}
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={summary} data-chart-code={data.code} data-chart-range={data.range} onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect(); if (!bounds.width) return;
        const position = (event.clientX - bounds.left) / bounds.width * w, time = start + (position - left) / (right - left) * (end - start);
        let best = 0; points.forEach((point, i) => { if (Math.abs(point.timestamp - time) < Math.abs(points[best].timestamp - time)) best = i; }); setActive(best);
      }}>
        {ticks.map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--ds-line)" /><text x={left - 9} y={y(value) + 4} textAnchor="end">{won(value)}</text></g>)}
        {xTicks.map((time, i) => <g key={time}><line x1={x(time)} x2={x(time)} y1={yBottom} y2={yBottom + 5} stroke="var(--ds-fg-2)" /><text x={x(time)} y={yBottom + 23} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{dateLabel(time, data.range)}</text></g>)}
        <line x1={left} x2={right} y1={y(first.close)} y2={y(first.close)} stroke="var(--ds-fg-2)" strokeDasharray="5 4" data-price-baseline="start" />
        {mode === "area" ? view.segments.map((segment, i) => <g key={i} data-chart-segment><path d={segment.map((point, j) => `${j ? "L" : "M"}${x(point.timestamp)},${y(point.price)}`).join(" ")} stroke={color} strokeWidth="2" fill="none" />{segment.length === 1 && <circle cx={x(segment[0].timestamp)} cy={y(segment[0].price)} r="3" fill={color} />}</g>)
          : points.map(point => { const candleColor = point.close > point.open ? "var(--ds-rise)" : point.close < point.open ? "var(--ds-fall)" : "var(--ds-fg-2)", candleWidth = Math.max(1, Math.min(7, (right - left) / points.length * .6));
            return <g key={point.time} fill={candleColor} stroke={candleColor}><line x1={x(point.timestamp)} x2={x(point.timestamp)} y1={y(point.low)} y2={y(point.high)} /><rect x={x(point.timestamp) - candleWidth / 2} y={y(Math.max(point.open, point.close))} width={candleWidth} height={Math.max(1, Math.abs(y(point.open) - y(point.close)))} /></g>; })}
        {[{ point: highPoint, price: high, name: high === low ? "최고·최저" : "최고", offset: -12 }, ...(high === low ? [] : [{ point: lowPoint, price: low, name: "최저", offset: 20 }])].map(mark => <g key={mark.name}><circle cx={x(mark.point.timestamp)} cy={y(mark.price)} r="3" fill="var(--ds-fg)" /><text className="price-chart-extreme" x={Math.max(left + 48, Math.min(right - 48, x(mark.point.timestamp)))} y={Math.max(15, Math.min(yBottom + 14, y(mark.price) + mark.offset))} textAnchor="middle">{mark.name} {won(mark.price)}</text></g>)}
        <line x1={x(selected.timestamp)} x2={x(selected.timestamp)} y1={yTop} y2={yBottom} stroke="var(--ds-fg-2)" strokeDasharray="3 3" />
        <line x1={left} x2={right} y1={y(selected.close)} y2={y(selected.close)} stroke="var(--ds-fg-2)" strokeDasharray="3 3" />
        <circle cx={x(selected.timestamp)} cy={y(selected.close)} r="4" fill="var(--ds-fg)" />
        <line x1={x(last.timestamp)} x2={right + 5} y1={y(last.close)} y2={y(last.close)} stroke={color} />
        <text x={right + 8} y={y(last.close) + 4} fill={color} data-price-last-label>{symbol} {won(last.close)}</text>
      </svg>
    </div>
    <div className="price-chart-explore"><button type="button" aria-label="이전 가격 관측" disabled={index === 0} onClick={() => move(-1)}><ChevronLeft size={16} aria-hidden="true" /></button><p role="status" aria-live="polite" data-price-tooltip>{selectedSummary}</p><button type="button" aria-label="다음 가격 관측" disabled={index === points.length - 1} onClick={() => move(1)}><ChevronRight size={16} aria-hidden="true" /></button></div>
    {(view.rejectedPrices > 0 || view.rejectedCandles > 0) && <p className="price-chart-muted">잘못된 시각·가격은 제외하며 결측 구간은 선으로 잇지 않습니다.</p>}
  </div>;
}
