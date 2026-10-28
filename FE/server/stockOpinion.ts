import type { BriefingInput } from "./briefing";
import type { StockOpinion } from "../src/types/stockOpinion";
import { forbiddenNarrative, forbiddenCausality, forbiddenInvestmentAdvice, groundedNumbers, MACRO_NAME_ALIASES, futuresSupplyClaimsGrounded } from "./briefingValidation";
import { KOSPI200_POOL } from "./kospi200Pool";
import { forbiddenStockNewsForecast, mentionsOtherStock, compactPolicyText, stockPolicyAssertions } from "./stockNewsLanguage";
import { stockFactAnchor } from "./stockFactAnchors";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const normalize = (value: string) => value.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
const compact = (value: string) => normalize(value).replace(/\s/g, "").toLowerCase();
const featureAliases = { f_rsi: ["상대강도 지표", "상대강도", "RSI"], f_pct_b: ["가격 밴드 내 종가 위치", "밴드 내 종가 위치", "밴드 위치"], f_high: ["전일 종가 대비 고가", "종가 대비 고가"] } as const;
export const opinionSentences = (value: string) => value.trim().split(/(?<=[.!?。])\s+|\n+/).filter(Boolean);

function marketFactsGrounded(text: string, input: BriefingInput): boolean {
  const rows = [...input.macro.indicators, ...(input.macro.preOpen ?? [])].filter(row => row.status === "ok");
  const names = rows.flatMap(row => [row.name, ...(MACRO_NAME_ALIASES[row.id] ?? [])].map(name => ({ id: row.id, name })));
  for (const sentence of opinionSentences(text)) {
    const matches: { id: string; start: number; end: number }[] = [];
    for (let offset = 0; offset < sentence.length;) {
      const next = names.map(row => ({ ...row, start: sentence.indexOf(row.name, offset) })).filter(row => row.start >= 0).sort((a, b) => a.start - b.start || b.name.length - a.name.length)[0];
      if (!next) break; matches.push({ id: next.id, start: next.start, end: next.start + next.name.length }); offset = next.start + next.name.length;
    }
    for (const [index, match] of matches.entries()) if (!groundedNumbers(sentence.slice(match.start, matches[index + 1]?.start ?? sentence.length), {
      ...input, model: null, stocks: [], macro: { ...input.macro, indicators: input.macro.indicators.filter(row => row.id === match.id), preOpen: input.macro.preOpen?.filter(row => row.id === match.id) },
    }, { stockOpinion: true })) return false;
  }
  return true;
}

export function stockOpinionCitationIds(input: BriefingInput, index: number): Set<string> {
  const stock = input.stocks[index];
  return new Set([`R:${stock.code}`, ...stock.evidence.filter(row => row.kind !== "supply").map(row => row.id),
    ...(stock.analysisMetrics ? [`R:${stock.code}:raw`, ...(stock.analysisMetrics.adjustedRank === null ? [] : [`R:${stock.code}:adjusted`]), ...stock.analysisMetrics.lookbacks.map(row => `R:${stock.code}:${row.sessions}`), ...stock.analysisMetrics.features.map(row => `E:${stock.code}:feature:${row.key}`)] : []),
    ...stock.cautions.map(row => row.id), ...stock.news.articles.map(row => row.id),
    ...input.macro.indicators.filter(row => row.status === "ok" && row.id !== "SP500").map(row => `M:${row.id}`),
    ...(input.macro.preOpen ?? []).filter(row => row.status === "ok").map(row => `M:${row.id}`)]);
}

