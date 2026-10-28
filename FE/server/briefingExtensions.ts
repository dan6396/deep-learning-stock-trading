import type { BriefingInput } from "./briefing";
import type { BriefingNarrative } from "./briefingNarrative";
import { forbiddenNarrative, forbiddenCausality, forbiddenInvestmentAdvice, groundedNumbers, MACRO_NAME_ALIASES, spotSupplyContext } from "./briefingValidation";
import { stockOpinions } from "./stockOpinion";
import { articleFactsGrounded } from "./newsFacts";
import { forbiddenStockNewsForecast, mentionsOtherStock, compactPolicyText } from "./stockNewsLanguage";
import { stockSentenceFactKey, uniqueStockSentenceIndices } from "./stockSentenceAllowlist";
import { checkNewsSentence } from "./newsSentenceGrounding";
import { removeArticlePassages } from "./articlePrivacy";
import { newsValidationEnabled } from "./newsValidation";
import { stockSentenceContext } from "./stockSentenceContext";
import { recordStockSentenceRejections } from "./stockSentenceDiagnostics";
import { OUTLOOK_STANCES, type MarketOutlook, type HeadlineSummary } from "../src/types/preOpenMacro";

export const OUTLOOK_CALIBRATION = { conditionalUpPct: 46.6, baselinePct: 50.6,
  note: "팀 재검증에서 직전 나스닥 상승 후 코스피 시가→종가 상승 비율은 46.6%로, 같은 표본의 전체 상승일 비율 50.6%보다 낮았습니다. 이는 일반 방향 일치율이 아닙니다. 장 초반 갭 맥락만 제한적으로 해석하고 장중 수익 방향으로 일반화하지 않습니다.",
  source: "materials/reports/macro-nasdaq-kospi/result.json#briefing_recommendation" } as const;
type Extensions = { marketOutlook?: MarketOutlook; newsSummaries?: HeadlineSummary[]; stockOpinions?: import("../src/types/stockOpinion").StockOpinion[] };
const object = (x: unknown): x is Record<string, any> => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const ids = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.length <= 30 && x.every(v => typeof v === "string");
const content = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 1800;

export function templateExtensions(input: BriefingInput): Extensions {
  const opinions = stockOpinions(undefined, input);
  if (!input.macro.preOpen) return { stockOpinions: opinions };
  const rows = input.macro.preOpen.filter(row => row.status === "ok");
  return { stockOpinions: opinions, marketOutlook: { stance: "판단 보류", text: rows.map(row => row.comment.text).filter(Boolean).join(" ") || "장전 시장 지표를 확보하지 못해 방향 판단을 보류합니다.", citations: rows.map(row => `M:${row.id}`), source: "template" },
    newsSummaries: input.stocks.map(stock => ({ code: stock.code,
      text: stock.news.articles.length ? `관련 기사 ${stock.news.articles.length}건의 제목·출처·발행일을 확인할 수 있습니다. 본문 확보 여부는 기사마다 다를 수 있습니다.` : "확인된 관련 기사 제목이 없습니다.",
      citations: stock.news.articles.map(article => article.id), source: "template" })) };
}

/** Only this field permits market-level direction/causality. Advice stays forbidden. */
export function validateMarketOutlook(value: unknown, input: BriefingInput): string | null {
  return marketOutlookReason(value, input, true);
}

export function marketOutlookCitationIds(input: BriefingInput): string[] {
  return (input.macro.preOpen ?? []).filter(row => row.status === "ok").map(row => `M:${row.id}`);
}

