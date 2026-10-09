import type { ChartData } from "../../entities/market";

export function safeArticleUrl(value: string | null | undefined): string | null {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try { const url = new URL(value); return url.hostname && !url.username && !url.password ? url.href : null; } catch { return null; }
}

/** Strict observation dates: Date.parse alone normalizes impossible days. */
export function observationTime(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(value)) return null;
  const day = value.slice(0, 10), date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  // Legacy KIS time strings are Seoul wall time, never the browser's local zone.
  const timestamp = Date.parse(value.length === 10 ? `${value}T00:00:00+09:00` : value.length === 19 ? `${value}+09:00` : value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
type Price = { date: string; price: number; timestamp: number };
type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number | null; timestamp: number };
const priceValue = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

export function validatedChart(data: ChartData) {
  const segments: Price[][] = [], prices: Price[] = [], candles: Candle[] = [];
  let segment: Price[] = [], previous = -Infinity, rejectedPrices = 0, rejectedCandles = 0;
  for (const point of data.prices) {
    const timestamp = observationTime(point.date);
    if (!point.rawTimeVerified || timestamp === null || timestamp <= previous || !priceValue(point.price)) {
      if (segment.length) segments.push(segment); segment = []; rejectedPrices++; continue;
    }
    const valid = { date: point.date!, price: point.price, timestamp }; prices.push(valid); segment.push(valid); previous = timestamp;
  }
  if (segment.length) segments.push(segment);
  previous = -Infinity;
  for (const point of data.candles) {
    const timestamp = observationTime(point.time);
    if (!point.rawTimeVerified || timestamp === null || timestamp <= previous || !point.rawOhlc ||
      !priceValue(point.open) || !priceValue(point.high) || !priceValue(point.low) || !priceValue(point.close) ||
      point.high < Math.max(point.open, point.close) || point.low > Math.min(point.open, point.close) || point.low > point.high) { rejectedCandles++; continue; }
    candles.push({ time: point.time!, open: point.open, high: point.high, low: point.low, close: point.close,
      volume: point.volume !== null && Number.isFinite(point.volume) && point.volume >= 0 ? point.volume : null, timestamp }); previous = timestamp;
  }
  return { prices, segments, candles, rejectedPrices, rejectedCandles };
}
