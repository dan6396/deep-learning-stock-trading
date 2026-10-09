import { aggregateSource, resultMeta, type DataResult } from "./source";
import { finiteNumber, record, stockCode, textValue } from "./value";
import { TIME_RANGES, type TimeRange, type ChartCoverage } from "../types/stockChart";

export type IndexData = {
  symbol: string; name: string | null; value: number | null; change: number | null; changeRate: number | null;
  miniSeries: (number | null)[]; miniSeriesSource: "history" | "interpolated" | "unknown";
};
export type QuoteData = {
  code: string; name: string | null; market: string | null; currentPrice: number | null;
  change: number | null; changeRate: number | null; volume: number | null; tradingValue: number | null;
};
export type DashboardData = {
  generatedAt: string | null; indices: DataResult<IndexData>[]; stocks: DataResult<QuoteData>[];
};
export type ChartData = {
  code: string; range: TimeRange;
  interpolated?: boolean;
  coverage?: ChartCoverage;
  prices: { date: string | null; price: number | null; rawTimeVerified?: boolean }[];
  candles: { time: string | null; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null; rawOhlc: boolean; rawTimeVerified?: boolean }[];
};

function rawNumber(object: Record<string, unknown>, key: string): number | null {
  const raw = record(object.rawValues);
  return finiteNumber(Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : object[key]);
}

export function adaptIndex(value: unknown, fallback?: Partial<DataResult<unknown>>): DataResult<IndexData> {
  const index = record(value), meta = resultMeta(index, fallback);
  const symbol = textValue(index.symbol);
  if (!symbol) throw new Error("지수 응답에 symbol이 없습니다.");
  return { ...meta, data: {
    symbol, name: textValue(index.name), value: rawNumber(index, "value"), change: rawNumber(index, "change"), changeRate: rawNumber(index, "changeRate"),
    miniSeries: rawNumber(index, "value") === null && index.miniSeriesSource === "interpolated" ? [] : Array.isArray(index.miniSeries) ? index.miniSeries.map(finiteNumber) : [],
    miniSeriesSource: index.miniSeriesSource === "interpolated" ? "interpolated" : index.miniSeriesSource === "history" && meta.source !== "sample" ? "history" : "unknown",
  } };
}

export function adaptQuote(value: unknown, expectedCode?: string, fallback?: Partial<DataResult<unknown>>): DataResult<QuoteData> {
  const quote = record(value), code = stockCode(quote.code), meta = resultMeta(quote, fallback);
  if (!code || (expectedCode && code !== expectedCode)) throw new Error("시세 응답의 종목 코드가 요청과 다릅니다.");
  return { ...meta, data: { code, name: textValue(quote.name), market: textValue(quote.market),
    currentPrice: rawNumber(quote, "currentPrice"), change: rawNumber(quote, "change"), changeRate: rawNumber(quote, "changeRate"),
    volume: rawNumber(quote, "accumulatedVolume"), tradingValue: rawNumber(quote, "tradingValue") } };
}

export function adaptDashboard(value: unknown, fallback?: Partial<DataResult<unknown>>): DataResult<DashboardData> {
  const dashboard = record(value), meta = resultMeta(dashboard, fallback);
  if (!Array.isArray(dashboard.indices) || !Array.isArray(dashboard.stocks)) throw new Error("대시보드 응답 형식이 올바르지 않습니다.");
  const indices = dashboard.indices.map(index => adaptIndex(index, meta)), stocks = dashboard.stocks.map(quote => adaptQuote(quote, undefined, meta));
  return { ...meta, source: aggregateSource([meta.source, ...(fallback?.source ? [fallback.source] : []), ...indices.map(index => index.source), ...stocks.map(quote => quote.source)]),
    data: { generatedAt: textValue(dashboard.generatedAt), indices, stocks } };
}

export function adaptChart(value: unknown, expectedCode: string, range: TimeRange, fallback?: Partial<DataResult<unknown>>): DataResult<ChartData> {
  const bundle = record(value), chart = record(bundle.chartData), selected = record(record(chart.ranges)[range]);
  if (stockCode(chart.code) !== expectedCode || (chart.symbol != null && stockCode(chart.symbol) !== expectedCode)) throw new Error("차트 응답의 종목 코드가 요청과 다릅니다.");
  if (Object.keys(record(bundle.sourceStock)).length && stockCode(record(bundle.sourceStock).code) !== expectedCode) throw new Error("차트 시세 응답의 종목 코드가 요청과 다릅니다.");
  if (!Array.isArray(selected.prices) || !Array.isArray(selected.candles)) throw new Error("차트 범위 응답이 없습니다.");
  const hasRawPrices = Object.prototype.hasOwnProperty.call(selected, "rawPrices");
  if (hasRawPrices && !Array.isArray(selected.rawPrices)) throw new Error("원본 가격 관측 배열이 올바르지 않습니다.");
  const rawPrices = hasRawPrices ? selected.rawPrices as unknown[] : selected.prices;
  let prices = rawPrices.map(item => { const p = record(item); return { date: textValue(Object.prototype.hasOwnProperty.call(p, "rawDate") ? p.rawDate : p.date), price: finiteNumber(p.price), rawTimeVerified: hasRawPrices || Object.prototype.hasOwnProperty.call(p, "rawDate") }; });
  const times = prices.map(point => point.date === null ? NaN : Date.parse(point.date)).filter(Number.isFinite);
  if (times.length > 1 && times[0] > times[times.length - 1]) prices = prices.reverse(); // Reverse original order, retaining gaps in place.
  const meta = resultMeta(bundle, fallback), child = record(bundle.sourceStock);
  const source = Object.prototype.hasOwnProperty.call(child, "source") ? aggregateSource([meta.source, resultMeta(child).source]) : meta.source;
  const rawCoverage = record(selected.coverage), correctRange = rawCoverage.requestedRange === range;
  const date = (value: unknown) => { const text = textValue(value); if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null; const time = Date.parse(text); return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : null; };
  const coverage: ChartCoverage = { requestedRange: range, sourceRange: correctRange && TIME_RANGES.includes(rawCoverage.sourceRange as TimeRange) ? rawCoverage.sourceRange as TimeRange : null,
    method: correctRange && ["requested", "subset", "fallback"].includes(String(rawCoverage.method)) ? rawCoverage.method as ChartCoverage["method"] : "unknown",
    status: correctRange && rawCoverage.status === "partial" ? "partial" : correctRange && rawCoverage.status === "empty" ? "empty" : "unverified",
    requestedStart: correctRange ? date(rawCoverage.requestedStart) : null, requestedEnd: correctRange ? date(rawCoverage.requestedEnd) : null,
    observedStart: correctRange ? date(rawCoverage.observedStart) : null, observedEnd: correctRange ? date(rawCoverage.observedEnd) : null };
  return { ...meta, source, data: { code: expectedCode, range, prices, coverage, interpolated: selected.interpolated === true || selected.seriesSource === "interpolated" || chart.seriesSource === "interpolated" || bundle.seriesSource === "interpolated",
    candles: selected.candles.map(item => { const p = record(item); return { time: textValue(Object.prototype.hasOwnProperty.call(p, "rawTime") ? p.rawTime : p.time),
      open: rawNumber(p, "open"), high: rawNumber(p, "high"), low: rawNumber(p, "low"), close: rawNumber(p, "close"), volume: rawNumber(p, "volume"),
      rawOhlc: ["open", "high", "low", "close"].every(key => Object.prototype.hasOwnProperty.call(record(p.rawValues), key)), rawTimeVerified: Object.prototype.hasOwnProperty.call(p, "rawTime") }; }),
  } };
}
