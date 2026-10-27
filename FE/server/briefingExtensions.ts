import type { BriefingInput } from "./briefing";
import type { BriefingNarrative } from "./briefingNarrative";
import { forbiddenNarrative, forbiddenCausality, groundedNumbers, MACRO_NAME_ALIASES, spotSupplyContext } from "./briefingValidation";
import { OUTLOOK_STANCES, type MarketOutlook, type HeadlineSummary } from "../src/types/preOpenMacro";

export const OUTLOOK_CALIBRATION = { conditionalUpPct: 46.6, baselinePct: 50.6,
  note: "팀 재검증에서 직전 나스닥 상승 후 코스피 시가→종가 상승 비율은 46.6%로, 같은 표본의 전체 상승일 비율 50.6%보다 낮았습니다. 이는 일반 방향 일치율이 아닙니다. 장 초반 갭 맥락만 제한적으로 해석하고 장중 수익 방향으로 일반화하지 않습니다.",
  source: "materials/reports/macro-nasdaq-kospi/result.json#briefing_recommendation" } as const;
type Extensions = { marketOutlook?: MarketOutlook; newsSummaries?: HeadlineSummary[] };
const object = (x: unknown): x is Record<string, any> => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const ids = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.length <= 30 && x.every(v => typeof v === "string");
const content = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 1800;

export function templateExtensions(input: BriefingInput): Extensions {
  if (!input.macro.preOpen) return {};
  const rows = input.macro.preOpen.filter(row => row.status === "ok");
  return { marketOutlook: { stance: "판단 보류", text: rows.length ? rows.map(row => row.comment.text).join(" ") : "장전 시장 지표를 확보하지 못해 방향 판단을 보류합니다.", citations: rows.map(row => `M:${row.id}`), source: "template" },
    newsSummaries: input.stocks.map(stock => ({ code: stock.code,
      text: stock.news.articles.length ? `관련 기사 ${stock.news.articles.length}건의 제목·출처·발행일을 확인할 수 있습니다. 기사 본문은 수집하지 않았습니다.` : "확인된 관련 기사 제목이 없습니다.",
      citations: stock.news.articles.map(article => article.id), source: "template" })) };
}

/** Only this field permits market-level direction/causality. Advice stays forbidden. */
export function validateMarketOutlook(value: unknown, input: BriefingInput): string | null {
  if (!object(value) || !OUTLOOK_STANCES.includes(value.stance) || !content(value.text) || !ids(value.citations)
    || Object.keys(value).some(key => !["stance", "text", "citations", "source"].includes(key))) return "invalid_schema";
  const available = new Set((input.macro.preOpen ?? []).filter(row => row.status === "ok").map(row => `M:${row.id}`));
  if (value.citations.some(id => !available.has(id))) return "invalid_citation";
  const normalized = value.text.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
  const compact = normalized.replace(/\s/g, "").toLowerCase();
  if (/(?<!\d)\d{6}(?!\d)/.test(normalized) || input.stocks.some(stock => stock.name && compact.includes(stock.name.normalize("NFKC").replace(/\s/g, "").toLowerCase()))) return "forbidden_content";
  if (/방향\s*일치(?:율|도)/.test(normalized) && /46\.6/.test(normalized)) return "calibration_mismatch";
  // Do not relax instructions about stocks, positions, ranking, targets or guarantees.
  const prohibited = /목표\s*(?:주\s*)?가|적정\s*주가|권\s*(?:유|합|해|고)|(?:사는|파는|담는)\s*것|(?<![가-힣])보\s*장(?=$|[^가-힣]|[은는이가을를의도만]|합|하|해|받|되|된|됩)|수익\s*보장|순위\s*(?:재정렬|변경|조정)|(?:기대|예상|예측)\s*수익|\b(?:guarantee\w*)\b/i;
  if (forbiddenNarrative(normalized) || prohibited.test(normalized) || /호재|악재/.test(normalized)) return "forbidden_content";
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
  if (!normalized.includes(value.stance) || OUTLOOK_STANCES.some(stance => stance !== value.stance && normalized.includes(stance))) return "stance_mismatch";
  return null;
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
  const stock = input.stocks[index];
  if (!object(value) || value.code !== stock.code || !content(value.text) || !ids(value.citations)
    || Object.keys(value).some(key => !["code", "text", "citations", "source"].includes(key))) return "invalid_schema";
  const allowed = new Set(stock.news.articles.map(article => article.id));
  if (value.citations.some(id => !allowed.has(id))) return "invalid_citation";
  const sentences = value.text.split(/(?<=[.!?。])\s+/).filter(Boolean);
  if (sentences.length < 2 || sentences.length > 3) return "invalid_schema";
  return headlineSentenceReason(value.text, input, index);
}

export function headlineSentenceReason(text: string, input: BriefingInput, index: number): string | null {
  const normalized = text.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
  if (/호재|악재|주가.{0,10}(?:상승|하락|반등|전망|예측)/.test(normalized) || forbiddenNarrative(normalized) || forbiddenCausality(normalized)) return "forbidden_content";
  return groundedNumbers(normalized, { ...input, stocks: [input.stocks[index]] }) ? null : "ungrounded_number";
}

/** Remove whole unsafe sentences only; never rewrite or weaken numeric/causality rules. */
export function selectHeadlineSummary(value: unknown, input: BriefingInput, index: number): HeadlineSummary | null {
  if (!object(value) || typeof value.text !== "string") return null;
  const sentences = value.text.split(/(?<=[.!?。])\s+/).filter(Boolean);
  if (sentences.length > 3) return null;
  const kept = sentences.filter(text => headlineSentenceReason(text, input, index) === null);
  const candidate = { ...value, text: kept.join(" ") };
  return validateHeadlineSummary(candidate, input, index) === null ? { ...candidate, source: "llm" } as HeadlineSummary : null;
}

/** Revalidate extensions on every cache policy pass; a bad field cannot erase siblings. */
export function applyNarrativeExtensions(base: BriefingNarrative, value: unknown, input: BriefingInput): BriefingNarrative {
  if (!input.macro.preOpen) return base;
  const candidate = object(value) ? value : {}, fallback = templateExtensions(input);
  const outlook = candidate.marketOutlook;
  const outlookReason = validateMarketOutlook(outlook, input);
  if (object(outlook) && outlook.source !== "template" && outlookReason) console.warn("[briefing] Extension field fallback", { field: "marketOutlook", reason: outlookReason });
  const marketOutlook = object(outlook) && outlook.source !== "template" && !outlookReason
    ? { ...outlook, source: "llm" as const } as MarketOutlook : fallback.marketOutlook!;
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
  return { ...base, marketOutlook, newsSummaries, status, llmModel: status === "llm" ? base.llmModel : null,
    fallbackReason: status === "llm" && sources.includes("template") ? "partial_template" : status === "llm" ? null : base.fallbackReason ?? "invalid_schema" };
}

/** New response keys do not weaken the exact legacy shape check for other fields. */
export function baseNarrativeCandidate(value: unknown): unknown {
  if (!object(value)) return value;
  const { marketOutlook: _outlook, newsSummaries: _news, ...base } = value;
  return base;
}
