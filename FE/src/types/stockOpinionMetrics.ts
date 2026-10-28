/** Ranking/input observations only; predicted returns are deliberately excluded. */
export type StockOpinionMetrics = {
  rawRank: number | null; adjustedRank: number | null;
  lookbacks: { sessions: 20 | 120; rank: number; topPercent: number }[];
  agreement: "일치" | "부분 일치" | "불일치" | null;
  features: { key: "f_rsi" | "f_pct_b" | "f_high"; label: string; percentile: number; side: "upper" | "lower"; tailPercent: number }[];
};
