import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { chartLabelWidth, formatObservation, indicatorChartLayout, PreOpenIndicatorChart } from "./PreOpenIndicatorChart";
import type { PreOpenIndicator } from "../../entities/briefing";
const points = ["20", "21", "22", "23", "26"].map((day, index) => ({ date: `2026-10-${day}`, value: [4.981, 5.112, 4.992, 4.994, 4.991][index] }));
const row = { id: "UST10Y", name: "미국 국채 10년 금리", unit: "%", history: points } as PreOpenIndicator;
describe("pre-open observation chart", () => {
  it("uses distinct maximum/minimum ticks and the displayed precision", () => {
    expect(indicatorChartLayout(points, "%", 460)!.ticks.map(tick => tick.text)).toEqual(["5.112%", "4.981%"]);
    expect(formatObservation(26169.384, "pt")).toBe("26,169.38pt");
    expect(formatObservation(1321.764, "KRW")).toBe("1,321.76원");
    expect(formatObservation(-0.0001, "%")).toBe("0.000%");
  });
  it("keeps extrema on the axis without repeating them in the value band at any width", () => {
    const wide = indicatorChartLayout(points, "%", 460)!, narrow = indicatorChartLayout(points, "%", 317)!;
    expect(wide.dates).toEqual([0, 1, 2, 3, 4]); expect(narrow.dates).toEqual([0, 2, 4]);
    for (const chart of [wide, narrow]) {
      expect(chart.labels.map(label => label.index)).toEqual([2, 3, 4]);
      const axisValues = chart.ticks.map(tick => formatObservation(tick.value, "%", false));
      expect(chart.labels.every(label => !axisValues.includes(label.text))).toBe(true);
    }
    expect(narrow.data.map(point => point.date)).toEqual(points.map(point => point.date));
  });
  it("handles missing, one-point and flat observations without fake points", () => {
    expect(indicatorChartLayout([], "%", 317)).toBeNull();
    const single = indicatorChartLayout(points.slice(0, 1), "%", 317)!;
    expect(single.data).toHaveLength(1); expect(single.ticks).toHaveLength(1); expect(Number.isFinite(single.y(4.981))).toBe(true);
    const flat = indicatorChartLayout(points.map(point => ({ ...point, value: 1 })), "%", 317)!;
    expect(new Set(flat.data.map(point => flat.y(point.value))).size).toBe(1);
    const { rerender } = render(<PreOpenIndicatorChart row={{ ...row, history: [] }} color="blue" />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/관측 자료 없음/);
    rerender(<PreOpenIndicatorChart row={{ ...row, history: points.slice(0, 1) }} color="blue" />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("announces the group summary and each observation once, preserving keyboard and hover tooltips", () => {
    render(<PreOpenIndicatorChart row={row} color="blue" />);
    const graph = screen.getByRole("group");
    expect(graph).toHaveAccessibleName("미국 국채 10년 금리: 2026-10-20~2026-10-26 · 5개 관측 · 최소 4.981% · 최대 5.112% · 마지막 2026-10-26 4.991%");
    expect(graph).not.toHaveAccessibleName(expect.stringContaining("4.992%"));
    expect(graph.querySelector("title")).toBeNull();
    for (const observation of points) expect(screen.getByRole("button", { name: `${observation.date} ${formatObservation(observation.value, "%")}` })).toBeInTheDocument();
    for (const label of graph.querySelectorAll("[data-chart-label]")) expect(label).toHaveAttribute("aria-hidden", "true");
    const point = screen.getByRole("button", { name: "2026-10-20 4.981%" });
    fireEvent.focus(point); expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent("2026-10-20 · 4.981%");
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("tooltip", { hidden: true })).toBeVisible();
    expect(point).not.toHaveAttribute("aria-describedby");
    fireEvent.keyDown(point, { key: "Escape" }); expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
    fireEvent.mouseEnter(point); expect(screen.getByRole("tooltip", { hidden: true })).toBeVisible();
  });
  it("separates the visible point ring from each 44px touch target", () => {
    render(<PreOpenIndicatorChart row={row} color="blue" />);
    for (const button of screen.getAllByRole("button")) {
      const hit = button.querySelector("[data-chart-hit-area]")!, ring = button.querySelector(".preopen-chart-focus-ring")!;
      expect(hit).toHaveAttribute("width", "44"); expect(hit).toHaveAttribute("height", "44");
      expect(hit).toHaveAttribute("fill", "transparent");
      expect(ring).toHaveAttribute("r", "7"); expect(ring).toHaveAttribute("aria-hidden", "true");
      expect(Number(hit.getAttribute("x")) + 22).toBeCloseTo(Number(ring.getAttribute("cx")));
      expect(Number(hit.getAttribute("y")) + 22).toBeCloseTo(Number(ring.getAttribute("cy")));
    }
  });
  it("renders signed futures bars around zero, including every daily value on narrow cards", () => {
    const history = points.map((point, index) => ({ ...point, value: [-1544, -3632, 1552, 2177, 3451][index] }));
    const layout = indicatorChartLayout(history, "계약", 317)!;
    expect(layout.ticks.map(tick => tick.text)).toEqual(["0계약"]);
    expect(layout.labels).toHaveLength(5); expect(layout.zero).toBeGreaterThan(layout.plotTop); expect(layout.zero).toBeLessThan(layout.plotBottom);
    render(<PreOpenIndicatorChart row={{ ...row, unit: "계약", history }} color="red" />);
    expect(screen.getByTestId("futures-zero-line")).toBeInTheDocument();
    const bars = screen.getAllByTestId("futures-bar");
    expect(bars).toHaveLength(5); expect(bars[0]).toHaveAttribute("fill", "var(--ds-fall)"); expect(bars[4]).toHaveAttribute("fill", "var(--ds-rise)");
    expect(screen.getByRole("button", { name: "2026-10-26 +3,451계약" })).toBeInTheDocument();
  });
  it.each([240, 317, 460])("reserves Korean unit widths and keeps large signed futures labels inside %ipx", width => {
    expect(chartLabelWidth("+12,345계약")).toBeGreaterThan("+12,345계약".length * 7);
    for (const unit of ["KRW", "pt", "계약"]) {
      const history = points.map((point, index) => ({ ...point, value: [-12345, 12345, 34567, -45678, 56789][index] }));
      const chart = indicatorChartLayout(history, unit, width)!;
      for (const tick of chart.ticks) expect(chart.left - 12 - chartLabelWidth(tick.text)).toBeGreaterThanOrEqual(0);
      for (const label of chart.labels) {
        expect(label.x - chartLabelWidth(label.text) / 2).toBeGreaterThanOrEqual(0);
        expect(label.x + chartLabelWidth(label.text) / 2).toBeLessThanOrEqual(width);
      }
      if (unit === "계약") expect(chart.labels.map(label => label.text)).toEqual(["-12,345", "+12,345", "+34,567", "-45,678", "+56,789"]);
    }
  });
});
