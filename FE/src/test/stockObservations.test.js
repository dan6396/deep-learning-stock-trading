import { describe, expect, it, vi } from "vitest";
import { alignPriorSessions, pairedMoments, nasdaqSensitivity, compositionObservations, createObservationProvider } from "../../server/stockObservations";
function history(code = "005930", offset = 0) {
  let close = 100;
  const rows = Array.from({ length: 360 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i))).filter(date => ![0, 6].includes(date.getUTCDay())).map((date, i) => {
    const open = close * (1 + Math.cos(i + offset) * .003); close *= 1 + Math.sin(i * .3 + offset) * .01;
    return { date: date.toISOString().slice(0, 10), open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 100 };
  }); return { code, rows, source: "cache", complete: true, asOf: null };
}
describe("stock historical observations", () => {
  it("uses strictly prior US dates through weekends and holidays, never the same-day session", () => {
    const us = ["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"].map((date, i) => ({ date, open: 100, close: 100 + i }));
    const kr = ["2026-10-09", "2026-10-12", "2026-10-13"].map((date, i) => ({ date, open: 100, close: 102 + i }));
    const result = alignPriorSessions(kr, us, "2026-10-01", "2026-10-31");
    expect(result.map(row => [row.date, row.nasdaqDate])).toEqual([["2026-10-12", "2026-10-09"], ["2026-10-13", "2026-10-12"]]);
  });
  it("calculates covariance/variance beta and Pearson correlation with no scaling confusion", () => {
    expect(pairedMoments([-2, -1, 0, 1, 2], [-4, -2, 0, 2, 4])).toEqual({ correlation: 1, beta: 2 });
    expect(pairedMoments([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pairedMoments([1, 2], [2, NaN])).toBeNull();
  });
  it("hides undersampled or constant series and reports the identical baseline sample", () => {
    const h = history(), us = history("INDEX", 1).rows;
    const result = nasdaqSensitivity(h, us, "2025-01-01", "2025-12-31");
    expect(result.status).toBe("ready"); expect(result.samples).toBeGreaterThanOrEqual(200); expect(result.metrics.map(row => row.definition)).toEqual(["close_to_close", "open_to_close"]);
    expect(result.conditional.baselineTotal).toBe(result.samples); expect(result.conditional.ratioPct).toBeCloseTo(result.conditional.count / result.conditional.total * 100);
    expect(nasdaqSensitivity({ ...h, rows: h.rows.slice(-150) }, us, "2025-01-01", "2025-12-31")).toMatchObject({ status: "preparing", metrics: [], conditional: null });
    expect(nasdaqSensitivity(null, us, "2025-01-01", "2025-12-31").samples).toBe(0);
  });
  it("does not bridge explicitly invalid daily prices and rejects ambiguous duplicate dates", () => {
    const h = history(), us = history("INDEX", 1).rows, date = h.rows[100].date, next = h.rows[101].date;
    h.rows[100].close = null;
    expect(alignPriorSessions(h.rows, us, "2025-01-01", "2025-12-31").some(row => [date, next].includes(row.date))).toBe(false);
    h.rows.push({ ...h.rows[120] });
    expect(alignPriorSessions(h.rows, us, "2025-01-01", "2025-12-31").some(row => row.date === h.rows[120].date)).toBe(false);
  });
  it("preserves declared missing trading dates as gaps instead of treating multi-day moves as daily returns", () => {
    const h = history(), us = history("INDEX", 1).rows, original = nasdaqSensitivity(h, us, "2025-01-01", "2025-12-31");
    h.missingDates = [h.rows[100].date]; h.rows.splice(100, 1);
    const missing = nasdaqSensitivity(h, us, "2025-01-01", "2025-12-31");
    expect(missing.samples).toBe(original.samples - 2);
  });
  it("uses one common 60-session sample, a symmetric matrix and an unbiased pair mean", () => {
    const codes = ["005930", "000660", "042660", "035420", "005380"], histories = codes.map((code, i) => history(code, i));
    const result = compositionObservations(codes, histories, []);
    expect(result.status).toBe("ready"); expect(result.samples).toBe(60);
    const pairs = []; result.matrix.forEach((row, i) => row.forEach((v, j) => { expect(v).toBeCloseTo(result.matrix[j][i]); if (i === j) expect(v).toBeCloseTo(1); if (i < j) pairs.push(v); }));
    expect(result.averageCorrelation).toBeCloseTo(pairs.reduce((a, b) => a + b) / 10);
    histories[0].rows.splice(-7, 7); expect(compositionObservations(codes, histories, []).status).toBe("preparing");
  });
  it("reads the shared daily cache without issuing KIS network requests or inventing empty statistics", async () => {
    const history = vi.fn(async () => null), transport = vi.fn();
    const provider = createObservationProvider({ history, transport });
    const result = await provider.get(["005930"]); expect(history.mock.calls[0][1].allowNetwork).toBe(false); expect(transport).not.toHaveBeenCalled();
    expect(result.sensitivities[0]).toMatchObject({ status: "preparing", samples: 0 });
  });
});
