import { useQuery } from "@tanstack/react-query";
import { queries } from "../../shared/api/queries";
import { validatedChart } from "../stock/reportData";
import { formatPercent } from "../../shared/lib/format";
import type { ChartData } from "../../entities/market";
import type { DataResult } from "../../entities/source";
import { Sparkline } from "../../shared/ui/Sparkline";

export interface SparklineQueryLike {
  data?: DataResult<ChartData> | null;
  isPending?: boolean;
  isError?: boolean;
}

export function TopFiveSparkline({
  code,
  enabled = true,
  query,
}: {
  code: string;
  enabled?: boolean;
  query?: SparklineQueryLike;
}) {
  const fallbackChart = useQuery({
    ...queries.chart(code, "1M"),
    enabled: query ? false : enabled,
    retry: false,
    staleTime: 30_000,
  });
  const chart = query ?? fallbackChart;

  if (chart.isError) {
    return null;
  }

  // 비활성화 대기 상태이거나 로딩 중일 때는 레이아웃 밀림 방지 자리표시자 유지
  if (!enabled || chart.isPending) {
    return <div className="briefing-sparkline-placeholder" aria-hidden="true" />;
  }

  const allowed = chart.data?.source === "live" || chart.data?.source === "cache";
  if (!allowed || !chart.data?.data) {
    return null;
  }

  const view = validatedChart(chart.data.data);
  if (!view || view.prices.length < 2) {
    return null;
  }

  const firstPrice = view.prices[0].price;
  const lastPrice = view.prices[view.prices.length - 1].price;
  const changeRate = firstPrice !== 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const roundedChange = Number(changeRate.toFixed(1));

  // 반올림한 표시값 기준 등락 방향 (0.0%는 보합 처리)
  const trendDir =
    Object.is(roundedChange, 0) || Object.is(roundedChange, -0)
      ? "flat"
      : roundedChange > 0
      ? "rise"
      : "fall";

  const strokeColor =
    trendDir === "rise"
      ? "var(--ds-rise)"
      : trendDir === "fall"
      ? "var(--ds-fall)"
      : "var(--ds-subtle)";

  // 보간/대체 데이터 여부 라벨 반영
  const isInterpolated = Boolean(
    chart.data?.data?.interpolated || chart.data?.data?.coverage?.method === "fallback"
  );
  const note = isInterpolated ? " (보간 데이터)" : "";
  const changeRateLabel = formatPercent(roundedChange, "percent", 1);

  return (
    <div
      className="briefing-sparkline-wrap"
      title={`최근 1개월 종가 추세${note}: 시작 대비 ${changeRateLabel}`}
    >
      <div className="briefing-sparkline-meta" aria-hidden="true">
        <span className="briefing-sparkline-label">1개월</span>
        <span className={`briefing-sparkline-change is-${trendDir}`}>{changeRateLabel}</span>
      </div>
      <Sparkline
        className={`briefing-sparkline is-${trendDir}`}
        segments={view.segments}
        color={strokeColor}
        label={`최근 1개월 종가 추세${note}, 시작 대비 ${changeRateLabel}`}
      />
    </div>
  );
}
