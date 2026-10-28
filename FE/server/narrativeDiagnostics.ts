import { createHash } from "node:crypto";
import type { BriefingInput } from "./briefing";
import { textReason, stockReason, type BriefingNarrative } from "./briefingNarrative";
import { opinionSentences, stockOpinionSentenceReason, validateStockOpinion } from "./stockOpinion";
import { headlineSentenceReason, validateHeadlineSummary, marketOutlookReason, marketOutlookCitationIds } from "./briefingExtensions";
import { checkStockSentence, stockSentenceFactKey, uniqueStockSentenceIndices, STOCK_SENTENCE_POLICY_VERSION } from "./stockSentenceAllowlist";
import { stockSentenceContext } from "./stockSentenceContext";
import { checkNewsSentence } from "./newsSentenceGrounding";
import { createArticlePassageGuard } from "./articlePrivacy";
import { rejectedNumericTokens } from "./briefingValidation";

const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Explicit projection only. Never return model sentences, article titles, body or
 * excerpt strings, source offsets, URLs, directory paths or provider responses. */
export function narrativeGenerationDiagnostics(value: unknown, input: BriefingInput, result: BriefingNarrative, at: number, failure?: string) {
  const raw = object(value), passages = createArticlePassageGuard(input);
  const citationDiagnostics = (values: unknown, allowed: string[]) => {
    const known = new Set([...input.macro.indicators, ...(input.macro.preOpen ?? [])].map(row => `M:${row.id}`));
    const submitted = Array.isArray(values) ? values : [];
    return { allowed, submittedKnownIds: [...new Set(submitted.filter((id): id is string => typeof id === "string" && known.has(id)))],
      invalidKnownIds: [...new Set(submitted.filter((id): id is string => typeof id === "string" && known.has(id) && !allowed.includes(id)))],
      unrecognized: submitted.filter(id => typeof id !== "string" || !known.has(id)).map(id => ({ type: typeof id, length: typeof id === "string" ? id.length : null, hash: hash(typeof id === "string" ? id : typeof id) })) };
  };
  const fields: Record<string, unknown>[] = input.stocks.flatMap((stock, index) => (["stockOpinions", "newsSummaries"] as const).map(field => {
    const row = object(Array.isArray(raw[field]) ? raw[field][index] : null), text = typeof row.text === "string" ? row.text : "";
    const sentences = opinionSentences(text), citations = Array.isArray(row.citations) ? row.citations.filter((id: unknown): id is string => typeof id === "string") : [];
    const kind = field === "stockOpinions" ? "opinion" : "news";
    const selected = (field === "stockOpinions" ? result.stockOpinions : result.newsSummaries)?.find(row => row.code === stock.code);
    const accepted = selected?.source === "llm", finalSentences = accepted && selected ? opinionSentences(selected.text) : [];
    const available = { title: stock.news.articles.length, excerpt: stock.news.articles.filter(article => input.articleExcerpts?.[article.id]?.text).length,
      body: stock.news.articles.filter(article => input.articleBodies?.[article.id]?.text).length };
    if (kind === "news" && input.newsValidation !== "on") return {
      field, code: stock.code, source: selected?.source ?? "template", validation: "off", fieldReason: accepted ? null : failure ?? "invalid_schema",
      modelSentenceCount: sentences.length, eligibleFactCount: null, acceptedSentenceCount: finalSentences.length, minimumFacts: 0,
      summaryBasis: object(selected).summaryBasis ?? "title", available, usedSourceCounts: null,
      sentences: sentences.slice(0, 20).map((sentence, i) => ({ sentence: i + 1, length: sentence.length, hash: hash(sentence), reason: "validation_disabled", accepted: accepted && finalSentences.includes(sentence) })),
    };
    const privatePassages = passages.stats(text), passageBlocked = privatePassages.matchCount > 0;
    const checks = sentences.map((sentence, i) => {
      const ids = Array.isArray(row.sentenceCitations?.[i]) ? row.sentenceCitations[i].filter((id: unknown): id is string => typeof id === "string") : citations;
      const reason = kind === "opinion" ? stockOpinionSentenceReason(sentence, input, index, new Set(citations)) : headlineSentenceReason(sentence, input, index, ids, ids);
      const context = stockSentenceContext(input, index, kind, ids);
      return { reason, check: kind === "news" ? checkNewsSentence(sentence, context) : checkStockSentence(sentence, context) };
    });
    const eligible = checks.map(({ check, reason }) => ({ ...check, accepted: reason === null && check.accepted }));
    const unique = new Set(uniqueStockSentenceIndices(eligible));
    const facts = [...unique].filter(i => stockSentenceFactKey(eligible[i]) !== null);
    const remaining = [...finalSentences];
    const adopted = sentences.map(sentence => { const at = remaining.indexOf(sentence); if (at < 0) return false; remaining.splice(at, 1); return true; });
    const used = checks.filter((_row, i) => adopted[i]).flatMap(row => row.check.spans.flatMap(span => span.sourceOffsets));
    const min = kind === "opinion" && stock.analysisMetrics ? 3 : 2;
    const validationReason = failure ?? (kind === "opinion" ? validateStockOpinion(row, input, index) : validateHeadlineSummary(row, input, index));
    return { field, code: stock.code, source: selected?.source ?? "template", fieldReason: accepted ? null : failure ?? (passageBlocked ? "private_passage" : facts.length < min ? "min_sentences" : validationReason ?? "field_validation_failed"),
      modelSentenceCount: sentences.length, eligibleFactCount: facts.length, acceptedSentenceCount: finalSentences.length, minimumFacts: min,
      summaryBasis: kind === "news" && accepted ? object(selected).summaryBasis ?? "title" : "not_applicable", available,
      privatePassages,
      usedSourceCounts: { title: new Set(used.filter(row => row.sourceKind === "title").map(row => row.articleId)).size, excerpt: new Set(used.filter(row => row.sourceKind === "excerpt").map(row => row.articleId)).size, body: new Set(used.filter(row => row.sourceKind === "body").map(row => row.articleId)).size },
      sentences: sentences.slice(0, 20).map((sentence, i) => ({ sentence: i + 1, length: sentence.length, hash: hash(sentence),
        reason: passages.stats(sentence).matchCount ? "private_passage" : checks[i].reason ?? (!unique.has(i) ? "duplicate_sentence" : stockSentenceFactKey(checks[i].check) === null ? "fixed_explanation" : null),
        privatePassages: passages.stats(sentence), rejectedNumericTokens: checks[i].reason === "ungrounded_number" ? rejectedNumericTokens(sentence, { ...input, stocks: [stock] }, { stockOpinion: kind === "opinion" }) : [], accepted: adopted[i] })),
    };
  }));
  const baseFields = [
    ...(["overview", "marketNote"] as const).map(field => ({ field, code: null, text: typeof raw[field] === "string" ? raw[field] : "", selected: result[field],
      source: result.fieldSources?.[field] ?? (result.status === "llm" ? "llm" : "template"), reason: textReason(raw[field], input, field === "overview"),
      sentenceReason: (text: string) => textReason(text, input) })),
    ...input.stocks.map((stock, index) => { const row = object(Array.isArray(raw.stocks) ? raw.stocks[index] : null); return {
      field: "stocks", code: stock.code, text: typeof row.summary === "string" ? row.summary : "", selected: result.stocks[index]?.summary ?? "", source: result.stocks[index]?.source ?? "template",
      reason: stockReason(row, input, index), sentenceReason: (text: string) => stockReason({ ...row, summary: text }, input, index) }; }),
    ...(input.macro.preOpen ? [{ field: "marketOutlook", code: null, text: typeof object(raw.marketOutlook).text === "string" ? object(raw.marketOutlook).text : "", selected: result.marketOutlook?.text ?? "",
      source: result.marketOutlook?.source ?? "template", reason: marketOutlookReason(raw.marketOutlook, input, true), sentenceReason: (text: string) => marketOutlookReason({ ...object(raw.marketOutlook), text }, input, false) }] : []),
  ];
  for (const row of baseFields) {
    const sentences = opinionSentences(row.text), final = row.source === "llm" ? opinionSentences(row.selected) : [];
    const privatePassages = passages.stats(row.text), privatePassage = privatePassages.matchCount > 0;
    const localInput = row.code ? { ...input, stocks: input.stocks.filter(stock => stock.code === row.code) } : input;
    const numericOptions = row.field === "marketOutlook" ? { outlook: true } : {};
    fields.push({ field: row.field, code: row.code, source: row.source, fieldReason: row.source === "llm" ? null : failure ?? (privatePassage ? "private_passage" : row.reason ?? "field_validation_failed"),
      privatePassages, ...(row.field === "marketOutlook" ? { citationDiagnostics: citationDiagnostics(object(raw.marketOutlook).citations, marketOutlookCitationIds(input)) } : {}),
      modelSentenceCount: sentences.length, acceptedSentenceCount: final.length, sentences: sentences.slice(0, 20).map((sentence, i) => ({ sentence: i + 1, length: sentence.length, hash: hash(sentence), reason: passages.stats(sentence).matchCount ? "private_passage" : row.sentenceReason(sentence),
        privatePassages: passages.stats(sentence), rejectedNumericTokens: row.sentenceReason(sentence) === "ungrounded_number" ? rejectedNumericTokens(sentence, localInput, numericOptions) : [], accepted: final.includes(sentence) })) });
  }
  return { version: 1, policyVersion: STOCK_SENTENCE_POLICY_VERSION, generatedAt: new Date(at).toISOString(), inputHash: result.inputHash,
    generationStatus: failure ?? "completed", excerptLookup: input.articleExcerptLookupStats ?? null, fields };
}
