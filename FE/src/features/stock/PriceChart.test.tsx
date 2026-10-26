import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PriceChart, nicePriceTicks } from "./PriceChart";
import { adaptChart, type ChartData } from "../../entities/market";
import { chartBundle } from "../../test/fixtures/reportFixtures";

function observations(count = 180, range: ChartData["range"] = "1D"): ChartData {
  const timestamps = Array.from({ length: count }, (_, i) => range === "1D" ? Date.parse("2026-10-27T09:00:00+09:00") + i * 60_000 : Date.parse("2021-10-01T00:00:00+09:00") + i * 86400_000);
  const candles = timestamps.map((timestamp, i) => ({ time: new Date(timestamp + 9 * 3600_000).toISOString().slice(0, range === "1D" ? 19 : 10), open: 1000 + i, high: 1010 + i, low: 990 + i, close: 1005 + i, volume: 10, rawOhlc: true, rawTimeVerified: true }));
  return { code: "005930", range, candles, prices: candles.map(point => ({ date: point.time, price: point.close, rawTimeVerified: true })) };
}
const mainSvg = () => document.querySelector('svg[data-chart-code]')!;
const viewport = () => document.querySelector('[data-chart-mode]')!;

describe("observed price chart", () => {
  it("creates bounded nice price ticks for flat and varying prices", () => {
    for (const [low, high] of [[100, 100], [56700, 89200], [9, 11], [1230000, 1270000]]) {
      const ticks = nicePriceTicks(low, high); expect(ticks.length).toBeGreaterThanOrEqual(3); expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks[0]).toBeLessThanOrEqual(low); expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(high);
    }
    expect(nicePriceTicks(NaN, 10)).toEqual([]);
  });
  it("labels price/time axes, extrema, baseline and the last value and explores observations by keyboard", () => {
    const data = adaptChart(chartBundle(), "005930", "1D").data;
    data.prices.forEach((point, i) => { point.date = `2026-10-07T${["09:00", "12:00", "15:30"][i]}:00+09:00`; });
    render(<PriceChart data={data} />);
    expect(screen.getByText("09:00")).toBeInTheDocument(); expect(screen.getByText("15:30")).toBeInTheDocument();
    expect(screen.getByText("최고 107원")).toBeInTheDocument(); expect(screen.getByText("최저 105원")).toBeInTheDocument();
    expect(document.querySelector('[data-price-last-label]')).toHaveTextContent("▲ 107원"); expect(document.querySelector('[data-price-direction]')).toHaveAttribute("data-price-direction", "rise");
    expect(document.querySelector('[data-price-baseline]')).toBeInTheDocument();
    const explorer = screen.getByRole("group", { name: /가격 탐색/ }); fireEvent.keyDown(explorer, { key: "Home" });
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("105원 · 전체 관측 첫 가격 대비 0.00%");
    fireEvent.keyDown(explorer, { key: "ArrowRight" }); expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("106원");
    fireEvent.click(screen.getByRole("button", { name: "다음 가격 관측" })); expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("107원");
  });
  it("uses the Korean falling color and symbol for a falling period, in candle mode too", () => {
    const data = adaptChart(chartBundle(), "005930", "1M").data; data.candles.forEach((point, i) => { point.close = 107 - i; });
    render(<PriceChart data={data} mode="candle" />);
    expect(document.querySelector('[data-price-direction]')).toHaveAttribute("data-price-direction", "fall");
    expect(document.querySelector('[data-price-last-label]')).toHaveTextContent("▼ 105원"); expect(mainSvg().querySelector('rect')).toBeInTheDocument();
  });
  it("moves the crosshair to the nearest observation on pointer input", () => {
    render(<PriceChart data={adaptChart(chartBundle(), "005930", "1M").data} />);
    const svg = screen.getByRole("img"); Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, width: 640 }) });
    fireEvent.pointerMove(svg, { clientX: 86 });
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("105원");
  });
  it("guarantees minimum 4px candle width and aggregates 1D minute bars into 5-minute candles", () => {
    // Generate 120 1-minute candles
    const base = Date.parse("2026-10-27T09:00:00+09:00");
    const minuteCandles = Array.from({ length: 120 }, (_, i) => {
      const ts = base + i * 60_000;
      const time = new Date(ts + 9 * 3600_000).toISOString().slice(0, 19);
      return {
        time,
        rawTime: time,
        open: 1000 + i,
        high: 1010 + i,
        low: 990 + i,
        close: 1005 + i,
        volume: 10,
        rawValues: { open: 1000 + i, high: 1010 + i, low: 990 + i, close: 1005 + i, volume: 10 },
      };
    });
    const bundle = {
      source: "cache",
      asOf: "2026-10-27T11:00:00Z",
      chartData: {
        code: "005930",
        symbol: "005930",
        ranges: {
          "1D": {
            prices: minuteCandles.map(c => ({ date: c.time, rawDate: c.rawTime, price: c.close })),
            candles: minuteCandles,
          },
        },
      },
    };
    const data = adaptChart(bundle, "005930", "1D").data;
    render(<PriceChart data={data} mode="candle" />);
    const rects = mainSvg().querySelectorAll("[data-candle] rect");
    expect(rects.length).toBeGreaterThan(0);
    // Every rendered candle rect must have width >= 4px
    for (const rect of rects) {
      const width = parseFloat(rect.getAttribute("width") || "0");
      expect(width).toBeGreaterThanOrEqual(4);
    }
  });
  it("supports zooming and panning with buttons and keyboard shortcuts", () => {
    const data = adaptChart(chartBundle(), "005930", "1D").data;
    render(<PriceChart data={data} />);
    const zoomInBtn = screen.getByRole("button", { name: "차트 확대" });
    const zoomOutBtn = screen.getByRole("button", { name: "차트 축소" });
    expect(zoomInBtn).toBeInTheDocument();
    expect(zoomOutBtn).toBeInTheDocument();

    fireEvent.click(zoomInBtn);
    const explorer = screen.getByRole("group", { name: /가격 탐색/ });
    fireEvent.keyDown(explorer, { key: "ArrowUp" });
    fireEvent.keyDown(explorer, { key: "ArrowDown" });
    fireEvent.keyDown(explorer, { key: "PageUp" });
    fireEvent.keyDown(explorer, { key: "PageDown" });
  });
  it("omits the zoom/pan toolbar in compact mode for side panels", () => {
    const data = adaptChart(chartBundle(), "005930", "1M").data;
    render(<PriceChart data={data} compact />);
    expect(screen.queryByRole("toolbar", { name: "차트 확대·축소 및 이동" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전 가격 관측" })).toBeInTheDocument();
  });

  it("shows the entire long period by default, including compact side panels, and restores it after zoom", () => {
    const data = observations(1200, "5Y");
    const { rerender } = render(<PriceChart data={data} />);
    expect(viewport()).toHaveAttribute("data-visible-count", "1200");
    expect(document.querySelector('[data-chart-viewport]')).toHaveTextContent("전체 관측 표시");
    fireEvent.click(screen.getByRole("button", { name: "차트 확대" }));
    expect(Number(viewport().getAttribute("data-visible-count"))).toBeLessThan(1200);
    fireEvent.click(screen.getByRole("button", { name: "차트 초기화" }));
    expect(viewport()).toHaveAttribute("data-visible-start", "0");
    expect(viewport()).toHaveAttribute("data-visible-count", "1200");
    rerender(<PriceChart data={data} compact />);
    expect(viewport()).toHaveAttribute("data-visible-count", "1200");
  });
  it("uses the visible endpoint direction for its price label while retaining the whole-period summary", () => {
    const data = observations(180, "5Y");
    data.candles.forEach((point, i) => Object.assign(point, { open: 100, close: i === 0 ? 100 : i === 179 ? 120 : 90, low: 80, high: 130 }));
    render(<PriceChart data={data} mode="candle" />);
    expect(document.querySelector('[data-price-direction]')).toHaveTextContent("▲ +20.00%");
    fireEvent.click(screen.getByRole("button", { name: "이전 구간 이동" }));
    expect(document.querySelector('[data-price-last-label]')).toHaveTextContent("▼ 90원");
    fireEvent.click(screen.getByRole("button", { name: "차트 확대" }));
    expect(document.querySelector('[data-price-last-label]')).toHaveTextContent("▼ 90원");
    expect(document.querySelector('[data-price-direction]')).toHaveTextContent("▲ +20.00%");
  });
  it("keeps the chosen candle inside the viewport through zoom, pan and keyboard and resets on context changes", () => {
    const data = observations(300);
    const { rerender } = render(<PriceChart data={data} mode="candle" interval="1m" />);
    const initialCount = Number(viewport().getAttribute("data-visible-count"));
    const globalChange = document.querySelector('[data-price-direction]')!.textContent;
    const assertCrosshairInside = () => {
      const x = Number(mainSvg().querySelector('[data-price-crosshair]')!.getAttribute("x1"));
      expect(x).toBeGreaterThanOrEqual(86); expect(x).toBeLessThanOrEqual(540);
    };
    expect(initialCount).toBeLessThan(300);
    expect(screen.getByRole("img", { name: /전체 관측 기간 개요/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "차트 축소" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "이전 구간 이동" })); assertCrosshairInside();
    expect(Number(viewport().getAttribute("data-visible-start"))).toBeLessThan(300 - initialCount);
    fireEvent.click(screen.getByRole("button", { name: "차트 확대" })); assertCrosshairInside();
    const group = screen.getByRole("group", { name: /가격 탐색/ });
    fireEvent.keyDown(group, { key: "Home" }); assertCrosshairInside();
    expect(viewport()).toHaveAttribute("data-visible-start", "0");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("09:01");
    fireEvent.keyDown(group, { key: "End" }); assertCrosshairInside();
    fireEvent.keyDown(group, { key: "PageUp" }); assertCrosshairInside();
    fireEvent.keyDown(group, { key: "PageDown" }); assertCrosshairInside();
    fireEvent.keyDown(group, { key: "ArrowDown" }); assertCrosshairInside();
    expect(document.querySelector('[data-price-direction]')).toHaveTextContent(globalChange!);
    fireEvent.click(screen.getByRole("button", { name: "차트 초기화" }));
    expect(viewport()).toHaveAttribute("data-visible-count", String(initialCount));
    expect(viewport()).toHaveAttribute("data-visible-start", String(300 - initialCount));
    rerender(<PriceChart data={data} mode="area" />);
    expect(viewport()).toHaveAttribute("data-visible-count", "300");
    rerender(<PriceChart data={{ ...data, code: "000660" }} mode="candle" interval="5m" />);
    expect(document.querySelector('[data-chart-period]')).toHaveTextContent("봉 간격 5분");
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("원본 5/5분 확인");
  });
  it("preserves all original price observations and gap segments instead of applying the candle interval", () => {
    const data = observations(20); data.prices[8].price = null;
    render(<PriceChart data={data} interval="15m" />);
    expect(viewport()).toHaveAttribute("data-visible-count", "19");
    expect(mainSvg().querySelectorAll('[data-chart-segment]')).toHaveLength(2);
    const segments = [...mainSvg().querySelectorAll('[data-chart-segment] path')];
    expect(segments[0].getAttribute("d")!.split("L")).toHaveLength(8);
    expect(segments[1].getAttribute("d")!.split("L")).toHaveLength(11);
  });
  it("handles empty data and measures a narrow chart when observations arrive later", () => {
    const { rerender } = render(<PriceChart data={observations(0)} />);
    expect(screen.getByText("유효한 관측 시각과 가격이 없습니다.")).toBeInTheDocument();
    rerender(<PriceChart data={observations(0)} mode="candle" />);
    expect(screen.getByText(/캔들 차트를 제공하지 않습니다/)).toBeInTheDocument();
    rerender(<PriceChart data={observations(60)} mode="candle" interval="1m" />);
    const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 311 });
    rerender(<PriceChart data={observations(60)} mode="area" />);
    rerender(<PriceChart data={observations(60)} mode="candle" interval="1m" />);
    try {
      expect(Number(viewport().getAttribute("data-visible-count"))).toBeLessThan(25);
      for (const candle of mainSvg().querySelectorAll('[data-candle] rect')) expect(Number(candle.getAttribute("width"))).toBeGreaterThanOrEqual(4);
    } finally { if (originalWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalWidth); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth; }
  });
  it.each([1, 2, 4])("centers or separates %i sparse candles without overlap or invalid coordinates", count => {
    render(<PriceChart data={observations(count)} mode="candle" interval="1m" />);
    const candles = [...mainSvg().querySelectorAll('[data-candle] rect')];
    expect(candles).toHaveLength(count);
    candles.forEach((candle, index) => {
      expect(Number(candle.getAttribute("x"))).toBeGreaterThanOrEqual(86);
      expect(Number(candle.getAttribute("x")) + Number(candle.getAttribute("width"))).toBeLessThanOrEqual(540);
      if (index) expect(Number(candle.getAttribute("x"))).toBeGreaterThan(Number(candles[index - 1].getAttribute("x")) + Number(candles[index - 1].getAttribute("width")));
    });
    expect(mainSvg().outerHTML).not.toMatch(/NaN|Infinity/);
  });
  it("exposes partial bucket provenance and keeps the original close basis when the interval changes", () => {
    const data = observations(7); data.candles.splice(2, 1);
    const { rerender } = render(<PriceChart data={data} mode="candle" interval="5m" />);
    const change = document.querySelector('[data-price-direction]')!.textContent;
    fireEvent.keyDown(screen.getByRole("group", { name: /가격 탐색/ }), { key: "Home" });
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("원본 4/5분 확인");
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("불완전 봉");
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("거래량 — (전체 확인 불가)");
    rerender(<PriceChart data={data} mode="candle" interval="1m" />);
    expect(document.querySelector('[data-price-direction]')).toHaveTextContent(change!);
  });
});
