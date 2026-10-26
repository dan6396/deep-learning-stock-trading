import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopFiveSparkline } from "./TopFiveSparkline";
import { chartBundle } from "../../test/fixtures/reportFixtures";
import { jsonResponse } from "../../test/dataFixtures";

afterEach(() => vi.unstubAllGlobals());

function setChartPrices(
  bundle: ReturnType<typeof chartBundle>,
  prices: (number | null)[],
  dates: string[] = ["2026-09-25", "2026-10-10", "2026-10-25"]
) {
  const candles = prices.map((price, i) => {
    const p = price ?? 1000;
    return {
      time: dates[i],
      rawTime: dates[i],
      open: p,
      high: p + 100,
      low: p - 100,
      close: p,
      volume: 1000,
      rawValues: { open: p, high: p + 100, low: p - 100, close: p, volume: 1000 },
    };
  });
  bundle.chartData.ranges["1M"] = {
    prices: prices.map((price, i) => ({
      date: dates[i],
      rawDate: dates[i],
      price: price ?? (null as unknown as number),
    })),
    candles,
  };
}

describe("TopFiveSparkline", () => {
  it("renders placeholder while query is pending", () => {
    const client = new QueryClient();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})));
    const { container } = render(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );
    expect(container.querySelector(".briefing-sparkline-placeholder")).not.toBeNull();
    expect(screen.queryByText(/조회 중/)).toBeNull();
    client.clear();
  });

  it("removes placeholder and renders nothing on query error", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("Network Error")));
    const { container } = render(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );

    // 에러 발생 전에는 placeholder 존재
    expect(container.querySelector(".briefing-sparkline-placeholder")).not.toBeNull();

    // 에러 발생 후에는 placeholder와 sparkline 모두 사라져 아무것도 남지 않음
    await vi.waitFor(() => {
      expect(container.querySelector(".briefing-sparkline-placeholder")).toBeNull();
      expect(container.querySelector(".briefing-sparkline")).toBeNull();
    });
    expect(screen.queryByText(/조회 중/)).toBeNull();
    client.clear();
  });

  it("renders nothing when source is sample or prices length < 2", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // 1) source: sample
    const sample = chartBundle("005930", "sample");
    setChartPrices(sample, [50000, 52000, 55000]);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(sample)));
    const { container, rerender } = render(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );

    await vi.waitFor(() => {
      expect(container.querySelector(".briefing-sparkline")).toBeNull();
      expect(container.querySelector(".briefing-sparkline-placeholder")).toBeNull();
    });

    // 2) prices length < 2
    const singlePoint = chartBundle("005930", "live");
    setChartPrices(singlePoint, [50000], ["2026-10-25"]);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(singlePoint)));
    client.clear();

    rerender(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );
    await vi.waitFor(() => {
      expect(container.querySelector(".briefing-sparkline")).toBeNull();
      expect(container.querySelector(".briefing-sparkline-placeholder")).toBeNull();
    });
    client.clear();
  });

  it("renders rising sparkline with correct aria-label and rise color when last price > first price", async () => {
    const client = new QueryClient();
    const bundle = chartBundle("005930", "live");
    setChartPrices(bundle, [50000, 52000, 55000]);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(bundle)));
    render(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );

    const svg = await screen.findByRole("img", { name: /최근 1개월 종가 추세, 시작 대비 \+10\.0%/ });
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("is-rise");
    const path = svg.querySelector("path");
    expect(path).toHaveAttribute("stroke", "var(--ds-rise)");
    client.clear();
  });

  it("renders falling sparkline with correct aria-label and fall color when last price < first price", async () => {
    const client = new QueryClient();
    const bundle = chartBundle("005930", "cache");
    setChartPrices(bundle, [50000, 48000, 45000]);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(bundle)));
    render(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );

    const svg = await screen.findByRole("img", { name: /최근 1개월 종가 추세, 시작 대비 -10\.0%/ });
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("is-fall");
    const path = svg.querySelector("path");
    expect(path).toHaveAttribute("stroke", "var(--ds-fall)");
    client.clear();
  });

  it("renders flat sparkline with neutral color when change is 0.0%", async () => {
    const client = new QueryClient();
    const bundle = chartBundle("005930", "cache");
    setChartPrices(bundle, [50000, 50100, 50000]); // 시작 대비 0.0%
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(bundle)));
    render(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );

    const svg = await screen.findByRole("img", { name: /최근 1개월 종가 추세, 시작 대비 0\.00%|최근 1개월 종가 추세, 시작 대비 0\.0%/ });
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("is-flat");
    const path = svg.querySelector("path");
    expect(path).toHaveAttribute("stroke", "var(--ds-subtle)");
    client.clear();
  });

  it("draws disconnected segments when missing data occurs and indicates interpolated data in aria-label", async () => {
    const client = new QueryClient();
    const bundle = chartBundle("005930", "cache");
    const dates = ["2026-09-25", "2026-10-05", "2026-10-15", "2026-10-25"];
    // 2번째 포인트(index 1)에 null을 넣어 결측 구간 발생
    setChartPrices(bundle, [50000, null, 53000, 55000], dates);
    Object.assign(bundle.chartData.ranges["1M"], { interpolated: true });

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(bundle)));
    render(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );

    const svg = await screen.findByRole("img", { name: /최근 1개월 종가 추세 \(보간 데이터\)/ });
    expect(svg).toBeInTheDocument();
    const path = svg.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    // 결측 구간을 잇지 않고 2개의 M (MoveTo) 명령어가 포함되어 있는지 확인
    const moveCount = (d.match(/M\s/g) || []).length;
    expect(moveCount).toBeGreaterThanOrEqual(2);
    client.clear();
  });

  it("renders 1-month label and rate of change beside sparkline", async () => {
    const client = new QueryClient();
    const bundle = chartBundle("005930", "live");
    setChartPrices(bundle, [50000, 52000, 55000]);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(bundle)));
    const { container } = render(
      <QueryClientProvider client={client}>
        <TopFiveSparkline code="005930" />
      </QueryClientProvider>
    );

    await screen.findByRole("img", { name: /최근 1개월 종가 추세/ });
    expect(container.querySelector(".briefing-sparkline-label")).toHaveTextContent("1개월");
    expect(container.querySelector(".briefing-sparkline-change")).toHaveTextContent("+10.0%");
    client.clear();
  });
});
