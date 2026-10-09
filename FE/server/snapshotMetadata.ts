import type { MarketDashboardData } from "../src/types/trading";

/** Serving a stored snapshot never upgrades its contents to current API data. */
export function cachedDashboard(data: MarketDashboardData): MarketDashboardData {
  const cachedSource = (source: string | undefined) => source === "sample" ? "sample" as const : source === "unknown" ? "unknown" as const : "cache" as const;
  return {
    ...data, source: cachedSource(data.source), asOf: data.asOf ?? data.generatedAt,
    indices: data.indices.map(index => ({ ...index, source: cachedSource(index.source ?? data.source), asOf: index.asOf ?? data.asOf ?? data.generatedAt,
      miniSeriesSource: (index.source ?? data.source) === "sample" && index.miniSeriesSource === "history" ? "unknown" : index.miniSeriesSource ?? "unknown" })),
    stocks: data.stocks.map(stock => ({ ...stock, source: cachedSource(stock.source ?? data.source), asOf: stock.asOf ?? data.asOf ?? data.generatedAt })),
    watchlist: data.watchlist.map(stock => ({ ...stock, source: cachedSource(stock.source ?? data.source), asOf: stock.asOf ?? data.asOf ?? data.generatedAt })),
  };
}