export function marketOutlookReason(value: unknown, input: BriefingInput, requireStance: boolean): string | null {
  if (!object(value) || !OUTLOOK_STANCES.includes(value.stance) || !content(value.text) || !ids(value.citations)
    || Object.keys(value).some(key => !["stance", "text", "citations", "source"].includes(key))) return "invalid_schema";
  const available = new Set(marketOutlookCitationIds(input));
  if (value.citations.some(id => !available.has(id))) return "invalid_citation";
  const normalized = value.text.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
  const compact = normalized.replace(/\s/g, "").toLowerCase();
  if (/(?<!\d)\d{6}(?!\d)/.test(normalized) || input.stocks.some(stock => stock.name && compact.includes(stock.name.normalize("NFKC").replace(/\s/g, "").toLowerCase()))) return "forbidden_content";
  if (/방향\s*일치(?:율|도)/.test(normalized) && /46\.6/.test(normalized)) return "calibration_mismatch";
  // Do not relax instructions about stocks, positions, ranking, targets or guarantees.
  if (forbiddenNarrative(normalized) || forbiddenInvestmentAdvice(normalized) || /호재|악재/.test(normalized)) return "forbidden_content";
  if (spotSupplyContext.test(normalized) && /순\s*매\s*[수도]|수급|매\s*[수도]\s*세/.test(normalized)) return "forbidden_content";
  const futures = input.macro.preOpen?.find(row => row.id === "KOSPI200_FOREIGN_FUTURES" && row.status === "ok");
  if (futures) {
    if (/(?:선물\s*외국인|외국인\s*선물)[^.!?。]{0,30}(?:자료|흐름|데이터|수급)[^.!?。]{0,15}(?:미확인|결측|미제공|미확보|확인되지\s*않|없습니다)/.test(normalized)) return "invalid_availability";
    for (const match of normalized.matchAll(/(\d+)\s*(?:거래일|일)\s*연속\s*순매([수도])/g)) {
      if (Number(match[1]) !== Math.abs(futures.consecutiveDays ?? 0) || Math.sign(futures.consecutiveDays ?? 0) !== (match[2] === "수" ? 1 : -1)) return "ungrounded_number";
    }
    for (const match of normalized.matchAll(/\d+\s*(?:거래일|일)\s*합계(?:는|은|가|:)?\s*([+-]?[\d,]+)\s*계약/g)) {
      if (Math.abs(Number(match[1].replace(/,/g, ""))) !== Math.abs(futures.fiveDaySum ?? NaN)) return "ungrounded_number";
    }
  }
  // Legacy live indicators and model ranks cannot license outlook measurements.
  // Keep their names only, so mentions of unavailable legacy series remain labels.
  const localInput = { ...input, model: null, stocks: [], macro: { ...input.macro, indicators: input.macro.indicators.map(row => ({ ...row, status: "unavailable" as const, value: null, change: null, changePct: null })) } };
  if (!groundedNumbers(normalized, localInput, { outlook: true }) || !locallyGrounded(normalized, localInput)) return "ungrounded_number";
  if (requireStance && !normalized.includes(value.stance) || OUTLOOK_STANCES.some(stance => stance !== value.stance && normalized.includes(stance))) return "stance_mismatch";
  return null;
}

/** A standalone stance is not enough: keep two safe sentences and require the
 * selected stance to survive, then validate the joined field again. */
export function selectMarketOutlook(value: unknown, input: BriefingInput): MarketOutlook | null {
  if (!object(value) || !content(value.text)) return null;
  if (validateMarketOutlook(value, input) === null) return { ...value, source: "llm" } as MarketOutlook;
  const kept = value.text.split(/(?<=[.!?。])\s+/).filter(Boolean)
    .filter(text => marketOutlookReason({ ...value, text }, input, false) === null);
  if (kept.length < 2) return null;
  const candidate = { ...value, text: kept.join(" ") };
  return validateMarketOutlook(candidate, input) === null ? { ...candidate, source: "llm" } as MarketOutlook : null;
}

/** Bind numbers after a named indicator to that indicator, until the next named one.
 * Pronouns, preceding numbers and cross-sentence references cannot be resolved here. */
function locallyGrounded(text: string, input: BriefingInput): boolean {
  for (const sentence of text.split(/(?<=[.!?。])\s+|[;\n]/)) {
    const names = (input.macro.preOpen ?? []).filter(row => row.status === "ok").flatMap(row => [row.name, ...(MACRO_NAME_ALIASES[row.id] ?? [])].map(name => ({ id: row.id, name })));
    const matches: { id: string; start: number; end: number }[] = [];
    for (let offset = 0; offset < sentence.length;) {
      const found = names.map(row => ({ ...row, start: sentence.indexOf(row.name, offset) })).filter(row => row.start >= 0).sort((a, b) => a.start - b.start || b.name.length - a.name.length)[0];
      if (!found) break;
      matches.push({ id: found.id, start: found.start, end: found.start + found.name.length }); offset = found.start + found.name.length;
    }
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index], fragment = sentence.slice(match.start, matches[index + 1]?.start ?? sentence.length);
      if (match.id === "KOSPI200_FOREIGN_FUTURES" && /\d[\d,.]*\s*(?:%|퍼센트|원|억|조|pt|포인트)/i.test(fragment)) return false;
      if (!groundedNumbers(fragment, { ...input, macro: { ...input.macro, preOpen: input.macro.preOpen?.filter(row => row.id === match.id || row.status === "unavailable") } }, { outlook: true })) return false;
    }
  }
  return true;
}

