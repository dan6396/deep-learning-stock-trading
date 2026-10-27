import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PriceChart, nicePriceTicks } from "./PriceChart";
import { adaptChart, type ChartData } from "../../entities/market";
import { chartBundle } from "../../test/fixtures/reportFixtures";

function observations(count = 180, range: ChartData["range"] = "1D"): ChartData {
  const timestamps = Array.from({ length: count }, (_, i) => range === "1D" ? Date.parse("2026-10-27T09:00:00+09:00") + i * 60_000 : Date.parse("2021-10-01T00:00:00+09:00") + i * 86400_000);
  const candles = timestamps.map((timestamp, i) => ({ time: new Date(timestamp + 9 * 3600_000).toISOString().slice(0, range === "1D" ? 19 : 10), open: 1000 + i, high: 1010 + i, low: 990 + i, close: 1005 + i, volume: 10, rawOhlc: true, rawTimeVerified: true }));
  const res: ChartData = {
    code: "005930",
    range,
    candles,
    prices: candles.map(point => ({ date: point.time, price: point.close, rawTimeVerified: true })),
    observedAt: "2026-10-27T16:00:00+09:00"
  };
  (res as Record<string, unknown>).queriedAt = "2026-10-27T16:00:00+09:00";
  (res as Record<string, unknown>).intraday = { queriedAt: "2026-10-27T16:00:00+09:00", observedAt: "2026-10-27T16:00:00+09:00" };
  return res;
}
const mainSvg = () => document.querySelector('svg[data-chart-code]')!;
const viewport = () => document.querySelector('[data-chart-mode]')!;

