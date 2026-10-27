import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import type { ChartData } from "../../entities/market";
import type { ChartMode, TimeRange } from "../../types/stockChart";
import { validatedChart, aggregateCandles, type Candle } from "./reportData";
import "./priceChart.css";

const won = (value: number) => `${value.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원`;
const percent = (value: number, basis: number) => (value / basis - 1) * 100;
const signed = (value: number) => { const rounded = Number(value.toFixed(2)); return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`; };
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
type Props = { data: ChartData; mode?: ChartMode; label?: string; interval?: string; compact?: boolean };

// Reset exploration synchronously when the observation context changes, including direct prop updates.
export function PriceChart(props: Props) {
  return <ChartView key={`${props.data.code}-${props.data.range}-${props.mode ?? "area"}-${props.interval ?? "5m"}`} {...props} />;
}
function ChartView({ data, mode = "area", label, interval = "5m", compact = false }: Props) {
  const view = validatedChart(data), container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640), [active, setActive] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null), [panOffset, setPanOffset] = useState<number | null>(null);
  const intervalMinutes = ({ "1m": 1, "5m": 5, "15m": 15, "30m": 30, "60m": 60 } as Record<string, number>)[interval] ?? 5;
  const points: Candle[] = mode === "candle"
    ? data.range === "1D" ? aggregateCandles(view.candles, intervalMinutes) : view.candles
    : view.prices.map(point => ({ time: point.date, timestamp: point.timestamp, open: point.price, close: point.price, high: point.price, low: point.price, volume: null }));
  const hasPoints = points.length > 0;
  useEffect(() => {
    const element = container.current; if (!element) return;
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth); }; measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, [hasPoints]);
  if (!hasPoints) {
    if (mode === "candle" && view.candles.length > 0) return <p className="report-empty">정규 거래 세션(09:00~15:30) 밖 분봉만 있어 캔들 차트를 표시할 수 없습니다.</p>;
    return <p className="report-empty">{mode === "candle" ? "원본 시각·시가·고가·저가·종가를 확인할 수 없어 캔들 차트를 제공하지 않습니다. 가격 선에서 확인하세요." : "유효한 관측 시각과 가격이 없습니다."}</p>;
  }

  const w = Math.max(280, width), h = width < 500 ? 280 : 310;
  const left = width < 500 ? 70 : 86, right = w - (width < 500 ? 80 : 100), yTop = 40, yBottom = h - 43;
  const availableWidth = right - left;
  // Equal observation slots keep sparse candles readable; no missing candles are generated.
  const maxFitCount = Math.max(1, Math.floor(availableWidth / 7));
  const defaultVisible = mode === "candle" ? Math.min(points.length, maxFitCount) : points.length;
  const minimumCount = Math.min(5, defaultVisible), maximumCount = mode === "candle" ? defaultVisible : points.length;
  const visibleCount = Math.max(minimumCount, Math.min(maximumCount, count ?? defaultVisible));
  const maxStart = points.length - visibleCount;
  let currentStart = Math.max(0, Math.min(maxStart, panOffset ?? maxStart));
  // Width or data updates must also keep the chosen observation in the viewport.
  if (active !== null) {
    const clamped = Math.min(points.length - 1, active);
    if (clamped < currentStart) currentStart = clamped;
    if (clamped >= currentStart + visibleCount) currentStart = clamped - visibleCount + 1;
  }
  const currentEnd = currentStart + visibleCount, visiblePoints = points.slice(currentStart, currentEnd);
  const isSlice = visibleCount < points.length;
  const firstOverall = points[0], lastOverall = points[points.length - 1];
  const firstVisible = visiblePoints[0], lastVisible = visiblePoints[visiblePoints.length - 1];
  const index = Math.max(currentStart, Math.min(currentEnd - 1, active ?? currentEnd - 1)), selected = points[index];
  // The basis is the original first close, independent of the interval, zoom and pan.
  const basisPoint = mode === "candle" ? view.candles.find(point => point.timestamp === (firstOverall.bucket?.first ?? firstOverall.timestamp))! : firstOverall;
  const basis = basisPoint.close, basisLabel = mode === "candle" ? "전체 관측 첫 종가" : "전체 관측 첫 가격";
  const low = Math.min(...visiblePoints.map(point => point.low)), high = Math.max(...visiblePoints.map(point => point.high));
  const ticks = nicePriceTicks(low, high, width < 500 ? 3 : 4), bottom = ticks[0], top = ticks[ticks.length - 1];
  let start = firstVisible.timestamp, end = lastVisible.timestamp;
  if (!isSlice && data.range === "1D") {
    const firstDay = new Date(firstOverall.timestamp + 9 * 3600_000).toISOString().slice(0, 10);
    const lastDay = new Date(lastOverall.timestamp + 9 * 3600_000).toISOString().slice(0, 10);
    start = Math.min(start, Date.parse(`${firstDay}T09:00:00+09:00`));
    end = Math.max(end, Date.parse(`${lastDay}T15:30:00+09:00`));
  }
  // A solid label leader across an unfinished session looks like future prices.
  const showLastPriceConnector = !(data.range === "1D" && lastVisible.timestamp < end && Date.now() < end);
  const slotWidth = availableWidth / visibleCount;
  const x = (time: number) => mode === "candle"
    ? left + (Math.max(0, visiblePoints.findIndex(point => point.timestamp === time)) + .5) * slotWidth
    : start === end ? (left + right) / 2 : left + (time - start) / (end - start) * availableWidth;
  const y = (price: number) => yBottom - (price - bottom) / Math.max(1, top - bottom) * (yBottom - yTop);
  const change = percent(lastOverall.close, basis), direction = change > 0 ? "rise" : change < 0 ? "fall" : "flat", symbol = change > 0 ? "▲" : change < 0 ? "▼" : "●";
  const color = direction === "rise" ? "var(--ds-rise)" : direction === "fall" ? "var(--ds-fall)" : "var(--ds-fg-2)";
  const visibleChange = percent(lastVisible.close, basis), visibleSymbol = visibleChange > 0 ? "▲" : visibleChange < 0 ? "▼" : "●";
  const visibleColor = visibleChange > 0 ? "var(--ds-rise)" : visibleChange < 0 ? "var(--ds-fall)" : "var(--ds-fg-2)";
  const highPoint = visiblePoints.find(point => point.high === high)!, lowPoint = visiblePoints.find(point => point.low === low)!;
  let xTicks: number[];
  if (!isSlice && data.range === "1D" && mode === "area" && dateLabel(firstOverall.timestamp, "1D", true).slice(0, 10) === dateLabel(lastOverall.timestamp, "1D", true).slice(0, 10)) {
    const day = new Date(firstOverall.timestamp + 9 * 3600_000).toISOString().slice(0, 10);
    xTicks = (width < 500 ? ["09:00", "15:30"] : ["09:00", "11:00", "13:00", "15:30"]).map(time => Date.parse(`${day}T${time}:00+09:00`));
  } else {
    const tickCount = width < 500 ? 2 : 4;
    xTicks = [...new Set(Array.from({ length: tickCount }, (_, i) => visiblePoints[Math.round(i / (tickCount - 1) * (visiblePoints.length - 1))].timestamp))];
  }
  const select = (next: number) => {
    const nextIndex = Math.max(0, Math.min(points.length - 1, next)); setActive(nextIndex);
    if (nextIndex < currentStart) setPanOffset(nextIndex);
    else if (nextIndex >= currentEnd) setPanOffset(Math.min(maxStart, nextIndex - visibleCount + 1));
  };
  const zoom = (next: number) => {
    const nextCount = Math.max(minimumCount, Math.min(maximumCount, next));
    setCount(nextCount); setPanOffset(Math.max(0, Math.min(points.length - nextCount, index - Math.floor(nextCount / 2))));
  };
  const pan = (delta: number) => {
    const nextStart = Math.max(0, Math.min(maxStart, currentStart + delta * Math.max(1, Math.round(visibleCount / 2))));
    setPanOffset(nextStart); setActive(Math.max(nextStart, Math.min(nextStart + visibleCount - 1, index)));
  };
  const reset = () => { setCount(null); setPanOffset(null); setActive(null); };
  const wholePeriod = `${dateLabel(firstOverall.timestamp, data.range, true)} ~ ${dateLabel(lastOverall.timestamp, data.range, true)}`;
  const currentPeriod = `${dateLabel(firstVisible.timestamp, data.range, true)} ~ ${dateLabel(lastVisible.timestamp, data.range, true)}`;
  const summary = `${label ?? `${rangeLabels[data.range]} 요청 · ${points.length}개 가격 관측`} · 전체 관측 ${wholePeriod}. 현재 구간 ${currentPeriod}, ${visibleCount}개 관측. 현재 구간 최고 ${won(high)}, 최저 ${won(low)}.`;
  const bucket = selected.bucket;
  const bucketSummary = bucket ? ` · 버킷 ${dateLabel(selected.timestamp, "1D", true)}${bucket.end === selected.timestamp ? " 장마감 단일 관측" : ` ~ ${dateLabel(bucket.end, "1D")} 미만`} · 원본 ${bucket.observed}/${bucket.expected}분 확인${bucket.observed < bucket.expected ? " (불완전 봉 · 누락/진행 여부 미확인)" : ""} · 실제 관측 ${dateLabel(bucket.first, "1D")} ~ ${dateLabel(bucket.last, "1D")}` : "";
  const selectedSummary = `${dateLabel(selected.timestamp, data.range, true)} · ${mode === "candle" || data.range !== "1D" ? "종가" : "가격"} ${won(selected.close)} · ${basisLabel} 대비 ${signed(percent(selected.close, basis))}${mode === "candle" ? ` · 시가 ${won(selected.open)} · 고가 ${won(selected.high)} · 저가 ${won(selected.low)} · 거래량 ${selected.volume === null ? "— (전체 확인 불가)" : selected.volume.toLocaleString("ko-KR")}${bucketSummary}` : ""}`;
  const candleWidth = Math.min(14, slotWidth * .65);
  const visibleSegments = view.segments.map(segment => segment.filter(point => point.timestamp >= firstVisible.timestamp && point.timestamp <= lastVisible.timestamp)).filter(segment => segment.length);
  const overviewX = (timestamp: number) => left + (timestamp - firstOverall.timestamp) / Math.max(1, lastOverall.timestamp - firstOverall.timestamp) * availableWidth;
  const overviewLow = Math.min(...points.map(point => point.low)), overviewHigh = Math.max(...points.map(point => point.high));
  const overviewY = (price: number) => 32 - (price - overviewLow) / Math.max(1, overviewHigh - overviewLow) * 24;

  return <div className="price-chart" ref={container} data-chart-range={data.range} data-chart-code={data.code} data-chart-mode={mode} data-visible-count={visibleCount} data-visible-start={currentStart}>
    <p className="price-chart-heading">마지막 관측 <strong>{won(lastOverall.close)}</strong> <span data-price-direction={direction} style={{ color }}>{symbol} {signed(change)}</span><span className="price-chart-muted"> · {basisLabel} {won(basis)} 대비</span></p>
    <p className="price-chart-muted" data-chart-period>조회기간 {rangeLabels[data.range]} · 전체 관측 {wholePeriod} · {points.length}개{mode === "candle" ? data.range === "1D" ? ` · 봉 간격 ${intervalMinutes}분 (한국시간, 버킷 시작 시각)` : " · 원본 봉" : ""}</p>
    {mode === "candle" && <>
      <svg className="price-chart-overview" viewBox={`0 0 ${w} 40`} role="img" aria-label={`전체 관측 기간 개요 ${wholePeriod} · ${points.length}개 봉 · 음영은 현재 구간`}>
        {points.map(point => <line key={point.time} x1={overviewX(point.timestamp)} x2={overviewX(point.timestamp)} y1={overviewY(point.low)} y2={overviewY(point.high)} stroke="var(--ds-fg-2)" />)}
        <rect x={overviewX(firstVisible.timestamp)} y="2" width={Math.max(2, overviewX(lastVisible.timestamp) - overviewX(firstVisible.timestamp))} height="36" fill="var(--ds-fg-2)" fillOpacity=".15" stroke="var(--ds-fg-2)" />
      </svg>
      <p className="price-chart-muted">관측 봉 순서로 표시 · 없는 봉은 생성하지 않습니다. {data.range === "1D" && "분 누락 시 확인된 OHLC만 표시하며 거래량 합계는 제공하지 않습니다."}</p>
    </>}
    <p className="price-chart-muted" data-chart-viewport>{isSlice ? "현재 확대 구간" : "전체 관측 표시"} · {currentPeriod} · {visibleCount}/{points.length}개</p>
    {!compact && (points.length > 5 || data.range === "1D") && <div className="price-chart-nav" role="toolbar" aria-label="차트 확대·축소 및 이동">
      <div className="price-chart-zoom-group">
        <button type="button" aria-label="차트 확대" disabled={visibleCount <= minimumCount} onClick={() => zoom(Math.floor(visibleCount / 1.5))}><ZoomIn size={16} aria-hidden="true" /><span>확대</span></button>
        <button type="button" aria-label="차트 축소" disabled={visibleCount >= maximumCount} onClick={() => zoom(Math.ceil(visibleCount * 1.5))}><ZoomOut size={16} aria-hidden="true" /><span>축소</span></button>
      </div>
      <div className="price-chart-pan-group">
        <button type="button" aria-label="이전 구간 이동" disabled={currentStart === 0} onClick={() => pan(-1)}><ArrowLeft size={16} aria-hidden="true" /><span>이전 구간</span></button>
        <button type="button" aria-label="다음 구간 이동" disabled={currentEnd === points.length} onClick={() => pan(1)}><ArrowRight size={16} aria-hidden="true" /><span>다음 구간</span></button>
      </div>
      <button type="button" aria-label="차트 초기화" onClick={reset}><RotateCcw size={16} aria-hidden="true" /><span>초기화</span></button>
    </div>}
    <div className="price-chart-interactive" tabIndex={0} role="group" aria-label="가격 탐색 · 좌우 화살표로 관측 이동, Home·End로 처음·마지막 관측" onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!["ArrowRight", "ArrowLeft", "Home", "End", ...(!compact ? ["ArrowUp", "ArrowDown", "PageUp", "PageDown"] : [])].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") select(0); else if (event.key === "End") select(points.length - 1);
      else if (event.key === "ArrowRight") select(index + 1); else if (event.key === "ArrowLeft") select(index - 1);
      else if (event.key === "ArrowUp") zoom(Math.floor(visibleCount / 1.5)); else if (event.key === "ArrowDown") zoom(Math.ceil(visibleCount * 1.5));
      else pan(event.key === "PageUp" ? -1 : 1);
    }}>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={summary} data-chart-code={data.code} data-chart-range={data.range} onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect(); if (!bounds.width) return;
        const position = (event.clientX - bounds.left) / bounds.width * w;
        let best = currentStart;
        visiblePoints.forEach((point, i) => { if (Math.abs(x(point.timestamp) - position) < Math.abs(x(points[best].timestamp) - position)) best = currentStart + i; });
        setActive(best);
      }}>
        {ticks.map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--ds-line)" /><text x={left - 9} y={y(value) + 4} textAnchor="end">{won(value)}</text></g>)}
        {xTicks.map((time, i) => <g key={time}><line x1={x(time)} x2={x(time)} y1={yBottom} y2={yBottom + 5} stroke="var(--ds-fg-2)" /><text x={x(time)} y={yBottom + 23} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{dateLabel(time, data.range)}</text></g>)}
        {basis >= bottom && basis <= top && <line x1={left} x2={right} y1={y(basis)} y2={y(basis)} stroke="var(--ds-fg-2)" strokeDasharray="5 4" data-price-baseline="start" />}
        {mode === "area" ? visibleSegments.map((segment, i) => <g key={i} data-chart-segment><path d={segment.map((point, j) => `${j ? "L" : "M"}${x(point.timestamp)},${y(point.price)}`).join(" ")} stroke={color} strokeWidth="2" fill="none" />{segment.length === 1 && <circle cx={x(segment[0].timestamp)} cy={y(segment[0].price)} r="3" fill={color} />}</g>)
          : visiblePoints.map(point => { const candleColor = point.close > point.open ? "var(--ds-rise)" : point.close < point.open ? "var(--ds-fall)" : "var(--ds-fg-2)"; return <g key={point.time} fill={candleColor} stroke={candleColor} data-candle><line x1={x(point.timestamp)} x2={x(point.timestamp)} y1={y(point.low)} y2={y(point.high)} /><rect x={x(point.timestamp) - candleWidth / 2} y={y(Math.max(point.open, point.close))} width={candleWidth} height={Math.max(1, Math.abs(y(point.open) - y(point.close)))} /></g>; })}
        {[{ point: highPoint, price: high, name: high === low ? "최고·최저" : "최고", offset: -12 }, ...(high === low ? [] : [{ point: lowPoint, price: low, name: "최저", offset: 20 }])].map(mark => <g key={mark.name}><circle cx={x(mark.point.timestamp)} cy={y(mark.price)} r="3" fill="var(--ds-fg)" /><text className="price-chart-extreme" x={Math.max(left + 48, Math.min(right - 48, x(mark.point.timestamp)))} y={Math.max(15, Math.min(yBottom + 14, y(mark.price) + mark.offset))} textAnchor="middle">{mark.name} {won(mark.price)}</text></g>)}
        <line x1={x(selected.timestamp)} x2={x(selected.timestamp)} y1={yTop} y2={yBottom} stroke="var(--ds-fg-2)" strokeDasharray="3 3" data-price-crosshair />
        <line x1={left} x2={right} y1={y(selected.close)} y2={y(selected.close)} stroke="var(--ds-fg-2)" strokeDasharray="3 3" />
        <circle cx={x(selected.timestamp)} cy={y(selected.close)} r="4" fill="var(--ds-fg)" />
        {showLastPriceConnector && <line x1={x(lastVisible.timestamp)} x2={right + 5} y1={y(lastVisible.close)} y2={y(lastVisible.close)} stroke={visibleColor} data-price-last-connector />}
        <text x={right + 8} y={y(lastVisible.close) + 4} fill={visibleColor} data-price-last-label>{visibleSymbol} {won(lastVisible.close)}</text>
      </svg>
    </div>
    <div className="price-chart-explore"><button type="button" aria-label="이전 가격 관측" disabled={index === 0} onClick={() => select(index - 1)}><ChevronLeft size={16} aria-hidden="true" /></button><p role="status" aria-live="polite" data-price-tooltip>{selectedSummary}</p><button type="button" aria-label="다음 가격 관측" disabled={index === points.length - 1} onClick={() => select(index + 1)}><ChevronRight size={16} aria-hidden="true" /></button></div>
    {(view.rejectedPrices > 0 || view.rejectedCandles > 0) && <p className="price-chart-muted">잘못된 시각·가격은 제외하며 결측 구간은 선으로 잇지 않습니다.</p>}
  </div>;
}
