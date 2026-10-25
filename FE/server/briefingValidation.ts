import type { BriefingInput } from "./briefing";
import { nextKrxSession } from "./krxCalendar";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const datePattern = /(?<!\d)(?:(\d{4})\s*(?:년\s*|-)(\d{1,2})\s*(?:월\s*|-)(\d{1,2})\s*일?|(\d{1,2})\s*(?:\/|월\s*)(\d{1,2})\s*일?)(?!\d)/g;
const quantityPattern = /[+-]?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?\s*(?:%p|퍼센트포인트|퍼센트|%|KRW|pt|bp|만|억|조|원|주|배|거래일|개|건|위|일|년)?/gi;
function unitOf(token: string): string {
  return token.replace(/^[+-]?[\d,]+(?:\.\d+)?(?:[eE][+-]?\d+)?\s*/i, "").trim().replace(/^KRW$/i, "원")
    .replace(/^퍼센트$/, "%").replace(/^퍼센트포인트$/, "%p").toLowerCase();
}
type Quantity = { value: number; unit: string; precision?: number; decimals?: number; maxDecimals?: number; offset?: number; end?: number; direction?: number; directional?: boolean };
const decimalPlaces = (value: string | number) => {
  const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
  return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent));
};
export function formatMarketValue(value: number, unit: "pt" | "KRW" | "%"): string {
  return `${value.toLocaleString("ko-KR", { minimumFractionDigits: unit === "%" ? 2 : 0, maximumFractionDigits: 2 })}${unit === "KRW" ? "원" : unit}`;
}
export const roundMarketValue = (value: number) => Number(value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 2 }));
export function formatSupplyWon(value: number): string {
  if (Math.abs(value) < 10_000) return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
  let remaining = Math.round(Math.abs(value) / 10_000) * 10_000;
  const parts: string[] = [];
  for (const [size, unit] of [[1e12, "조"], [1e8, "억"], [1e4, "만"]] as const) {
    const count = Math.floor(remaining / size); remaining -= count * size;
    if (count) parts.push(`${count.toLocaleString("ko-KR")}${unit}`);
  }
  return `${value < 0 ? "-" : ""}${parts.join(" ")} 원`;
}
const wonPattern = /(?<![\d,.])([+-]?(?:\d[\d,]*(?:\.\d+)?\s*(?:조|억|만)\s*)+(?:\d[\d,]*(?:\.\d+)?\s*)?)원/g;
function quantities(text: string): Quantity[] | null {
  const values: Quantity[] = [];
  let malformed = false;
  text = text.replace(wonPattern, (whole, amount: string, offset: number) => {
    const sign = amount.trim().startsWith("-") ? -1 : 1;
    let total = 0, previous = Infinity, precision = 1;
    for (const part of amount.replace(/^[+-]/, "").matchAll(/([\d,]+(?:\.\d+)?)\s*(조|억|만)?/g)) {
      const [numeric, unit] = [part[1], part[2]], multiplier = unit === "조" ? 1e12 : unit === "억" ? 1e8 : unit === "만" ? 1e4 : 1;
      if (numeric.includes(",") && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numeric) || multiplier >= previous) malformed = true;
      total += Number(numeric.replace(/,/g, "")) * multiplier;
      precision = multiplier / 10 ** (numeric.split(".")[1]?.length ?? 0);
      previous = multiplier;
    }
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) malformed = true;
    values.push({ value: total * sign, unit: "원", precision, decimals: decimalPlaces(total), offset, end: offset + whole.length });
    // Preserve offsets for shared direction clauses after compound amounts.
    return " ".repeat(whole.length);
  });
  if (malformed) return null;
  for (const match of text.matchAll(quantityPattern)) {
    const raw = match[0].trim(), numeric = raw.match(/^[+-]?[\d,]+(?:\.\d+)?(?:[eE][+-]?\d+)?/i)![0];
    if (numeric.includes(",") && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numeric)) return null;
    const value = Number(numeric.replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    values.push({ value, unit: unitOf(raw), decimals: decimalPlaces(numeric), offset: match.index!, end: match.index! + raw.length });
  }
  return values.sort((left, right) => left.offset! - right.offset!);
}