export function validateHeadlineSummary(value: unknown, input: BriefingInput, index: number): string | null {
  if (!newsValidationEnabled(input)) return uncheckedHeadlineSummary(value, input, index) ? null : "invalid_schema";
  const stock = input.stocks[index];
  if (!object(value) || value.code !== stock.code || !content(value.text) || !ids(value.citations)
    || Object.keys(value).some(key => !["code", "text", "citations", "source", "summaryBasis", "sentenceCitations"].includes(key))) return "invalid_schema";
  const allowed = new Set(stock.news.articles.map(article => article.id));
  if (value.citations.some(id => !allowed.has(id))) return "invalid_citation";
  const sentences = value.text.split(/(?<=[.!?。])\s+/).filter(Boolean);
  if (sentences.length < 2 || sentences.length > 3) return "invalid_schema";
  if (value.sentenceCitations !== undefined && (!Array.isArray(value.sentenceCitations) || value.sentenceCitations.length !== sentences.length
    || value.sentenceCitations.some(row => !ids(row) || row.some(id => !allowed.has(id) || !value.citations.includes(id))))) return "invalid_citation";
  for (const [i, sentence] of sentences.entries()) {
    const citations = value.sentenceCitations?.[i] ?? value.citations;
    const reason = headlineSentenceReason(sentence, input, index, citations, citations); if (reason) return reason;
  }
  const checks = sentences.map((sentence, i) => checkNewsSentence(sentence, stockSentenceContext(input, index, "news", value.sentenceCitations?.[i] ?? value.citations)));
  if (new Set(checks.map(stockSentenceFactKey).filter(Boolean)).size < 2) return "insufficient_facts";
  if (uniqueStockSentenceIndices(checks).length !== sentences.length) return "duplicate_sentence";
  return null;
}

export function headlineSentenceReason(text: string, input: BriefingInput, index: number, citations?: string[], anchorCitations = citations ?? input.stocks[index].news.articles.map(article => article.id)): string | null {
  const effectiveCitations = citations ?? anchorCitations;
  const normalized = text.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
  if (forbiddenStockNewsForecast(normalized) || mentionsOtherStock(normalized, input, index)) return "forbidden_content";
  if (forbiddenInvestmentAdvice(normalized)) return "forbidden_content";
  if (/호재|악재|주가.{0,16}(?:상승|하락|반등|전망|예측|뛸|떨어질)|(?:실적|매출|영업이익|순이익).{0,24}(?:예상|전망|예측|기대|좋아질|나빠질|개선될|악화될|늘어날|줄어들|증가할|감소할)/.test(normalized) || forbiddenNarrative(normalized) || forbiddenNarrative(compactPolicyText(normalized)) || forbiddenCausality(normalized)) return "forbidden_content";
  if (spotSupplyContext.test(normalized) && /순\s*매\s*[수도]|수급|매\s*[수도]\s*세/.test(normalized)) return "forbidden_content";
  if (!articleFactsGrounded(normalized, input, index, effectiveCitations)) return "ungrounded_number";
  return checkNewsSentence(normalized, stockSentenceContext(input, index, "news", effectiveCitations)).reason;
}

/** Remove whole unsafe sentences only; never rewrite or weaken numeric/causality rules. */
function uncheckedHeadlineSummary(value: unknown, input: BriefingInput, index: number): HeadlineSummary | null {
  const stock = input.stocks[index];
  if (!object(value) || value.code !== stock.code || !content(value.text)) return null;
  const allowed = new Set(stock.news.articles.map(article => article.id));
  const citations = Array.isArray(value.citations) ? [...new Set<string>(value.citations.filter((id: unknown): id is string => typeof id === "string" && allowed.has(id)))] : [];
  const cachedBasis = value.source === "llm" && value.validation === "off" && ["body", "excerpt", "title"].includes(String(value.summaryBasis)) ? value.summaryBasis : null;
  const summaryBasis = cachedBasis ?? (stock.news.articles.some(article => input.articleBodies?.[article.id]?.text) ? "body" : stock.news.articles.some(article => input.articleExcerpts?.[article.id]?.text) ? "excerpt" : "title");
  return { code: stock.code, text: value.text, citations, source: "llm", validation: "off", summaryBasis };
}

