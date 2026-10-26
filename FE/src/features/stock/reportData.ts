import type { ChartData } from "../../entities/market";
import { finiteNumber } from "../../entities/value";

export { safeArticleUrl } from "../../shared/lib/articleUrl";

/** Formats model rank scores to 2 decimal places for stock report display. */
export function formatReportRankScore(value: unknown, digits = 2): string {
  const number = finiteNumber(value);
  return number === null ? "—" : Number(number.toFixed(digits)).toFixed(digits);
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
export type Price = { date: string; price: number; timestamp: number };
export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number | null; timestamp: number;
  bucket?: { end: number; observed: number; expected: number; first: number; last: number } };
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

/** Verified minute-start observations, grouped in Seoul sessions. 15:30 is its own closing observation. */
export function aggregateCandles(candles: Candle[], intervalMinutes: number): Candle[] {
  if (![1, 5, 15, 30, 60].includes(intervalMinutes)) return [];
  const aggregated: Candle[] = [];
  let currentBucket: Candle[] = [];
  let currentBucketTime: number | null = null;
  let currentEnd = 0;
  let previous = -Infinity;

  function flush() {
    if (!currentBucket.length || currentBucketTime === null) return;
    const first = currentBucket[0];
    const last = currentBucket[currentBucket.length - 1];
    let high = -Infinity;
    let low = Infinity;
    let totalVolume = 0;
    let allVolumes = true;

    for (const c of currentBucket) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      if (c.volume !== null && Number.isFinite(c.volume) && c.volume >= 0) {
        totalVolume += c.volume;
      } else allVolumes = false;
    }
    const expected = Math.max(1, (currentEnd - currentBucketTime) / 60_000);

    aggregated.push({
      time: new Date(currentBucketTime + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00",
      timestamp: currentBucketTime,
      open: first.open,
      high,
      low,
      close: last.close,
      // A partial observed sum is not the total volume of the bucket.
      volume: allVolumes && currentBucket.length === expected && Number.isFinite(totalVolume) ? totalVolume : null,
      bucket: { end: currentEnd, observed: currentBucket.length, expected, first: first.timestamp, last: last.timestamp },
    });
    currentBucket = [];
  }

  for (const c of candles) {
    if (c.timestamp <= previous || c.timestamp % 60_000 !== 0 || c.time.length <= 10) continue;
    const day = new Date(c.timestamp + 9 * 3600_000).toISOString().slice(0, 10);
    const sessionStart = Date.parse(`${day}T09:00:00+09:00`), sessionEnd = Date.parse(`${day}T15:30:00+09:00`);
    if (c.timestamp < sessionStart || c.timestamp > sessionEnd) continue;
    previous = c.timestamp;
    const bucketTime = sessionStart + Math.floor((c.timestamp - sessionStart) / (intervalMinutes * 60_000)) * intervalMinutes * 60_000;
    const bucketEnd = c.timestamp === sessionEnd ? sessionEnd : Math.min(sessionEnd, bucketTime + intervalMinutes * 60_000);
    if (currentBucketTime === null) {
      currentBucketTime = bucketTime;
      currentEnd = bucketEnd;
      currentBucket.push(c);
    } else if (bucketTime === currentBucketTime) {
      currentBucket.push(c);
    } else {
      flush();
      currentBucketTime = bucketTime;
      currentEnd = bucketEnd;
      currentBucket.push(c);
    }
  }
  flush();

  return aggregated;
}

/** Group contiguous price points into N-minute bars preserving segment boundaries. */
export function aggregateSegment(segment: Price[], intervalMinutes: number): Price[] {
  if (intervalMinutes <= 1 || !segment.length) return segment;
  const bucketMs = intervalMinutes * 60_000;
  const aggregated: Price[] = [];
  let currentBucket: Price[] = [];
  let currentBucketTime: number | null = null;

  function flush() {
    if (!currentBucket.length || currentBucketTime === null) return;
    const last = currentBucket[currentBucket.length - 1];
    aggregated.push({
      date: last.date,
      timestamp: currentBucketTime,
      price: last.price,
    });
    currentBucket = [];
  }

  for (const p of segment) {
    const bucketTime = Math.floor(p.timestamp / bucketMs) * bucketMs;
    if (currentBucketTime === null) {
      currentBucketTime = bucketTime;
      currentBucket.push(p);
    } else if (bucketTime === currentBucketTime) {
      currentBucket.push(p);
    } else {
      flush();
      currentBucketTime = bucketTime;
      currentBucket.push(p);
    }
  }
  flush();

  return aggregated;
}