function assignDirections(text: string, values: Quantity[], directional: (quantity: Quantity) => boolean): void {
  for (const match of text.matchAll(/순매도|순매수|하락|내리|내렸|내림|떨어|약세|상승|오르|올랐|오름|강세/g)) {
    let index = values.length - 1;
    while (index >= 0 && values[index].end! > match.index!) index--;
    if (index < 0 || !directional(values[index]) || !/^(?:\s|[()（）은는이가을를]|각각|동반)*$/.test(text.slice(values[index].end, match.index))) continue;
    const sign = /순매도|하락|내리|내렸|내림|떨어|약세/.test(match[0]) ? -1 : 1;
    values[index].direction = sign;
    while (index > 0 && directional(values[index - 1])) {
      let between = text.slice(values[index - 1].end, values[index].offset);
      // Named supply counterparties are list-item subjects, never a general clause bridge.
      if (values[index - 1].unit === "원" && values[index].unit === "원") between = between.replace(/(?:외국인|기관)(?:은|는|이|가)?/g, "");
      if (!/^(?:\s|[,，·ㆍ、()（）]|와|과|각각)*$/.test(between)) break;
      values[--index].direction = sign;
    }
  }
  // A directly adjacent measured net-selling label also determines the amount's sign.
  for (const quantity of values) if (directional(quantity) && quantity.unit === "원"
    && /순매도\s*(?:합계\s*)?$/.test(text.slice(0, quantity.offset))) quantity.direction = -1;
}

function sameMagnitude(actual: Quantity, expected: Quantity): boolean {
  if (actual.unit !== expected.unit) return false;
  if (expected.maxDecimals !== undefined && (actual.decimals ?? decimalPlaces(actual.value)) > expected.maxDecimals) return false;
  const magnitude = Math.abs(actual.value), known = Math.abs(expected.value), precision = actual.precision;
  return magnitude === known || Array.from({ length: 7 }, (_, decimals) => [Number(known.toFixed(decimals)), Number(known.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: decimals }))]).flat().includes(magnitude)
    || actual.unit === "원" && precision !== undefined && precision <= Math.max(1, known)
      && Math.abs(Math.round(known / precision) * precision - magnitude) < Math.max(1e-6, precision * 1e-9);
}

/** A topic label is allowed; asserting an unprovided supply observation is not. */
export function unpublishedSupplyClaim(text: string): boolean {
  const topic = /(?:순\s*매\s*[수도]|매\s*[수도]\s*세|수급)(?:\s*(?:동향|관련|현황|분석|변화))*\s*(?:기사|뉴스|보도)(?:의\s*주제)?(?:를\s*(?:확인|소개|요약)|가\s*(?:있|확인)|에\s*(?:관한|대한))?/g;
  return text.split(/[.!?。;\n]/).some(clause => {
    if (/(?:순\s*매\s*[수도]|매\s*[수도]\s*세|수급)/.test(clause) && /유입|유출|증가|감소/.test(clause)) return true;
    return /순\s*매\s*[수도]|매\s*[수도]\s*세|(?:외국인|기관)[^.!?。]{0,60}양수|수급[^.!?。]{0,30}(?:유입|유출|증가|감소|양수|통과)/.test(clause.replace(topic, "기사 주제"));
  });
}

