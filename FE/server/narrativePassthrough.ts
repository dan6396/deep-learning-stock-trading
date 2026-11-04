import type { BriefingInput } from "./briefing";
import { templateNarrative, type BriefingNarrative } from "./briefingNarrative";
import { OUTLOOK_STANCES, type HeadlineSummary, type MarketOutlook } from "../src/types/preOpenMacro";
import type { StockOpinion } from "../src/types/stockOpinion";

/**
 * Content validation switch. Default "off": the system instruction alone governs model output and
 * no content filter (wording, numbers, citations, article passages) is applied. Set
 * BRIEFING_NARRATIVE_VALIDATION=on to restore the validated pipeline.
 */
export function narrativeValidationEnabled(env: Record<string, string | undefined>): boolean {
  // Falls back to the process environment when a caller passes a partial env object.
  return (env.BRIEFING_NARRATIVE_VALIDATION ?? process.env.BRIEFING_NARRATIVE_VALIDATION) === "on";
}
declare const process: { env: Record<string, string | undefined> };

const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const row = (rows: unknown, code: string, _index: number): Record<string, any> | null => {
  if (!Array.isArray(rows)) return null;
  const found = rows.find(item => record(item) && item.code === code);
  return record(found) ? found : null;
};

/**
 * Unfiltered acceptance. Only structure is normalized so the screen can render: a missing or
 * non-string field falls back to its template text. Model wording is used as returned.
 */
export function passthroughNarrative(value: unknown, input: BriefingInput, now: number, llmModel: string): BriefingNarrative {
  const base = templateNarrative(input, null, now), raw = record(value) ? value : {};
  const overview = text(raw.overview), marketNote = text(raw.marketNote);
  const stocks = input.stocks.map((stock, index) => {
    const candidate = row(raw.stocks, stock.code, index), summary = text(candidate?.summary);
    return summary ? { code: stock.code, summary, citations: strings(candidate?.citations), source: "llm" as const } : { ...base.stocks[index], source: "template" as const };
  });
  const stockOpinions: StockOpinion[] = input.stocks.map((stock, index) => {
    const candidate = row(raw.stockOpinions, stock.code, index), opinion = text(candidate?.text);
    const fallback = base.stockOpinions?.find(item => item.code === stock.code);
    return opinion ? { code: stock.code, text: opinion, citations: strings(candidate?.citations), source: "llm" }
      : fallback ?? { code: stock.code, text: "", citations: [], source: "template" };
  });
  let marketOutlook: MarketOutlook | undefined = base.marketOutlook;
  let newsSummaries: HeadlineSummary[] | undefined = base.newsSummaries;
  if (input.macro.preOpen) {
    const outlook = record(raw.marketOutlook) ? raw.marketOutlook : null, outlookText = text(outlook?.text);
    if (outlookText) marketOutlook = { stance: OUTLOOK_STANCES.includes(outlook!.stance) ? outlook!.stance : "판단 보류", text: outlookText,
      citations: strings(outlook!.citations), source: "llm" };
    newsSummaries = input.stocks.map((stock, index) => {
      const candidate = row(raw.newsSummaries, stock.code, index), summary = text(candidate?.text);
      if (!summary) return base.newsSummaries![index];
      const citations = strings(candidate?.citations);
      const summaryBasis = citations.some(id => input.articleBodies?.[id]) ? "body" : citations.some(id => input.articleExcerpts?.[id]) ? "excerpt" : "title";
      return { code: stock.code, text: summary, citations, source: "llm", summaryBasis, validation: "off" };
    });
  }
  const stockSummaries = input.stocks.flatMap((stock, index) => {
    const summary = text(row(raw.stockSummaries, stock.code, index)?.text);
    return summary ? [{ code: stock.code, text: summary }] : [];
  });
  const fieldSources = { overview: overview ? "llm" as const : "template" as const, marketNote: marketNote ? "llm" as const : "template" as const };
  const sources = [fieldSources.overview, fieldSources.marketNote, ...stocks.map(stock => stock.source), ...stockOpinions.map(item => item.source),
    ...(marketOutlook ? [marketOutlook.source ?? "template"] : []), ...(newsSummaries ?? []).map(item => item.source ?? "template")];
  const anyLlm = sources.includes("llm"), anyTemplate = sources.includes("template");
  const citations = [...new Set([...strings(raw.citations), ...(overview && marketNote ? [] : base.citations)])];
  return { ...base, overview: overview ?? base.overview, marketNote: marketNote ?? base.marketNote, stocks, fieldSources,
    citations: citations.length ? citations : base.citations, stockOpinions, ...(marketOutlook ? { marketOutlook } : {}), ...(newsSummaries ? { newsSummaries } : {}),
    ...(stockSummaries.length ? { stockSummaries } : {}),
    status: anyLlm ? "llm" : "template", llmModel: anyLlm ? llmModel : null,
    fallbackReason: anyLlm ? anyTemplate ? "partial_template" : null : "invalid_schema", validation: "off" };
}
