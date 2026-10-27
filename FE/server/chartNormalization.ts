import { TIME_RANGES, type CandlePoint, type StockChartBundle, type StockChartData } from "../src/types/stockChart";
import { isRecentMarketSession } from "./marketCachePolicy";

type RawPrice = { date: string | null; price: number | null };
type RangeData = StockChartData["ranges"]["1M"];

/** Last observation wins, matching the existing candle correction policy. */
export function uniqueSortedCandles(candles: CandlePoint[]): CandlePoint[] {
  return [...new Map(candles.map(candle => [candle.time, candle])).values()]
    .sort((left, right) => left.time.localeCompare(right.time));
}

type AnchoredPrices = { dated: Map<string, RawPrice>; gaps: Map<string, RawPrice[]> };
const HEAD = "head";

function anchorRawPrices(rows: RawPrice[]): AnchoredPrices {
  const dated = new Map<string, RawPrice>(), gaps = new Map<string, RawPrice[]>();
  let previous: string | null = null, ascending = false, descending = false;
  for (const row of rows) if (row.date !== null) {
    if (previous !== null) { ascending ||= row.date > previous; descending ||= row.date < previous; }
    dated.set(row.date, row); previous = row.date; // Last correction wins before reversing.
  }
  // Legacy mixed-order caches do not establish a reliable gap location.
  // Keep every dated observation, but discard only their ambiguous null markers.
  if (ascending && descending) return { dated, gaps };
  const ordered = descending ? [...rows].reverse() : rows;
  let anchor = HEAD;
  for (const row of ordered) {
    if (row.date !== null) { anchor = row.date; continue; }
    const markers = gaps.get(anchor) ?? [];
    markers.push(row); gaps.set(anchor, markers);
  }
  return { dated, gaps };
}

function emitRawPrices({ dated, gaps }: AnchoredPrices): RawPrice[] {
  return [...(gaps.get(HEAD) ?? []), ...[...dated.keys()].sort()
    .flatMap(date => [dated.get(date)!, ...(gaps.get(date) ?? [])])];
}

/** Reverse the whole source sequence first, retaining boundary and interior gaps. */
export function normalizeRawPrices(rows: RawPrice[]): RawPrice[] {
  return emitRawPrices(anchorRawPrices(rows));
}

/** Slice observations and their gap anchors together when deriving a shorter range. */
export function sliceDailyRawPrices(rows: RawPrice[], cutoff: string): RawPrice[] {
  const source = anchorRawPrices(rows), first = [...source.dated.keys()].sort()[0];
  const dated = new Map([...source.dated].filter(([date]) => date >= cutoff));
  const gaps = new Map([...source.gaps].filter(([anchor]) => anchor === HEAD
    ? Boolean(first && first >= cutoff) : anchor >= cutoff && dated.has(anchor)));
  return emitRawPrices({ dated, gaps });
}

/** Replace gaps in the reobserved interval, never concatenate old/new markers. */
export function mergeDailyRawPrices(previous: RawPrice[], incoming: RawPrice[], startDate: string, cutoff: string): RawPrice[] {
  const old = anchorRawPrices(previous), fresh = anchorRawPrices(incoming);
  const dated = new Map([...old.dated, ...fresh.dated].filter(([date]) => date >= cutoff));
  const gaps = new Map<string, RawPrice[]>();
  const oldFirst = [...old.dated.keys()].sort()[0], freshFirst = [...fresh.dated.keys()].sort()[0];
  for (const [anchor, markers] of old.gaps) {
    if (anchor === HEAD) {
      if (oldFirst && oldFirst >= cutoff && oldFirst < startDate) gaps.set(HEAD, markers);
    } else if (anchor >= cutoff && anchor < startDate && dated.has(anchor)) gaps.set(anchor, markers);
  }
  for (const [anchor, markers] of fresh.gaps) {
    if (anchor !== HEAD) {
      if (anchor >= cutoff && dated.has(anchor)) gaps.set(anchor, markers);
    } else if (freshFirst && freshFirst >= cutoff) {
      // A query's leading gap belongs immediately before its first observation,
      // not ahead of the entire older cached history. Reuse that boundary anchor.
      const boundary = [...dated.keys()].filter(date => date < freshFirst).sort().slice(-1)[0] ?? HEAD;
      gaps.set(boundary, markers);
    }
  }
  return emitRawPrices({ dated, gaps });
}

export function normalizeDailyChartRange(range: RangeData): RangeData {
  const candles = uniqueSortedCandles(range.candles);
  return { ...range, candles,
    prices: [...new Map(range.prices.map(point => [point.date, point])).values()].sort((left, right) => left.date.localeCompare(right.date)),
    ...(range.rawPrices ? { rawPrices: normalizeRawPrices(range.rawPrices) } : {}) };
}

/** A cached future timestamp must not become valid just because the clock advanced. */
export function normalizeIntradayChartRange(range: RangeData, queriedAt: number, repairCache = false): RangeData {
  const recordedAt = Date.parse(range.intraday?.queriedAt ?? "");
  const cutoff = Math.min(queriedAt, Number.isFinite(recordedAt) ? recordedAt : queriedAt);
  const future = (time: string | null | undefined) => {
    if (!time || time.length <= 10) return false;
    const timestamp = Date.parse(time.length === 19 ? `${time}+09:00` : time);
    return Number.isFinite(timestamp) && timestamp > cutoff;
  };
  const candles = range.candles.filter(row => !future(row.rawTime ?? row.time));
  const prices = range.prices.filter(row => !future(row.rawDate ?? row.date));
  const rawPrices = range.rawPrices?.filter(row => !future(row.date));
  const rejectedFutureCandles = range.candles.length - candles.length;
  const rejectedFuturePrices = range.rawPrices ? range.rawPrices.length - rawPrices!.length : range.prices.length - prices.length;
  return { ...range, candles, prices, ...(rawPrices ? { rawPrices } : {}), intraday: {
    ...range.intraday,
    queriedAt: new Date(cutoff).toISOString(),
    rejectedFuturePrices: (range.intraday?.rejectedFuturePrices ?? 0) + rejectedFuturePrices,
    rejectedFutureCandles: (range.intraday?.rejectedFutureCandles ?? 0) + rejectedFutureCandles,
    needsRefresh: range.intraday?.needsRefresh === true || (repairCache && (rejectedFuturePrices > 0 || rejectedFutureCandles > 0)),
  } };
}

export function normalizeStockChartBundle(bundle: StockChartBundle, builtAt = Date.now()): StockChartBundle {
  const ranges = { ...bundle.chartData.ranges };
  for (const range of TIME_RANGES) if (range !== "1D") ranges[range] = normalizeDailyChartRange(ranges[range]);
  const intraday = ranges["1D"], now = Date.now();
  // Legacy incremental merges may already contain fabricated rows before builtAt.
  // Adding metadata makes this a one-time migration; successful repair clears the flag.
  const legacyRecent = !intraday.intraday && [
    ...intraday.candles.map(row => row.rawTime ?? row.time),
    ...(intraday.rawPrices ?? intraday.prices).map(row => row.date),
  ].some(time => time !== null && isRecentMarketSession(time.slice(0, 10), now));
  ranges["1D"] = normalizeIntradayChartRange(intraday, Math.min(builtAt, now), true);
  if (legacyRecent) ranges["1D"].intraday!.needsRefresh = true;
  return { ...bundle, chartData: { ...bundle.chartData, ranges } };
}
