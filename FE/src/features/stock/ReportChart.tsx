import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { queries, queryKeys } from "../../shared/api/queries";
import { TIME_RANGES, type ChartMode, type TimeRange } from "../../types/stockChart";
import { formatDate, formatWon } from "../../shared/lib/format";
import { SourceMeta } from "../briefing/SourceMeta";
import { validatedChart } from "./reportData";
import type { ChartData } from "../../entities/market";

const labels: Record<TimeRange, string> = { "1D": "1일", "1M": "1개월", "3M": "3개월", "1Y": "1년", "3Y": "3년", "5Y": "5년" };

function PricePlot({ data, mode }: { data: ChartData; mode: ChartMode }) {
  const view = validatedChart(data), [active, setActive] = useState(0);
  const points = mode === "area" ? view.prices.map(point => ({ ...point, low: point.price, high: point.price, close: point.price, time: point.date })) : view.candles;
  if (!points.length) return <p className="report-empty">{mode === "candle" ? "원본 시각·시가·고가·저가·종가를 확인할 수 없어 캔들 차트를 제공하지 않습니다. 가격 선에서 확인하세요." : "유효한 관측 시각과 가격이 없습니다."}</p>;
  const first = points[0], last = points[points.length - 1], selected = points[Math.min(active, points.length - 1)];
  const values = points.flatMap(point => [point.low, point.high]), min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max((max - min) * .12, max * .01, 1), bottom = min - pad, top = max + pad;
  const toX = (time: number) => 20 + (time - first.timestamp) / Math.max(last.timestamp - first.timestamp, 1) * 720;
  const toY = (price: number) => 225 - (price - bottom) / (top - bottom) * 205;
  const summary = `${labels[data.range]} 요청 · ${mode === "area" ? data.range === "1D" ? "가격선" : "종가 선" : "캔들"}. ${points.length}개 원본 관측. ${formatDate(first.time, first.time.includes("T"))} ${formatWon(first.close)}부터 ${formatDate(last.time, last.time.includes("T"))} ${formatWon(last.close)}까지. 최고 ${formatWon(max)}, 최저 ${formatWon(min)}.`;
  return <div className="report-plot" data-chart-range={data.range} data-chart-code={data.code} data-chart-mode={mode}>
    <svg viewBox="0 0 760 260" role="img" aria-label={summary}>
      {[.25, .5, .75].map(ratio => <line key={ratio} x1="20" x2="740" y1={20 + ratio * 205} y2={20 + ratio * 205} stroke="var(--ds-line)" />)}
      {mode === "area" ? view.segments.map((segment, i) => <g key={i}><path d={segment.map((point, j) => `${j ? "L" : "M"}${toX(point.timestamp)},${toY(point.price)}`).join(" ")} fill="none" stroke="var(--ds-fg-2)" strokeWidth="2.5" />{segment.length === 1 && <circle cx={toX(segment[0].timestamp)} cy={toY(segment[0].price)} r="3" fill="var(--ds-fg-2)" />}</g>)
        : view.candles.map(point => { const x = toX(point.timestamp), y = toY(Math.max(point.open, point.close)), color = point.close > point.open ? "var(--ds-rise)" : point.close < point.open ? "var(--ds-fall)" : "var(--ds-fg-2)";
          return <g key={point.time} fill={color} stroke={color}><line x1={x} x2={x} y1={toY(point.high)} y2={toY(point.low)} /><rect x={x - 3} y={y} width="6" height={Math.max(1, Math.abs(toY(point.open) - toY(point.close)))} /></g>; })}
      <circle cx={toX(selected.timestamp)} cy={toY(selected.close)} r="4" fill="var(--ds-fg)" />
    </svg>
    <p className="report-chart-summary">{summary}</p>
    <div className="report-chart-explore" onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setActive(index => Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <button className="report-icon-button" onClick={() => setActive(index => Math.max(0, index - 1))} disabled={active === 0} aria-label="이전 가격 관측"><ChevronLeft aria-hidden="true" size={16} /></button>
      <p aria-live="polite">{formatDate(selected.time, selected.time.includes("T"))} · {data.range === "1D" ? "가격" : "종가"} {formatWon(selected.close)}{mode === "candle" && "open" in selected ? ` · 시가 ${formatWon(selected.open)} · 고가 ${formatWon(selected.high)} · 저가 ${formatWon(selected.low)} · 거래량 ${selected.volume === null ? "—" : selected.volume.toLocaleString("ko-KR")}` : ""}</p>
      <button className="report-icon-button" onClick={() => setActive(index => Math.min(points.length - 1, index + 1))} disabled={active === points.length - 1} aria-label="다음 가격 관측"><ChevronRight aria-hidden="true" size={16} /></button>
    </div>
    {(view.rejectedPrices > 0 || view.rejectedCandles > 0) && <p className="report-muted">결측·잘못된 시각/가격 또는 원본 OHLC 미확인: 종가 {view.rejectedPrices}개, 캔들 {view.rejectedCandles}개 제외. 결측을 보간하지 않습니다.</p>}
  </div>;
}

function CoverageNote({ data }: { data: ChartData }) {
  const view = validatedChart(data), times = [...view.prices.map(point => point.date), ...view.candles.map(point => point.time)].sort();
  const first = times[0], last = times[times.length - 1];
  if (!first || !last) return null;
  const coverage = data.coverage;
  return <p className="report-muted" data-chart-coverage={coverage?.status ?? "unverified"}>
    요청 {labels[data.range]} · 실제 제공 관측 범위 {formatDate(first, first.includes("T"))} ~ {formatDate(last, last.includes("T"))}.
    {coverage?.method === "fallback" && coverage.sourceRange && ` ${labels[coverage.sourceRange]} 조회 원본을 대신 사용했습니다.`}
    {coverage?.method === "subset" && coverage.sourceRange && ` ${labels[coverage.sourceRange]} 조회 원본에서 요청 범위를 추렸습니다.`}
    {coverage?.status === "partial" ? " 요청 기간의 일부만 제공되었습니다. 전체 기간 이력이 아닙니다." : " 요청 기간 전체의 관측 제공 여부는 미확인입니다."}
  </p>;
}

export function ReportChart({ code }: { code: string }) {
  const [range, setRange] = useState<TimeRange>("1D"), [mode, setMode] = useState<ChartMode>("area");
  const chart = useQuery(queries.chart(code, range)), client = useQueryClient();
  const allowed = chart.data?.source === "live" || chart.data?.source === "cache";
  async function refresh() { await client.cancelQueries({ queryKey: queryKeys.chart(code, range), exact: true }); await client.refetchQueries({ queryKey: queryKeys.chart(code, range), exact: true }); }
  return <section className="report-card report-chart" aria-labelledby="report-chart-title">
    <div className="report-section-heading"><div><p className="report-eyebrow">PRICE OBSERVATIONS</p><h2 id="report-chart-title">가격 이력</h2></div><button className="report-icon-button" onClick={() => void refresh()} aria-label="가격 이력 다시 조회"><RefreshCw aria-hidden="true" size={16} /></button></div>
    <div className="report-chart-controls"><div role="group" aria-label="가격 이력 기간">{TIME_RANGES.map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{labels[value]}</button>)}</div><div role="group" aria-label="차트 표시 방식"><button aria-pressed={mode === "area"} onClick={() => setMode("area")}>{range === "1D" ? "가격선" : "종가 선"}</button><button aria-pressed={mode === "candle"} onClick={() => setMode("candle")}>캔들</button></div></div>
    {chart.data && <SourceMeta source={chart.data.source} asOf={chart.data.asOf} label="조회/저장 시각" />}
    {chart.data && allowed && <CoverageNote data={chart.data.data} />}
    {chart.isError && <p className="report-notice" role="status">{chart.data ? "이전 조회 결과 · 가격 이력 갱신 실패" : chart.error.message.includes("코드") ? "종목 코드가 일치하지 않아 가격 이력을 표시하지 않습니다." : "가격 이력 조회 실패"}</p>}
    {chart.isPending ? <p className="report-empty" role="status">선택한 기간의 가격 이력을 조회하고 있습니다.</p>
      : chart.data && !allowed ? <p className="report-empty">{chart.data.source === "sample" ? "예시 데이터이므로 실제 가격 이력 차트를 제공하지 않습니다." : "가격 이력 출처 미확인으로 차트를 제공하지 않습니다."}</p>
        : chart.data && allowed ? <PricePlot key={`${range}-${mode}`} data={chart.data.data} mode={mode} /> : null}
    <p className="report-muted report-footnote">각 점은 제공된 관측 시각의 가격입니다. 가격 이력은 모델의 실현 성과가 아닙니다. 실제 제공 관측 범위와 부분 제공 안내를 확인하세요. 원본 관측이 없는 구간은 연결하지 않습니다.</p>
  </section>;
}
