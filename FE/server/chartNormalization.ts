import { TIME_RANGES, type CandlePoint, type StockChartBundle, type StockChartData } from "../src/types/stockChart";

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

export function normalizeStockChartBundle(bundle: StockChartBundle): StockChartBundle {
  const ranges = { ...bundle.chartData.ranges };
  for (const range of TIME_RANGES) if (range !== "1D") ranges[range] = normalizeDailyChartRange(ranges[range]);
  return { ...bundle, chartData: { ...bundle.chartData, ranges } };
}
