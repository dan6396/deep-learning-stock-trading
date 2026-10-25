import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PriceChart, nicePriceTicks } from "./PriceChart";
import { adaptChart } from "../../entities/market";
import { chartBundle } from "../../test/fixtures/reportFixtures";
describe("observed price chart", () => {
  it("creates bounded nice price ticks for flat and varying prices", () => {
    for (const [low, high] of [[100, 100], [56700, 89200], [9, 11], [1230000, 1270000]]) {
      const ticks = nicePriceTicks(low, high); expect(ticks.length).toBeGreaterThanOrEqual(3); expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks[0]).toBeLessThanOrEqual(low); expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(high);
    }
    expect(nicePriceTicks(NaN, 10)).toEqual([]);
  });
  it("labels price/time axes, extrema, baseline and the last value and explores observations by keyboard", () => {
    const data = adaptChart(chartBundle(), "005930", "1D").data; render(<PriceChart data={data} />);
    expect(screen.getByText("09:00")).toBeInTheDocument(); expect(screen.getByText("15:30")).toBeInTheDocument();
    expect(screen.getByText("최고 107원")).toBeInTheDocument(); expect(screen.getByText("최저 105원")).toBeInTheDocument();
    expect(document.querySelector('[data-price-last-label]')).toHaveTextContent("▲ 107원"); expect(document.querySelector('[data-price-direction]')).toHaveAttribute("data-price-direction", "rise");
    expect(document.querySelector('[data-price-baseline]')).toBeInTheDocument();
    const explorer = screen.getByRole("group", { name: /가격 탐색/ }); fireEvent.keyDown(explorer, { key: "Home" });
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("105원 · 기간 시작가 대비 0.00%");
    fireEvent.keyDown(explorer, { key: "ArrowRight" }); expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("106원");
    fireEvent.click(screen.getByRole("button", { name: "다음 가격 관측" })); expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("107원");
  });
  it("uses the Korean falling color and symbol for a falling period, in candle mode too", () => {
    const data = adaptChart(chartBundle(), "005930", "1M").data; data.candles.forEach((point, i) => { point.close = 107 - i; });
    render(<PriceChart data={data} mode="candle" />);
    expect(document.querySelector('[data-price-direction]')).toHaveAttribute("data-price-direction", "fall");
    expect(document.querySelector('[data-price-last-label]')).toHaveTextContent("▼ 105원"); expect(screen.getByRole("img").querySelector('rect')).toBeInTheDocument();
  });
  it("moves the crosshair to the nearest observation on pointer input", () => {
    render(<PriceChart data={adaptChart(chartBundle(), "005930", "1M").data} />);
    const svg = screen.getByRole("img"); Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, width: 640 }) });
    fireEvent.pointerMove(svg, { clientX: 86 });
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("105원");
  });
});