/** Dates are calendar facts; clock digits, titles and identifiers cannot license quantities. */
export function groundedNumbers(output: string, input: BriefingInput): boolean {
  if (/(?:KRW|USD)/i.test(output)) return false;
  // An unrelated matching number cannot license an unpublished supply claim.
  if (!input.stocks.some(stock => stock.evidence.some(fact => fact.kind === "supply")) && unpublishedSupplyClaim(output)) return false;
  const dates = new Set<string>(), monthDays = new Set<string>(), allowed: Quantity[] = [];
  const quarterTopics = new Set<string>();
  const addDate = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(/\d{4}-\d{2}-\d{2}/g)) if (validDate(match[0])) {
      dates.add(match[0]); monthDays.add(`${Number(match[0].slice(5, 7))}/${Number(match[0].slice(8, 10))}`);
    }
  };
  const removeDates = (value: string, validate: boolean): string | null => {
    let okay = true;
    const stripped = value.replace(datePattern, (_whole, year, month, day, shortMonth, shortDay) => {
      const m = Number(month ?? shortMonth), d = Number(day ?? shortDay);
      const canonical = year ? `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : `${m}/${d}`;
      if (validate && !(year ? dates.has(canonical) : monthDays.has(canonical))) okay = false;
      return " ";
    });
    return okay ? stripped : null;
  };
  const add = (value: number | null, unit: string, directional = false, maxDecimals = value === null ? 0 : decimalPlaces(value)) => {
    if (value === null || !Number.isFinite(value)) return;
    allowed.push({ value, unit: unit.toLowerCase(), directional, maxDecimals });
    if (unit === "일") allowed.push({ value, unit: "거래일", maxDecimals });
    if (unit === "거래일") allowed.push({ value, unit: "일", maxDecimals });
  };
  addDate(input.model?.baseDate); addDate(input.model?.runStartedAt); addDate(input.macro.asOf);
  if (input.model) addDate(nextKrxSession(input.model.baseDate));
  addDate(input.macro.context?.usSessionDate); addDate(input.macro.context?.targetSessionNote);
  for (const indicator of input.macro.indicators) {
    addDate(indicator.asOf);
    if (indicator.status !== "ok") continue;
    const unit = indicator.unit === "KRW" ? "원" : indicator.unit;
    const measured = (value: number | null, outputUnit: string, directional = false) => {
      const rounded = value === null ? null : roundMarketValue(value);
      add(value, outputUnit, directional, outputUnit === "%" ? 2 : rounded === null ? 0 : decimalPlaces(rounded));
    };
    measured(indicator.value, unit); measured(indicator.change, unit, true); measured(indicator.changePct, "%", true);
  }
  add(input.model?.poolSize ?? null, "개");
  add(input.stocks.length, "개");
  for (const stock of input.stocks) {
    add(stock.rank, "위"); add(stock.rankScore, "", false, Math.min(4, decimalPlaces(stock.rankScore))); add(stock.poolSize, "개"); add(Number(stock.topPercent.toFixed(2)), "%", false, 2);
    add(stock.news.articles.length, "건");
    for (const article of stock.news.articles) {
      addDate(article.pubDate);
      for (const quarter of article.title.matchAll(/[1-4]\s*분기/g)) quarterTopics.add(quarter[0].replace(/\s/g, ""));
      for (const quarter of article.title.matchAll(/\b(?:([1-4])Q(?:\d{2,4})?|Q([1-4])(?:\s*\d{2,4})?)\b/gi)) quarterTopics.add(`${quarter[1] ?? quarter[2]}분기`);
    }
    for (const fact of [...stock.evidence, ...stock.cautions]) {
      addDate(fact.text);
      if (fact.kind === "news") continue;
      // Only deterministic factual texts, never article titles/source/name/URL.
      const stripped = removeDates(fact.text, false)!;
      const measured = quantities(stripped) ?? [];
      assignDirections(stripped, measured, quantity => fact.kind === "supply" && quantity.unit === "원");
      for (const quantity of measured) add(quantity.direction === undefined ? quantity.value : Math.abs(quantity.value) * quantity.direction, quantity.unit, fact.kind === "supply" && quantity.unit === "원");
    }
  }
  let stripped = removeDates(output, true);
  if (stripped === null || /\d{1,2}:\d{2}/.test(stripped)) return false;
  // Numeric brand/index names are labels, not measurements.
  for (const name of [...input.stocks.map(stock => stock.name), ...input.macro.indicators.map(indicator => indicator.name)].sort((left, right) => right.length - left.length)) {
    if (name) stripped = stripped.split(name).join(name.replace(/\d/g, " "));
  }
  // A cited article's quarter is a topic label, never a free numeric allowance.
  stripped = stripped.replace(/([1-4])\s*분기/g, (whole, quarter) => quarterTopics.has(`${quarter}분기`) ? " " : whole);
  stripped = stripped.replace(new RegExp(`TOP\\s*${input.stocks.length}(?!\\d)`, "gi"), " ");
  const outputQuantities = quantities(stripped);
  if (outputQuantities === null) return false;
  const isDirectional = (quantity: Quantity) => {
    if (!allowed.some(expected => expected.directional && sameMagnitude(quantity, expected))) return false;
    const before = stripped.slice(0, quantity.offset).trimEnd();
    if (/상위\s*$/.test(before)) return false;
    // A named indicator followed by its observed level is not a change measurement,
    // even when the same magnitude also occurs among changes elsewhere in the input.
    return !input.macro.indicators.some(indicator => indicator.status === "ok" && indicator.value !== null
      && before.endsWith(indicator.name.replace(/\d/g, " ").trimEnd())
      && sameMagnitude(quantity, { value: indicator.value, unit: indicator.unit === "KRW" ? "원" : indicator.unit }));
  };
  assignDirections(stripped, outputQuantities, isDirectional);
  return outputQuantities.every(quantity => allowed.some(expected => sameMagnitude(quantity, expected)
    && (quantity.direction === undefined ? quantity.value >= 0 || expected.value <= 0 : expected.directional && Math.sign(expected.value) === quantity.direction)));
}

const disclaimerNoun = String.raw`(?:상승\s*확률|(?:기대|예측|예상)\s*수익률|수익률|확\s*률|매\s*[수도](?:\s*(?:권유|의견|추천))?|투자\s*권유|추천|권유|의견|(?:수익\s*)?보장|예측|전망|목표\s*(?:주\s*)?가|적정\s*주가|비\s*중|원인|영향)`;
const directDisclaimer = new RegExp(String.raw`${disclaimerNoun}(?:\s*(?:과|와|이나|나|·)\s*${disclaimerNoun})*(?:\s*(?:은|는|이|가|을|를|에))*\s*(?:의미\s*하지\s*않|나타내지\s*않|아닙니다|아님|아니며|보장\s*하지\s*않|해당\s*하지\s*않|주지\s*않)`, "g");
function hasUnnegatedPhrase(text: string, unsafe: RegExp): boolean {
  for (const clause of text.split(/[.!?。;\n,，]|하지만|그러나|다만|반면|지만/)) {
    // Exempt complete coordinated noun phrases, including overlapping unsafe matches.
    const negated = /아니라/.test(clause) ? [] : [...clause.matchAll(directDisclaimer)]
      .filter(match => { const tail = clause.slice(match.index! + match[0].length); return /^\s*으며\s/.test(tail) || !/아니|아닙|아님|않|없/.test(tail); });
    for (const match of clause.matchAll(unsafe)) {
      if (!negated.some(denial => denial.index! <= match.index! && denial.index! + denial[0].length >= match.index! + match[0].length)) return true;
    }
  }
  return false;
}
export function forbiddenCausality(text: string): boolean {
  // An explicitly named article topic is not a claim that a stock benefits.
  const topics = text.replace(/수혜\s*업종\s*(?:관련\s*)?(?:기사|뉴스)/g, "기사 주제");
  const factual = topics.replace(/(?:을|를)\s*반영(?:해|하여)\s*(?:요약|정리|기록|설명|표시|갱신|작성)(?:했|하|합|되)[가-힣]*/g, "자료 정리");
  return hasUnnegatedPhrase(factual, /때문|덕분|영향|견인|기여|원인|따라서|이므로|인해|힘입어|수혜|(?:을|를)\s*반영(?:해|하여)|오를|내릴|상승할|하락할|상승\s*여력|\b(?:cause\w*|because|therefore|will\s+(?:rise|fall))\b/gi);
}

/** Preserve measured supply descriptions while excluding transaction advice. */
export function forbiddenNarrative(text: string): boolean {
  const factualSupply = text.replace(/순\s*매\s*[수도](?!\s*(?:하|해|권|추천|의견|타이밍))|매\s*[수도]\s*세/g, "수급");
  const unsafe = /유망|진입\s*적기|주목할\s*만|담아\s*볼|매력적|기회|모멘텀\s*지속|저가\s*매수|목표\s*(?:주\s*)?가|적정\s*주가|비\s*중|매\s*[수도]|추\s*천|확\s*률|(?:기대|예측|예상)\s*수익률?|수익\s*보장|상승\s*가능성|투자\s*권유|(?:주가|가격|목표|수익률?|상승|하락|반등|급등|오를|내릴).{0,6}(?:전망|예상|예측|기대)|(?:전망|예상|예측|기대).{0,6}(?:주가|가격|목표|수익률?|상승|하락|반등|급등|오를|내릴)|\b(?:buy|sell|recommend\w*|target\s*price|allocat\w*|probabilit\w*|expected\s*return)\b/gi;
  return hasUnnegatedPhrase(factualSupply, unsafe);
}