/** Never repeat untrusted headlines or arbitrary evidence text in a deterministic fallback. */
export function templateStockOpinion(input: BriefingInput, index: number): StockOpinion {
  const stock = input.stocks[index], score = Number(stock.rankScore.toFixed(4));
  return { code: stock.code, source: "template",
    text: `모집단 ${stock.poolSize}개 중 모델 순위 ${stock.rank}위이며 순위 점수는 ${score}입니다. 입력 근거 ${stock.evidence.filter(row => row.kind !== "supply").length}건·주의 ${stock.cautions.length}건·기사 ${stock.news.articles.length}건이 확인됩니다. 입력 지표는 비교 종목 안에서의 상대적 위치이며 순위의 원인이 아닙니다. 기사 본문 확보 여부는 기사마다 다르며 미확인 자료가 있을 수 있습니다.`,
    citations: [...stockOpinionCitationIds(input, index)].filter(id => !id.startsWith("M:")) };
}

export function stockOpinionSentenceReason(value: string, input: BriefingInput, index: number, citations = stockOpinionCitationIds(input, index)): string | null {
  const stock = input.stocks[index], normalized = normalize(value), dense = compact(value);
  if (forbiddenStockNewsForecast(normalized)) return "forbidden_direction";
  if (mentionsOtherStock(normalized, input, index)) return "other_stock";
  if (!/[가-힣]/.test(normalized) || /내일|앞으로|향후|미래|장차/.test(normalized)) return "forbidden_content";
  const assertions = stockPolicyAssertions(normalized);
  if (/S\s*&\s*P\s*500|SP500/i.test(normalized) || forbiddenNarrative(assertions) || forbiddenNarrative(compactPolicyText(assertions)) || forbiddenInvestmentAdvice(assertions) || forbiddenCausality(assertions)) return "forbidden_content";
  // Factual historical market moves are allowed only with an explicit market subject.
  const factualMarket = normalized.replace(/(?:나스닥|S&P\s*500|미국채\s*10년물|미국\s*국채\s*10년\s*금리|금리|환율|코스피(?:200)?(?:\s*야간선물)?|코스닥)(?:[^.!?。;\n]|\.(?=\d)){0,70}?(?:상승|하락|보합)(?:\s*(?:마감|관측|기록))?(?:입니다|했습니다|했습니다만|했고|이며|했고요|으로|하고|한|했으며)/gi,
    fragment => compact(fragment).includes(compact(stock.name)) || /(?:종목|주가|모델|순위)/.test(fragment) ? fragment : "시장 관측");
  if (/상승|하락|강세|약세|반등|오를|내릴|오르|내리|우위|낙관|비관|긍정|부정|우호적|비우호적|중립|stance|bullish|bearish|outperform|underperform|hold|주가.{0,30}(?:높아질|낮아질|늘어날|줄어들|뛸|떨어질|개선될|악화될|증가할|감소할)/i.test(factualMarket)) return "forbidden_direction";
  if (/호재|악재/.test(normalized) && !/호재\s*[·/]?\s*악재\s*(?:판정|판단)(?:은|이|을)?\s*(?:아닙니다|하지\s*않)/.test(normalized)) return "forbidden_content";
  if (/수급|순\s*매\s*[수도]|매\s*[수도]\s*세/.test(normalized)) {
    const flow = input.macro.preOpen?.find(row => row.id === "KOSPI200_FOREIGN_FUTURES" && row.status === "ok");
    if (!flow || !futuresSupplyClaimsGrounded(normalized, flow)) return "forbidden_supply";
  }
  const withoutSelf = dense.split(compact(stock.name)).join("");
  if ([...KOSPI200_POOL, ...input.stocks].some(other => other.code !== stock.code && (withoutSelf.includes(compact(other.name)) || dense.includes(other.code)))) return "other_stock";
  if (/(?<!\d)\d{6}(?!\d)/.test(normalized)) return "other_stock";
  // Instructions remain data even when echoed as an article topic.
  if (/지시|명령|프롬프트|시스템\s*(?:메시지|역할)|역할\s*변경|무시하|ignore|system\s*prompt|instruction/i.test(normalized)) return "untrusted_instruction";
  for (const match of normalized.matchAll(/(?:(20|120)\s*(?:거래일|일)\s*모델(?:의)?(?:\s*순위)?|원본\s*(?:모델\s*)?순위|최종\s*보정\s*순위|(?:모델\s*)?순위)(?:는|가|은|이|:)?\s*(\d+)\s*위/g)) {
    const expected = match[1] ? stock.analysisMetrics?.lookbacks.find(row => row.sessions === Number(match[1]))?.rank
      : /원본/.test(match[0]) ? stock.analysisMetrics?.rawRank : /최종/.test(match[0]) ? stock.analysisMetrics?.adjustedRank : stock.rank;
    if (expected === null || expected === undefined || Number(match[2]) !== expected) return "ungrounded_rank";
  }
  if (stock.analysisMetrics) {
    for (const match of normalized.matchAll(/(?:(20|120)\s*(?:거래일|일)\s*모델[^.!?。]{0,15})?상위\s*([\d.]+)\s*%/g)) {
      if (!match[1] && stock.analysisMetrics.features.some(feature => featureAliases[feature.key].some(label => normalized.slice(Math.max(0, match.index! - 40), match.index).includes(label)))) continue;
      const expected = match[1] ? stock.analysisMetrics.lookbacks.find(row => row.sessions === Number(match[1]))?.topPercent : stock.topPercent;
      if (expected === undefined || Number(match[2]) !== Number(expected.toFixed((match[2].split(".")[1] ?? "").length))) return "ungrounded_percentile";
    }
    for (const feature of stock.analysisMetrics.features) {
      const label = `(?:${featureAliases[feature.key].map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
      for (const match of normalized.matchAll(new RegExp(`${label}(?:\\s*(?:지표|백분위|위치|는|가|은|:))*\\s*(상위|하위)?\\s*([\\d.]+)\\s*%`, "g"))) {
        const expected = match[1] ? feature.tailPercent : feature.percentile;
        if (match[1] && (match[1] === "상위") !== (feature.side === "upper") || Number(match[2]) !== Number(expected.toFixed((match[2].split(".")[1] ?? "").length))) return "ungrounded_percentile";
      }
    }
    if (/부분\s*일치|불일치|(?<!부분\s)(?<!불)일치/.test(normalized) && /모델|20일|120일/.test(normalized)) {
      const agreement = normalized.match(/부분\s*일치|불일치|일치/)?.[0].replace(/\s/g, "");
      if (agreement !== stock.analysisMetrics.agreement?.replace(/\s/g, "")) return "ungrounded_agreement";
    }
  }
  for (const match of normalized.matchAll(/(?:순위\s*)?점수(?:는|가|:)?\s*([+-]?\d+(?:\.\d+)?)/g)) {
    const precision = (match[1].split(".")[1] ?? "").length;
    if (precision > 4 || Number(match[1]) !== Number(stock.rankScore.toFixed(precision))) return "ungrounded_score";
  }
  for (const match of normalized.matchAll(/(?:모집단|전체)\s*(\d+)\s*개/g)) if (Number(match[1]) !== stock.poolSize) return "ungrounded_pool";
  const counts: Record<string, number> = { 근거: stock.evidence.filter(row => row.kind !== "supply").length, 주의: stock.cautions.length, 기사: stock.news.articles.length };
  for (const match of normalized.matchAll(/(근거|주의|기사)(?:는|가|:)?\s*(\d+)\s*건/g)) if (Number(match[2]) !== counts[match[1]]) return "ungrounded_count";
  // Opinion facts must be independent of private supply and other stocks' numbers.
  const local = { ...input, stocks: [{ ...stock, evidence: stock.evidence.filter(row => row.kind !== "supply") }] };
  if (!groundedNumbers(normalized, local, { stockOpinion: true }) || !marketFactsGrounded(normalized, input)) return "ungrounded_number";
  return stockFactAnchor(normalized, input, index, [...citations]) ? null : "no_anchor";
}

export function validateStockOpinion(value: unknown, input: BriefingInput, index: number): string | null {
  const stock = input.stocks[index];
  if (!object(value) || value.code !== stock.code || typeof value.text !== "string" || !value.text.trim() || value.text.length > 1800
    || Object.keys(value).some(key => !["code", "text", "citations", "source", "generatedAt"].includes(key))) return "invalid_schema";
  const sentences = opinionSentences(value.text);
  if (sentences.length < (stock.analysisMetrics ? 3 : 2) || sentences.length > 6) return "invalid_schema";
  const allowed = stockOpinionCitationIds(input, index);
  if (!Array.isArray(value.citations) || !value.citations.length || value.citations.length > 50 || value.citations.some(id => typeof id !== "string" || !allowed.has(id))) return "invalid_citation";
  // Every summary needs a rank anchor; category mentions also need the matching evidence.
  const citations = value.citations as string[], text = normalize(value.text);
  if (!/순위|\d+\s*위/.test(text)) return "missing_analysis";
  if (!citations.includes(`R:${stock.code}`)
    || /입력\s*근거|근거\s*요약/.test(text) && stock.evidence.some(row => row.kind !== "supply") && !citations.some(id => id.startsWith(`E:${stock.code}:`))
    || /주의|불확실/.test(text) && stock.cautions.length > 0 && !citations.some(id => id.startsWith(`C:${stock.code}:`))
    || /기사|제목/.test(text) && stock.news.articles.length > 0 && !citations.some(id => id.startsWith(`N:${stock.code}:`))) return "invalid_citation";
  for (const row of [...input.macro.indicators, ...(input.macro.preOpen ?? [])]) {
    if ([row.name, ...(MACRO_NAME_ALIASES[row.id] ?? [])].some(name => text.includes(name))
      && (row.status !== "ok" || !citations.includes(`M:${row.id}`))) return "invalid_citation";
  }
  if (stock.analysisMetrics) {
    for (const lb of stock.analysisMetrics.lookbacks) if (new RegExp(`${lb.sessions}\\s*(?:거래일|일)\\s*모델`).test(text) && !citations.includes(`R:${stock.code}:${lb.sessions}`)) return "invalid_citation";
    for (const feature of stock.analysisMetrics.features) if (featureAliases[feature.key].some(label => text.includes(label)) && !citations.includes(`E:${stock.code}:feature:${feature.key}`)) return "invalid_citation";
  }
  return sentences.map(sentence => stockOpinionSentenceReason(sentence, input, index, new Set(citations))).find(Boolean) ?? null;
}

/** New inputs retain at least three factual sentences; legacy caches keep their old minimum. */
export function selectStockOpinion(value: unknown, input: BriefingInput, index: number): StockOpinion | null {
  if (!object(value) || typeof value.text !== "string" || value.text.length > 1800) return null;
  const sentences = opinionSentences(value.text);
  if (sentences.length > 6) return null;
  const citations = new Set<string>(Array.isArray(value.citations) ? value.citations.filter((id): id is string => typeof id === "string") : []);
  const text = sentences.filter(sentence => stockOpinionSentenceReason(sentence, input, index, citations) === null).join(" ");
  const candidate = { ...value, text };
  return validateStockOpinion(candidate, input, index) === null
    ? { code: input.stocks[index].code, text, citations: [...new Set(value.citations as string[])], source: "llm" } : null;
}

export function stockOpinions(value: unknown, input: BriefingInput): StockOpinion[] {
  return input.stocks.slice(0, 5).map((_stock, index) => {
    const row = Array.isArray(value) ? value[index] : undefined;
    const selected = object(row) && row.source !== "template" ? selectStockOpinion(row, input, index) : null;
    if (object(row) && row.source !== "template" && !selected) console.warn("[briefing] Stock opinion field fallback", {
      field: `stockOpinions:${input.stocks[index].code}`, reason: validateStockOpinion(row, input, index),
    });
    return selected || templateStockOpinion(input, index);
  });
}