export function selectHeadlineSummary(value: unknown, input: BriefingInput, index: number): HeadlineSummary | null {
  if (!newsValidationEnabled(input)) return uncheckedHeadlineSummary(value, input, index);
  // Cached/recovered candidates use the same sentence privacy policy as a fresh
  // generation, including remapping sentenceCitations after a copied sentence.
  if (object(value) && typeof value.text === "string") {
    const cleaned = removeArticlePassages({ newsSummaries: [value] }, input) as { newsSummaries: unknown[] };
    value = cleaned.newsSummaries[0];
  }
  if (object(value) && value.validation === "off") return null;
  if (!object(value) || typeof value.text !== "string") return null;
  if (value.summaryBasis === "body" && (!Array.isArray(value.citations) || !value.citations.some(id => typeof id === "string" && input.articleBodies?.[id]))) return null;
  if (value.summaryBasis === "excerpt" && (!Array.isArray(value.citations) || !value.citations.some(id => typeof id === "string" && input.articleExcerpts?.[id]))) return null;
  const sentences = value.text.split(/(?<=[.!?。])\s+/).filter(Boolean);
  if (sentences.length > 3) return null;
  if (value.sentenceCitations !== undefined && (!Array.isArray(value.sentenceCitations) || value.sentenceCitations.length !== sentences.length)) return null;
  if (value.sentenceCitations?.some((row: unknown) => !ids(row))) return null;
  const rows = sentences.map((text, i) => ({ text, citations: value.sentenceCitations?.[i] ?? (Array.isArray(value.citations) ? value.citations : []) }));
  const reasons = rows.map(row => headlineSentenceReason(row.text, input, index, row.citations, row.citations ?? (Array.isArray(value.citations) ? value.citations : [])));
  recordStockSentenceRejections("newsSummaries", input.stocks[index].code, reasons);
  const eligible = rows.filter((_row, i) => reasons[i] === null).map(row => ({ ...row, check: checkNewsSentence(row.text, stockSentenceContext(input, index, "news", row.citations)) }));
  const kept = uniqueStockSentenceIndices(eligible.map(row => row.check)).map(i => eligible[i]);
  const candidate: Record<string, any> = { ...value, text: kept.map(row => row.text).join(" "), sentenceCitations: kept.map(row => row.citations) };
  const sources = kept.flatMap(row => row.check.spans.flatMap(span => span.sourceOffsets));
  const bodyUsed = sources.some(source => source.sourceKind === "body");
  const excerptUsed = sources.some(source => source.sourceKind === "excerpt");
  return validateHeadlineSummary(candidate, input, index) === null ? { code: candidate.code, text: candidate.text, citations: candidate.citations,
    ...(candidate.sentenceCitations ? { sentenceCitations: candidate.sentenceCitations } : {}), summaryBasis: bodyUsed ? "body" : excerptUsed ? "excerpt" : "title", source: "llm" } as HeadlineSummary : null;
}

/** Revalidate extensions on every cache policy pass; a bad field cannot erase siblings. */
export function applyNarrativeExtensions(base: BriefingNarrative, value: unknown, input: BriefingInput): BriefingNarrative {
  const candidate = object(value) ? value : {}, fallback = templateExtensions(input);
  base = { ...base, stockOpinions: stockOpinions(candidate.stockOpinions, input) };
  // Optional legacy omissions do not change existing status semantics. Valid new fields
  // still survive even if every older field failed its independent validation.
  const opinionState = (result: BriefingNarrative): BriefingNarrative => base.stockOpinions?.some(row => row.source === "llm")
    ? { ...result, status: "llm", llmModel: base.llmModel,
      fallbackReason: result.status === "template" || base.stockOpinions.some(row => row.source === "template") ? "partial_template" : result.fallbackReason }
    : { ...result, llmModel: result.status === "llm" ? result.llmModel : null };
  if (!input.macro.preOpen) return opinionState(base);
  const outlook = candidate.marketOutlook;
  const selectedOutlook = selectMarketOutlook(outlook, input);
  const outlookReason = selectedOutlook ? null : validateMarketOutlook(outlook, input);
  if (object(outlook) && outlook.source !== "template" && outlookReason) console.warn("[briefing] Extension field fallback", { field: "marketOutlook", reason: outlookReason });
  const marketOutlook = object(outlook) && outlook.source !== "template" && selectedOutlook
    ? selectedOutlook : fallback.marketOutlook!;
  const newsSummaries = input.stocks.map((_stock, index) => {
    const row = Array.isArray(candidate.newsSummaries) ? candidate.newsSummaries[index] : null;
    const selected = selectHeadlineSummary(row, input, index);
    const reason = selected ? null : validateHeadlineSummary(row, input, index);
    if (object(row) && row.source !== "template" && reason) console.warn("[briefing] Extension field fallback", { field: `newsSummaries:${input.stocks[index].code}`, reason });
    return object(row) && row.source !== "template" && selected ? selected : fallback.newsSummaries![index];
  });
  const sources = [base.fieldSources?.overview ?? (base.status === "llm" ? "llm" : "template"), base.fieldSources?.marketNote ?? (base.status === "llm" ? "llm" : "template"),
    ...base.stocks.map(stock => stock.source ?? (base.status === "llm" ? "llm" : "template")), marketOutlook.source, ...newsSummaries.map(row => row.source)];
  const status = sources.includes("llm") ? "llm" : "template";
  return opinionState({ ...base, marketOutlook, newsSummaries, status, llmModel: status === "llm" ? base.llmModel : null,
    fallbackReason: status === "llm" && sources.includes("template") ? "partial_template" : status === "llm" ? null : base.fallbackReason ?? "invalid_schema" });
}

/** New response keys do not weaken the exact legacy shape check for other fields. */
export function baseNarrativeCandidate(value: unknown): unknown {
  if (!object(value)) return value;
  const { marketOutlook: _outlook, newsSummaries: _news, stockOpinions: _opinions, ...base } = value;
  return base;
}
