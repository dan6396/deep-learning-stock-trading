export type PipelineSentimentLabel = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | string;

export type PipelineAnalysisResult = {
  ticker: string;
  company_name: string;
  label: PipelineSentimentLabel;
  label_ko: string;
  sentiment_score: number;
  confidence: number;
  summary: string;
  positive_factors: string[];
  negative_factors: string[];
  key_data_points: string[];
  used_news_indices: number[];
  caution: string;
  /** Optional explanatory note carried by a stored analysis. */
  trading_insight?: string;
};

export type PipelineInputRow = {
  ticker?: string;
  company_name?: string;
  ensemble_pred_return?: number;
  rank_score?: number;
  score_kind?: string;
  p_up?: number; // Legacy classification output only.
  prediction_base_date?: string;
  prediction_target?: string;
  model_id?: string;
  pred_rank?: number;
  prediction_status?: string;
  transformer_base_date?: string;
  [key: string]: unknown;
};

export type PipelineNewsItem = {
  index: number;
  pub_date: string;
  source: string;
  title: string;
  description?: string;
  url?: string;
  sentiment?: PipelineSentimentLabel;
  sentiment_ko?: string;
  sentiment_reason?: string;
};

export type PipelineOutputRow = {
  result: PipelineAnalysisResult;
  input_row: PipelineInputRow;
  news: PipelineNewsItem[];
  /** Additive provenance; legacy consumers can ignore this field. */
  data_meta?: {
    source?: "live" | "cache" | "sample" | "unknown";
    asOf?: string | null;
    newsCollected?: boolean;
    newsMethod?: "llm" | "keyword" | "unknown";
    newsStatus?: string;
    newsTally?: unknown;
    rawFinalPrediction?: number | null;
    rawModelRank?: number | null;
    rawFinalRank?: number | null;
  };
};

export type MarketDirection = "up" | "down" | "flat";

export type MarketIndexSnapshot = {
  rawValues?: { value: number | null; change: number | null; changeRate: number | null };
  symbol: string;
  name: string;
  value: number;
  change: number;
  changeRate: number;
  direction: MarketDirection;
  miniSeries: number[];
  miniSeriesSource?: "history" | "interpolated" | "unknown";
  source?: "live" | "cache" | "sample" | "unknown";
  asOf?: string | null;
};

export type InvestorFlow = {
  personal: number;
  foreign: number;
  institution: number;
};

/**
 * One daily OHLC candle. Mirrors the shape a KIS daily-chart wrapper
 * (`FHKST03010100`) returns, so backend data can flow in unchanged.
 */
export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StockQuote = {
  rawValues?: { currentPrice: number | null; change: number | null; changeRate: number | null; accumulatedVolume: number | null; tradingValue: number | null };
  source?: "live" | "cache" | "sample" | "unknown";
  asOf?: string | null;
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  /**
   * KOSPI200 membership. Set by the backend (its universe is the KOSPI200
   * pool); when absent the UI falls back to a small bundled code set so mock
   * data still filters sensibly.
   */
  isKospi200?: boolean;
  currentPrice: number;
  change: number;
  changeRate: number;
  direction: MarketDirection;
  accumulatedVolume: number;
  tradingValue: number;
  tradingValueRank: number;
  investorFlow: InvestorFlow;
  aiSummary: string;
  sentimentLabel: PipelineSentimentLabel;
  confidence: number;
  predictedReturn: number | null;
  upProbability?: number | null;
  miniSeries: number[];
  /**
   * Daily OHLC history, oldest first. Supplied by the backend daily-chart
   * endpoint; when absent the UI derives a deterministic placeholder anchored
   * to `currentPrice` so the candle chart still renders.
   */
  candles?: Candle[];
};

export type MarketEvent = {
  timeLabel: string;
  title: string;
};

export type MarketDashboardData = {
  source?: "live" | "cache" | "sample" | "unknown";
  asOf?: string | null;
  generatedAt: string;
  sessionLabel: string;
  indices: MarketIndexSnapshot[];
  stocks: StockQuote[];
  watchlist: StockQuote[];
  focusedStockCode: string;
  events: MarketEvent[];
};
