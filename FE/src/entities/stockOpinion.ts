import type { StockAiOpinion } from "../types/stockOpinion";
export type * from "../types/stockOpinion";
import { record, textValue } from "./value";

export function adaptStockAiOpinion(raw: unknown, code: string): StockAiOpinion | undefined {
  const row = record(raw), text = textValue(row.text);
  if (!text || !["llm", "template"].includes(String(row.source)) || !Array.isArray(row.citations)
    || !row.citations.length || row.citations.some(id => typeof id !== "string"
      || !(id === `R:${code}` || new RegExp(`^R:${code}:(?:raw|adjusted|20|120)$`).test(id) || new RegExp(`^E:${code}:feature:(?:f_rsi|f_pct_b|f_high)$`).test(id) || new RegExp(`^[ECN]:${code}:\\d+$`).test(id) || /^M:[A-Z0-9_]+$/.test(id)))) return undefined;
  const generatedAt = textValue(row.generatedAt);
  return { source: row.source as StockAiOpinion["source"], text, citations: [...new Set(row.citations as string[])],
    ...(generatedAt && Number.isFinite(Date.parse(generatedAt)) ? { generatedAt } : {}) };
}
