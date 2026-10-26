import { useQuery } from "@tanstack/react-query";
import { queries } from "../../shared/api/queries";
import { formatDate } from "../../shared/lib/format";
import { validatedChart } from "../stock/reportData";
import { PriceChart } from "../stock/PriceChart";
import { SourceMeta } from "./SourceMeta";
import { PastObservationTag } from "./PastObservationTag";

export function BriefingChart({ code }: { code: string }) {
  const chart = useQuery({ ...queries.chart(code, "1M"), retry: false, staleTime: 30_000 });
  const data = chart.data?.data, view = data && validatedChart(data), allowed = chart.data?.source === "live" || chart.data?.source === "cache";
  const points = view?.prices ?? [], first = points[0], last = points[points.length - 1];
  const sourceRange = data?.coverage?.sourceRange;
  const sourceRangeLabel = sourceRange && ({ "1D": "1일", "1M": "1개월", "3M": "3개월", "1Y": "1년", "3Y": "3년", "5Y": "5년" } as const)[sourceRange];
  return <section className="briefing-mini-chart" aria-label="가격 이력 · 표시된 관측 기간 기준" data-chart-error={chart.isError ? chart.error.message : undefined}><div className="briefing-detail-section-heading"><h3>가격 이력</h3>{first && last && <small>{formatDate(first.date)} – {formatDate(last.date)}</small>}</div>
    {chart.isPending ? <p role="status">가격 이력을 수집하고 있습니다. 처음 조회할 때는 수 분 걸릴 수 있습니다.</p> : chart.isError ? <p role="status">가격 이력 조회 실패 · —</p> : !allowed ? <p>{chart.data?.source === "sample" ? "예시 가격 이력 · 실제 관측 차트 미제공" : "가격 이력 출처 미확인"}</p> : !points.length ? <p>유효한 원본 관측 없음</p> : <PriceChart data={data!} label={`최근 1개월 요청 · ${points.length}개 ${data?.interpolated ? "보간 가격점" : "가격 관측"} · 원본 결측 구간은 연결하지 않음`} />}
    {chart.data && <details className="briefing-chart-footnote"><summary>데이터 출처·기간</summary><SourceMeta source={chart.data.source} asOf={chart.data.asOf} label="확인 시각" /><p>표시된 관측 범위의 가격입니다.{sourceRangeLabel && ` 원본 조회 범위 ${sourceRangeLabel}.`} 가격이 없는 구간은 선으로 잇지 않습니다.{data?.coverage?.status === "partial" ? " 요청 기간의 일부만 제공됩니다." : ""}{data?.interpolated ? " 보간값이며 실제 관측 이력이 아닙니다." : ""}</p></details>}
    <PastObservationTag asOf={chart.data?.asOf} />
  </section>;
}
