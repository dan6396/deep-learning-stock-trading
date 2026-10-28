import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { queries, queryKeys } from "../../shared/api/queries";
import { TIME_RANGES, type ChartMode, type TimeRange } from "../../types/stockChart";
import { formatDate } from "../../shared/lib/format";
import { SourceMeta } from "../briefing/SourceMeta";
import { PastObservationTag } from "../briefing/PastObservationTag";
import { PriceChart } from "./PriceChart";
import { validatedChart } from "./reportData";
import type { ChartData } from "../../entities/market";

const labels: Record<TimeRange, string> = { "1D": "1일", "1M": "1개월", "3M": "3개월", "1Y": "1년", "3Y": "3년", "5Y": "5년" };
const intervals = ["1m", "5m", "15m", "30m"] as const;
export type BarInterval = typeof intervals[number];
const intervalLabels: Record<BarInterval, string> = { "1m": "1분", "5m": "5분", "15m": "15분", "30m": "30분" };

function CoverageNote({ data }: { data: ChartData }) {
  const view = validatedChart(data), times = [...view.prices.map(point => point.date), ...view.candles.map(point => point.time)].sort();
  const first = times[0], last = times[times.length - 1];
  if (!first || !last) return null;
  const coverage = data.coverage;
  return <p className="report-muted" data-chart-coverage={coverage?.status ?? "unverified"}>
    요청 {labels[data.range]} · 실제 제공 관측 범위 {formatDate(first, first.includes("T"))} ~ {formatDate(last, last.includes("T"))}.
    {coverage?.method === "fallback" && coverage.sourceRange && ` ${labels[coverage.sourceRange]} 조회 원본을 대신 사용했습니다.`}
    {coverage?.method === "subset" && coverage.sourceRange && ` ${labels[coverage.sourceRange]} 조회 원본에서 요청 범위를 추렸습니다.`}
    {coverage?.status === "partial" ? " 요청 기간의 일부만 제공되었습니다. 전체 기간 이력이 아닙니다." : " 표시된 관측 범위를 기준으로 읽어 주세요."}
  </p>;
}

export function ReportChart({ code }: { code: string }) {
  const [range, setRange] = useState<TimeRange>("1D");
  const [mode, setMode] = useState<ChartMode>("area");
  const [interval, setInterval] = useState<BarInterval>("5m");
  const chart = useQuery(queries.chart(code, range)), client = useQueryClient();
  const allowed = chart.data?.source === "live" || chart.data?.source === "cache";
  async function refresh() { await client.cancelQueries({ queryKey: queryKeys.chart(code, range), exact: true }); await client.refetchQueries({ queryKey: queryKeys.chart(code, range), exact: true }); }
  return <div className="report-chart" role="group" aria-label="가격 이력">
    <div className="report-chart-controls">
      <div role="group" aria-label="가격 이력 기간">
        {TIME_RANGES.map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => { setRange(value); if (value === "1D") setInterval("5m"); }}>{labels[value]}</button>)}
      </div>
      {range === "1D" && mode === "candle" && (
        <div role="group" aria-label="봉 간격">
          {intervals.map(value => (
            <button key={value} type="button" aria-pressed={interval === value} onClick={() => setInterval(value)}>
              {intervalLabels[value]}
            </button>
          ))}
        </div>
      )}
      <div role="group" aria-label="차트 표시 방식">
        <button aria-pressed={mode === "area"} onClick={() => setMode("area")}>{range === "1D" ? "가격선" : "종가 선"}</button>
        <button aria-pressed={mode === "candle"} onClick={() => setMode("candle")}>캔들</button>
      </div>
      <button className="report-icon-button" onClick={() => void refresh()} aria-label="가격 이력 다시 조회"><RefreshCw aria-hidden="true" size={16} /></button>
    </div>
    {chart.isFetching && chart.data && <small className="report-muted" role="status">가격 이력 갱신 중</small>}
    {chart.isError && <p className="report-notice" role="status">{chart.data ? "이전 조회 결과 · 가격 이력 갱신 실패" : chart.error.message.includes("코드") ? "종목 코드가 일치하지 않아 가격 이력을 표시하지 않습니다." : "가격 이력 조회 실패"}</p>}
    {chart.isPending ? <p className="report-empty" role="status">선택한 기간의 가격 이력을 조회하고 있습니다.</p>
      : chart.data && !allowed ? <p className="report-empty">{chart.data.source === "sample" ? "예시 데이터이므로 실제 가격 이력 차트를 제공하지 않습니다." : "가격 이력 출처 미확인으로 차트를 제공하지 않습니다."}</p>
        : chart.data && allowed ? <PriceChart key={`${code}-${range}-${mode}-${interval}`} data={chart.data.data} mode={mode} interval={interval} /> : null}
    {chart.data && <details className="report-muted report-footnote"><summary>데이터 출처·기간</summary><SourceMeta source={chart.data.source} asOf={chart.data.asOf} label="확인 시각" />{allowed && <CoverageNote data={chart.data.data} />}<p>각 점은 제공된 관측 시각의 가격입니다. 가격이 없는 구간은 선으로 잇지 않습니다.</p></details>}
    <PastObservationTag asOf={chart.data?.asOf} />
  </div>;
}
