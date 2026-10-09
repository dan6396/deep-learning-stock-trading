import { useQuery } from "@tanstack/react-query";
import { queries } from "../../shared/api/queries";
import { formatDate } from "../../shared/lib/format";
import { validatedChart } from "../stock/reportData";
import { SourceMeta } from "./SourceMeta";

export function BriefingChart({ code }: { code: string }) {
  const chart = useQuery({ ...queries.chart(code, "1M"), retry: false, staleTime: 30_000 });
  const data = chart.data?.data, view = data && validatedChart(data), allowed = chart.data?.source === "live" || chart.data?.source === "cache";
  const points = view?.prices ?? [], first = points[0], last = points[points.length - 1];
  const values = points.map(point => point.price), low = Math.min(...values), high = Math.max(...values), span = Math.max(high - low, high * .01, 1);
  const x = (time: number) => 8 + (time - first.timestamp) / Math.max(last.timestamp - first.timestamp, 1) * 304;
  const y = (price: number) => 112 - (price - low) / span * 98;
  return <section className="briefing-mini-chart" aria-label="가격 이력 · 표시된 관측 기간 기준" data-chart-error={chart.isError ? chart.error.message : undefined}><div className="briefing-detail-section-heading"><h3>가격 이력</h3><small>{first && last ? `${formatDate(first.date)} – ${formatDate(last.date)}` : "관측 범위 미확인"}</small></div>
    {chart.isPending ? <p role="status">가격 이력 조회 중</p> : chart.isError ? <p role="status">가격 이력 조회 실패 · —</p> : !allowed ? <p>{chart.data?.source === "sample" ? "예시 가격 이력 · 실제 관측 차트 미제공" : "가격 이력 출처 미확인"}</p> : !points.length ? <p>유효한 원본 관측 없음</p> : <svg viewBox="0 0 320 124" role="img" aria-label={`최근 1개월 요청 · ${points.length}개 ${data?.interpolated ? "보간 가격점" : "가격 관측"} · 원본 결측 구간은 연결하지 않음`} data-chart-code={code} data-chart-range="1M">
      {[35, 72, 109].map(value => <line key={value} x1="8" x2="312" y1={value} y2={value} stroke="var(--ds-line)" />)}
      {view!.segments.map((segment, index) => <g key={index} data-chart-segment><path d={segment.map((point, i) => `${i ? "L" : "M"}${x(point.timestamp)},${y(point.price)}`).join(" ")} fill="none" stroke="var(--ds-link)" strokeWidth="2" />{segment.length === 1 && <circle cx={x(segment[0].timestamp)} cy={y(segment[0].price)} r="3" fill="var(--ds-link)" />}</g>)}
    </svg>}
    {chart.data && <SourceMeta source={chart.data.source} asOf={chart.data.asOf} label="조회/저장" />}
    <div className="briefing-chart-footnote"><small>{data?.interpolated ? "보간값" : "원본 관측"} · 결측 미연결</small><details><summary>기간·출처 기준</summary><p>1M 요청 · {data?.coverage?.sourceRange ? `${data.coverage.sourceRange} 원본에서 제공` : "원본 범위 미확인"} · {data?.coverage?.status === "partial" ? "기간 일부 제공" : "전체 기간 제공 여부 미확인"}. 원본 관측 없는 구간은 연결하지 않습니다.{data?.interpolated ? " 보간값이며 실제 관측 이력이 아닙니다." : ""}</p></details></div>
  </section>;
}
