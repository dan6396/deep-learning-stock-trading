import { STOCK_SENTENCE_POLICY_VERSION } from "./stockSentenceAllowlist";

/** Deliberately accepts reason codes only, never text, spans, sources or residue. */
export function recordStockSentenceRejections(field: "stockOpinions" | "newsSummaries", code: string, reasons: readonly (string | null)[]): void {
  const rejected = reasons.filter(Boolean).length;
  for (const [index, reason] of reasons.entries()) if (reason) console.warn("[briefing] Sentence rejected", {
    policyVersion: STOCK_SENTENCE_POLICY_VERSION, field: `${field}:${code}`, sentence: index + 1, reason, rejected, total: reasons.length,
  });
}