describe("observed price chart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T16:00:00+09:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates bounded nice price ticks for flat and varying prices", () => {
    for (const [low, high] of [[100, 100], [56700, 89200], [9, 11], [1230000, 1270000]]) {
      const ticks = nicePriceTicks(low, high); expect(ticks.length).toBeGreaterThanOrEqual(3); expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks[0]).toBeLessThanOrEqual(low); expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(high);
    }
    expect(nicePriceTicks(NaN, 10)).toEqual([]);
  });
  it("keeps the last-price label without a solid leader across unobserved intraday session time", () => {
    vi.setSystemTime(new Date("2026-10-27T13:01:00+09:00"));
    const { rerender } = render(<PriceChart data={observations(241)} />);
    expect(document.querySelector('[data-price-last-label]')).toHaveTextContent("1,245원");
    expect(document.querySelector('[data-price-last-connector]')).not.toBeInTheDocument();
    expect(mainSvg().querySelector('[data-chart-segment] path')).toBeInTheDocument();
    rerender(<PriceChart data={observations(241)} mode="candle" interval="5m" />);
    expect(document.querySelector('[data-price-last-label]')).toBeInTheDocument();
    expect(document.querySelector('[data-price-last-connector]')).not.toBeInTheDocument();
  });
  it("preserves the connector for daily history and after the intraday session closes", () => {
    vi.setSystemTime(new Date("2026-10-27T13:01:00+09:00"));
    const { rerender } = render(<PriceChart data={observations(28, "1M")} />);
    expect(document.querySelector('[data-price-last-connector]')).toBeInTheDocument();
    vi.setSystemTime(new Date("2026-10-27T15:30:00+09:00"));
    rerender(<PriceChart data={observations(241)} />); // Sparse final session still retains its old annotation.
    expect(document.querySelector('[data-price-last-connector]')).toBeInTheDocument();
    rerender(<PriceChart data={observations(391)} />);
    expect(document.querySelector('[data-price-last-connector]')).toBeInTheDocument();
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
        rawOhlc: true,
        rawTimeVerified: true
      };
    });
    const data: ChartData = {
      code: "005930",
      range: "1D",
      candles: minuteCandles,
      prices: minuteCandles.map(point => ({ date: point.time, price: point.close, rawTimeVerified: true }))
    };
    render(<PriceChart data={data} mode="candle" interval="5m" />);
    // 120 1-minute candles -> 24 5-minute candles
    expect(mainSvg().querySelectorAll('[data-candle] rect')).toHaveLength(24);
    for (const candle of mainSvg().querySelectorAll('[data-candle] rect')) {
      expect(Number(candle.getAttribute("width"))).toBeGreaterThanOrEqual(4);
    }
  });
  it("does not synthesize missing minutes into synthetic bars and reports incomplete buckets", () => {
    const base = Date.parse("2026-10-27T09:00:00+09:00");
    const sparseMinutes = [0, 1, 2, 5, 6].map(i => {
      const ts = base + i * 60_000;
      const time = new Date(ts + 9 * 3600_000).toISOString().slice(0, 19);
      return { time, open: 1000, high: 1010, low: 990, close: 1005, volume: 10, rawOhlc: true, rawTimeVerified: true };
    });
    const data: ChartData = {
      code: "005930",
      range: "1D",
      candles: sparseMinutes,
      prices: sparseMinutes.map(point => ({ date: point.time, price: point.close, rawTimeVerified: true }))
    };
    render(<PriceChart data={data} mode="candle" interval="5m" />);
    // Only 2 buckets exist (09:00 with 3 observations, 09:05 with 2 observations)
    expect(mainSvg().querySelectorAll('[data-candle] rect')).toHaveLength(2);
    expect(screen.getByText(/분 누락 시 확인된 OHLC만 표시하며/)).toBeInTheDocument();
  });
  it("renders closing single observation at 15:30 distinctly", () => {
    const base = Date.parse("2026-10-27T09:00:00+09:00");
    const sessionClose = Date.parse("2026-10-27T15:30:00+09:00");
    const points = [base, sessionClose].map(ts => {
      const time = new Date(ts + 9 * 3600_000).toISOString().slice(0, 19);
      return { time, open: 1000, high: 1010, low: 990, close: 1005, volume: 10, rawOhlc: true, rawTimeVerified: true };
    });
    const data: ChartData = { code: "005930", range: "1D", candles: points, prices: points.map(p => ({ date: p.time, price: p.close, rawTimeVerified: true })) };
    render(<PriceChart data={data} mode="candle" interval="5m" />);
    expect(mainSvg().querySelectorAll('[data-candle] rect')).toHaveLength(2);
  });
  it("allows navigating through past segments of a long history series and distinguishes visible vs total change", () => {
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
    const initialStart = Number(viewport().getAttribute("data-visible-start"));
    const globalChange = document.querySelector('[data-price-direction]')!.textContent;
    const assertCrosshairInside = () => {
      const x = Number(mainSvg().querySelector('[data-price-crosshair]')!.getAttribute("x1"));
      expect(x).toBeGreaterThanOrEqual(86); expect(x).toBeLessThanOrEqual(540);
    };
    expect(initialCount).toBeLessThan(300);
    expect(initialStart).toBe(300 - initialCount);
    expect(screen.getByRole("img", { name: /전체 관측 기간 개요/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "차트 축소" })).toBeDisabled();

    // 1. 이전 구간 이동 -> data-visible-start 값 감소 단언
    fireEvent.click(screen.getByRole("button", { name: "이전 구간 이동" })); assertCrosshairInside();
    const panStart = Number(viewport().getAttribute("data-visible-start"));
    expect(panStart).toBeLessThan(300 - initialCount);

    // 2. 차트 확대 -> data-visible-count 값 감소 단언
    fireEvent.click(screen.getByRole("button", { name: "차트 확대" })); assertCrosshairInside();
    const zoomedCount = Number(viewport().getAttribute("data-visible-count"));
    expect(zoomedCount).toBeLessThan(initialCount);

    const group = screen.getByRole("group", { name: /가격 탐색/ });

    // 수정키 무시 단언 (altKey, ctrlKey, metaKey가 각각 눌렸을 때 상태가 변하지 않음)
    const countBeforeMod = Number(viewport().getAttribute("data-visible-count"));
    const startBeforeMod = Number(viewport().getAttribute("data-visible-start"));

    fireEvent.keyDown(group, { key: "ArrowLeft", altKey: true });
    expect(Number(viewport().getAttribute("data-visible-count"))).toBe(countBeforeMod);
    expect(Number(viewport().getAttribute("data-visible-start"))).toBe(startBeforeMod);

    fireEvent.keyDown(group, { key: "ArrowUp", ctrlKey: true });
    expect(Number(viewport().getAttribute("data-visible-count"))).toBe(countBeforeMod);
    expect(Number(viewport().getAttribute("data-visible-start"))).toBe(startBeforeMod);

    fireEvent.keyDown(group, { key: "PageUp", metaKey: true });
    expect(Number(viewport().getAttribute("data-visible-count"))).toBe(countBeforeMod);
    expect(Number(viewport().getAttribute("data-visible-start"))).toBe(startBeforeMod);

    // 3. Home 키 -> start가 0으로 이동
    fireEvent.keyDown(group, { key: "Home" }); assertCrosshairInside();
    expect(viewport()).toHaveAttribute("data-visible-start", "0");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(document.querySelector('[data-price-tooltip]')).toHaveTextContent("09:01");

    // 4. End 키 -> start가 뒤쪽으로 이동
    fireEvent.keyDown(group, { key: "End" }); assertCrosshairInside();
    const startAtEnd = Number(viewport().getAttribute("data-visible-start"));
    expect(startAtEnd).toBeGreaterThan(0);

    // 5. PageUp (이전 구간 탐색) -> start가 감소
    fireEvent.keyDown(group, { key: "PageUp" }); assertCrosshairInside();
    const startAfterPageUp = Number(viewport().getAttribute("data-visible-start"));
    expect(startAfterPageUp).toBeLessThan(startAtEnd);

    // 6. PageDown (다음 구간 탐색) -> start가 증가
    fireEvent.keyDown(group, { key: "PageDown" }); assertCrosshairInside();
    const startAfterPageDown = Number(viewport().getAttribute("data-visible-start"));
    expect(startAfterPageDown).toBeGreaterThan(startAfterPageUp);

    // 7. ArrowDown (축소) -> visible-count 증가 단언
    const countBeforeZoomOut = Number(viewport().getAttribute("data-visible-count"));
    fireEvent.keyDown(group, { key: "ArrowDown" }); assertCrosshairInside();
    expect(Number(viewport().getAttribute("data-visible-count"))).toBeGreaterThan(countBeforeZoomOut);

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
  it("displays accurate message when candles exist only outside the regular trading session", () => {
    const outsideCandles = Array.from({ length: 30 }, (_, i) => {
      const ts = Date.parse("2026-10-27T08:00:00+09:00") + i * 60_000;
      const time = new Date(ts + 9 * 3600_000).toISOString().slice(0, 19);
      return { time, open: 1000, high: 1010, low: 990, close: 1005, volume: 10, rawOhlc: true, rawTimeVerified: true };
    });
    const outsideData: ChartData = {
      code: "005930",
      range: "1D",
      candles: outsideCandles,
      prices: outsideCandles.map(c => ({ date: c.time, price: c.close, rawTimeVerified: true }))
    };
    render(<PriceChart data={outsideData} mode="candle" />);
    expect(screen.getByText("정규 거래 세션(09:00~15:30) 밖 분봉만 있어 캔들 차트를 표시할 수 없습니다.")).toBeInTheDocument();
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

  it("renders compact mode without controls or empty text", () => {
    const data = adaptChart(chartBundle(), "005930", "1D").data;
    render(<PriceChart data={data} compact={true} />);
    expect(screen.queryByRole("group", { name: "차트 확대·이동 조작" })).not.toBeInTheDocument();
  });

  it("renders 5Y total period by default, zooms in, and restores with reset", () => {
    const data = observations(1000, "5Y");
    render(<PriceChart data={data} mode="area" />);
    const initialCount = Number(viewport().getAttribute("data-visible-count"));
    expect(initialCount).toBe(1000);

    const zoomInBtn = screen.getByRole("button", { name: "차트 확대" });
    fireEvent.click(zoomInBtn);
    const zoomedCount = Number(viewport().getAttribute("data-visible-count"));
    expect(zoomedCount).toBeLessThan(initialCount);

    const resetBtn = screen.getByRole("button", { name: "차트 초기화" });
    fireEvent.click(resetBtn);
    expect(Number(viewport().getAttribute("data-visible-count"))).toBe(initialCount);
  });
});
