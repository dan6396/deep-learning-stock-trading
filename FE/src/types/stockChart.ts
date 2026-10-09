import type { StockQuote } from "./trading";

export const TIME_RANGES = ["1D", "1M", "3M", "1Y", "3Y", "5Y"] as const;

export type TimeRange = (typeof TIME_RANGES)[number];

export type ChartMode = "area" | "candle";
export type ChartCoverage = {
  requestedRange: TimeRange; sourceRange: TimeRange | null;
  method: "requested" | "subset" | "fallback" | "unknown";
  status: "partial" | "unverified" | "empty";
  requestedStart: string | null; requestedEnd: string | null;
  observedStart: string | null; observedEnd: string | null;
};

export type PricePoint = {
  date: string;
  price: number;
  rawDate?: string | null;
};

export type CandlePoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  rawTime?: string | null;
  rawValues?: { open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null };
};

export type StockChartData = {
  symbol: string;
  name: string;
  code: string;
  currentPrice: number;
  averageBuyPrice?: number;
  ranges: Record<
    TimeRange,
    {
      prices: PricePoint[];
      candles: CandlePoint[];
      rawPrices?: { date: string | null; price: number | null }[];
      coverage?: ChartCoverage;
    }
  >;
};

export type StockSummary = {
  dayChangeAmount: number;
  dayChangeRate: number;
  previousClose: number;
  openingPrice: number;
  previousVolume: number;
  marketCap: number;
  dividendYield: number;
};

export type StockChartBundle = {
  source?: "live" | "cache" | "sample" | "unknown";
  asOf?: string | null;
  chartData: StockChartData;
  sourceStock: StockQuote;
  summary: StockSummary;
};
