import { useQuery } from "@tanstack/react-query";
import { queries } from "../../shared/api/queries";
import { validatedChart } from "../stock/reportData";
import { formatPercent } from "../../shared/lib/format";
import type { ChartData } from "../../entities/market";
import type { DataResult } from "../../entities/source";

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

  const width = 120;
  const height = 32;
  const paddingY = 3;

  const minPrice = Math.min(...view.prices.map(p => p.price));
  const maxPrice = Math.max(...view.prices.map(p => p.price));
  const priceRange = maxPrice - minPrice || 1;

  const minTime = view.prices[0].timestamp;
  const maxTime = view.prices[view.prices.length - 1].timestamp;
  const timeRange = maxTime - minTime || 1;

  // 결측 구간은 잇지 않고 세그먼트별로 분리하여 path 생성
  const segmentPaths = view.segments
    .filter(seg => seg.length > 0)
    .map(seg => {
      const coords = seg.map(pt => {
        const x = Number((((pt.timestamp - minTime) / timeRange) * width).toFixed(1));
        const y = Number(
          (paddingY + (1 - (pt.price - minPrice) / priceRange) * (height - paddingY * 2)).toFixed(1)
        );
        return `${x},${y}`;
      });
      return seg.length === 1 ? `M ${coords[0]} L ${coords[0]}` : `M ${coords.join(" L ")}`;
    });

  const pathD = segmentPaths.join(" ");

  return (
    <div
      className="briefing-sparkline-wrap"
      title={`최근 1개월 종가 추세${note}: 시작 대비 ${changeRateLabel}`}
    >
      <svg
        className={`briefing-sparkline is-${trendDir}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`최근 1개월 종가 추세${note}, 시작 대비 ${changeRateLabel}`}
      >
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
