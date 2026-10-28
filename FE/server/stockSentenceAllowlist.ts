/** Pure additional language gate. No fetching, persistence, logging, or clock reads.
 * The existing numeric/advice/supply/citation validators remain mandatory. */
export type SentenceSource = { articleId: string; sourceKind: "title" | "excerpt" | "body"; text: string; publisher?: string };
type Metrics = { rawRank: number | null; adjustedRank: number | null; lookbacks: readonly { sessions: number; rank: number; topPercent: number }[];
  agreement: string | null; features: readonly { key: string; percentile: number; side: string; tailPercent: number }[] };
export type SentenceContext = {
  field: "opinion" | "news"; stock: { code: string; name: string; rank: number; poolSize: number; topPercent: number; rankScore: number;
    evidence: readonly { id: string; kind: string; text?: string }[]; cautions: readonly { id: string; text: string }[]; analysisMetrics?: Metrics };
  citations: readonly string[]; sources: readonly SentenceSource[]; articleCount: number; baseDate?: string; today?: string;
  /** Only server-registered entities; never derive these from an untrusted article. */
  trustedTopicEntities?: readonly string[];
  market?: readonly { id: string; name: string; status: string; value: number | null; change: number | null; changePct: number | null; unit: string;
    fiveDayChange?: number | null; fiveDaySum?: number | null; consecutiveDays?: number; asOf?: string | null }[];
};
export type SentenceReason = "evaluative_residue" | "topic_not_neutral" | "topic_not_grounded" | "topic_not_local" | "publisher_mismatch"
  | "unsupported_predicate" | "unsupported_clause" | "ambiguous_span" | "unsupported_character" | "no_anchor" | "ungrounded_fact" | "invalid_citation" | "invalid_schema"
  | "source_not_grounded" | "negation_omitted" | "missing_attribution";
export type SourceOffset = { articleId: string; sourceKind: SentenceSource["sourceKind"]; start: number; end: number };
export type FactSpan = { start: number; end: number; kind: string; subject: string; field: string; value: string | number | null; unit: string | null;
  citationIds: string[]; sourceOffsets: SourceOffset[]; originalStart: number; originalEnd: number };
export type SentenceCheck = { accepted: boolean; reason: SentenceReason | null; spans: FactSpan[]; normalized: string; residue: string; clauses: number };

const PARTICLES = ["에서는", "으로는", "에게서", "이라고", "이며", "으로", "에서", "로는", "에는", "은", "는", "이", "가", "을", "를", "의", "와", "과", "에", "로"] as const;
const NOUNS = new Set("출시 개방 서비스 공개 중소기업 대출 건전성 충당금 부담 배당 실적 발표 3분기 분기 신종자본증권 자본증권 발행 브랜드 계약 주주환원 연장 계열사 쇼핑 행사 인사 상품권 증정 점포 상품 입점 경영진 결정 순이익 계열 분리 동향 유통가 신규 신발 그룹 정기 관리 규모 연체 상황 연계 신제품 공시 플랫폼 개편 운영 현황 신사업 투자협약 체결 매출 참여 기업 일정".split(" "));
const GLUE = new Set(["및", "관련", "관한", "대한", "등", "에"]);
for (const noun of ["구독", "이용자", "수", "우주선", "발사"]) NOUNS.add(noun);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const number = "([+-]?\\d[\\d,]*(?:\\.\\d+)?)";
const numeric = (s: string) => Number(s.replace(/,/g, ""));
const close = (actual: string, expected: number | null | undefined, precision = 4) => expected != null && Number.isFinite(expected)
  && (actual.split(".")[1]?.length ?? 0) <= precision && numeric(actual) === Number(expected.toFixed(actual.split(".")[1]?.length ?? 0));

export const STOCK_SENTENCE_POLICY_VERSION = "2026-10-28-source-grounded-news-v13";
const FIXED_FORMS = [
  "순위 점수는 수익률이나 확률을 의미하지 않습니다", "순위 점수는 수익률이나 확률을 의미하지 않으며",
  "순위 점수는 기대수익이 아니며", "순위 점수는 수익률이 아니며", "순위 점수는 확률적 수익을 뜻하지 않으며", "순위 점수는 예측 수익률이 아니며",
  "순위는 수익률 예측이 아니며 기대수익을 의미하지 않습니다", "이 지표는 종목 간 비교에 활용할 수 있습니다", "시장 지표는 별도로 확인할 수 있습니다", "주가 예측이 아닙니다",
  "방향 판단은 하지 않습니다", "기사 본문 확보 여부는 기사마다 다릅니다", "기사 본문 확보 여부는 기사마다 다르며 미확인 자료가 있을 수 있습니다",
  "입력 지표는 비교 종목 안에서의 상대적 위치이며 순위의 원인이 아닙니다", "비교 종목 안의 상대적 위치입니다",
  "본 기사 내용은 제목 기반으로 확인된 사항입니다",
].sort((a, b) => b.length - a.length);

/** Registry values are complete surface forms, not arbitrary stem/suffix products. */
export const STOCK_SENTENCE_FORMS = {
  topicNouns: [...NOUNS], fixedExplanations: FIXED_FORMS,
  copula: ["입니다", "이며", "이고"], observation: ["확인됩니다", "확인되며", "확인되었습니다", "확인했습니다", "기록했습니다", "기록했고", "기록했으며", "위치합니다", "위치하며", "집계되었습니다", "제공되었습니다"],
  attribution: ["입니다", "이며", "를 보도했습니다", "를 전했습니다", "를 실었습니다", "를 게재했습니다", "를 다루었습니다"],
  examples: ["모집단 {pool}개 중 모델 순위 {rank}위이며 순위 점수는 {score}입니다.", "20일 모델 순위는 {rank20}위이며 120일 모델 순위는 {rank120}위입니다.",
    "20일·120일 모델은 {agreement} 상태입니다.", "{featureLabel} 백분위는 {percentile}%입니다.", "입력 근거 {evidenceCount}건·주의 {cautionCount}건·기사 {articleCount}건이 확인됩니다.",
    "{marketLabel} 전일 대비 {signedChange}{unit}입니다.", "외국인 선물 최근 5거래일 합계 {signedFiveDaySum}계약입니다.",
    "해당 기사는 {approvedTopic}를 다룬 기사입니다.", "{publisher}는 {approvedTopic}를 다룬 기사를 보도했습니다.", "순위 점수는 수익률이나 확률을 의미하지 않습니다."],
} as const;

/** NFKC expansions retain offsets into the original input; removed zero-width
 * characters never cause neighboring words to be joined by substring deletion. */
export function normalizeSentence(text: string): { text: string; offsets: { start: number; end: number }[] } {
  let result = ""; const offsets: { start: number; end: number }[] = [];
  for (let start = 0; start < text.length;) {
    let end = start + String.fromCodePoint(text.codePointAt(start)!).length;
    while (end < text.length && (/\p{M}/u.test(String.fromCodePoint(text.codePointAt(end)!))
      || /[\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u.test(text[start]) && /[\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u.test(text[end]))) end += String.fromCodePoint(text.codePointAt(end)!).length;
    const part = text.slice(start, end).normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
    result += part; for (let i = 0; i < part.length; i++) offsets.push({ start, end }); start = end;
  }
  return { text: result, offsets };
}
function particleOkay(stem: string, suffix: string): boolean {
  const code = stem.charCodeAt(stem.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return true;
  const final = code % 28;
  if (["은", "이", "을", "과"].includes(suffix)) return final !== 0;
  if (["는", "가", "를", "와"].includes(suffix)) return final === 0;
  if (suffix === "으로") return final !== 0 && final !== 8;
  if (suffix === "로") return final === 0 || final === 8;
  return true;
}
function stripParticle(word: string): string {
  for (const suffix of PARTICLES) if (word.length > suffix.length && word.endsWith(suffix) && particleOkay(word.slice(0, -suffix.length), suffix)) return word.slice(0, -suffix.length);
  return word;
}
function words(text: string) { return [...text.matchAll(/[+-]?\d[\d,]*(?:\.\d+)?(?:억원|만원|원|계약|명|건|개|%)[가-힣]*|[가-힣A-Za-z0-9]+/g)].map(m => ({ text: m[0].replace(/,/g, ""), start: m.index!, end: m.index! + m[0].length })); }

const entityMeaningRisk = /긍정|부정|우량|탁월|우수|유망|안전|매력|신뢰|성장|경쟁력|급등|급락|상승|하락|강세|약세|호재|악재|전망|예상|예측|기대|추천|매수|매도|취소|중단|철회|번복|미정|부인|불가|아니|않|없|높|낮|좋|나쁘|bullish|bearish|growth|upside|downside|safe|superior|excellent|reliable|positive|negative/i;
/** A closed noun lexicon plus narrowly typed, source-backed proper-name slots.
 * Article words never become nouns merely because they occur in a source. */
function sourceEntity(token: string, source: SentenceSource): boolean {
  if (token.length < 2 || token.length > 40 || /[성력감세]$/.test(token) || entityMeaningRisk.test(token)) return false;
  const quoted = [['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"], ["(", ")"]].some(([open, close]) => source.text.normalize("NFKC").includes(open + token + close));
  const mixedName = /[A-Za-z]/.test(token) && /[0-9가-힣]/.test(token);
  const institution = /(?:그룹|은행|증권|금융|전자|홀딩스|지주|공사|센터|청|시|점)$/.test(token);
  return quoted || mixedName || institution;
}

/** Source sentence boundaries preserve decimal/date punctuation and Latin initials. */
function sourceRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []; let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "." && (/\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "") || /[A-Za-z]/.test(text[i - 1] ?? "") && /[A-Za-z.]/.test(text[i + 1] ?? ""))) continue;
    if (/[.!?。\n;]/.test(text[i])) { ranges.push({ start, end: i }); start = i + 1; }
  }
  ranges.push({ start, end: text.length }); return ranges;
}

export function neutralTopicReason(topic: string, context: SentenceContext, publishers: readonly string[] = []): { reason: SentenceReason | null; sourceOffsets: SourceOffset[]; citationIds: string[] } {
  const bad = (reason: SentenceReason) => ({ reason, sourceOffsets: [], citationIds: [] });
  if (topic.length > 80 || /[^가-힣A-Za-z0-9\s·,]/.test(topic)) return bad("topic_not_neutral");
  const neutral = new Set([...NOUNS, ...(context.trustedTopicEntities ?? [])]);
  const tokens = words(topic).map(w => neutral.has(w.text) || GLUE.has(w.text) ? w.text : stripParticle(w.text));
  const sources = context.sources.filter(s => context.citations.includes(s.articleId) && s.text.length <= 10000).slice(0, 90);
  const proper = tokens.filter(t => !neutral.has(t) && !GLUE.has(t) && !["와", "과"].includes(t) && !/^[+-]?\d+(?:\.\d+)?(?:억원|만원|원|계약|명|건|개|%)$/.test(t));
  if (tokens.length > 12 || new Set(proper).size !== proper.length || proper.some(t => !sources.some(source => sourceEntity(t, source)))) return bad("topic_not_neutral");
  const content = tokens.filter(t => !GLUE.has(t) && !["와", "과"].includes(t));
  if (!content.length) return bad("no_anchor");
  const groups = publishers.length ? publishers.map(p => sources.filter(s => s.publisher === p)) : [sources];
  const offsets: SourceOffset[] = [], ids = new Set<string>();
  for (const group of groups) {
    if (!group.length) return bad(publishers.length ? "publisher_mismatch" : "invalid_citation");
    let match: { source: SentenceSource; positions: SourceOffset[] } | undefined, localFailure = false;
    for (const source of group) {
      if (proper.some(token => !sourceEntity(token, source))) continue;
      const normalized = normalizeSentence(source.text);
      const allWords = words(normalized.text);
      // Retain an exact word OR a single permitted suffix removal, never a substring.
      const fits = (candidate: string, actual: string) => actual === candidate || stripParticle(actual) === candidate
        || ["발표", "공개", "발행", "체결", "결정"].includes(candidate) && ["했습니다", "했으며", "했고", "한"].some(ending => actual === candidate + ending);
      if (content.every(t => allWords.some(w => fits(t, w.text)))) localFailure = true;
      const ranges = source.sourceKind === "title" ? [{ start: 0, end: normalized.text.length }] : sourceRanges(normalized.text);
      for (const range of ranges) {
        const local = allWords.filter(w => w.start >= range.start && w.end <= range.end); let cursor = 0;
        const positions: SourceOffset[] = [];
        for (const token of content) {
          const at = local.findIndex((w, i) => i >= cursor && fits(token, w.text)); if (at < 0) break;
          // Never skip a negation, cancellation or any other substantive word.
          if (positions.length && local.slice(cursor, at).some(word => !GLUE.has(stripParticle(word.text)) && !["와", "과"].includes(word.text))) break;
          const word = local[at]; positions.push({ articleId: source.articleId, sourceKind: source.sourceKind,
            start: normalized.offsets[word.start].start, end: normalized.offsets[word.end - 1].end }); cursor = at + 1;
        }
        if (positions.length === content.length) { match = { source, positions }; break; }
      }
      if (match) break;
    }
    if (!match) return bad(localFailure ? "topic_not_local" : "topic_not_grounded");
    ids.add(match.source.articleId); offsets.push(...match.positions);
  }
  return { reason: null, sourceOffsets: offsets, citationIds: [...ids] };
}

type Clause = { end: number; spans: FactSpan[]; connective: boolean; reason?: SentenceReason };
const COPULA = `(?:${STOCK_SENTENCE_FORMS.copula.map(escape).join("|")})`;
const OBSERVATION = `(?:${STOCK_SENTENCE_FORMS.observation.map(escape).join("|")})`;
const ARTICLE_ATTRIBUTION = `(?:${STOCK_SENTENCE_FORMS.attribution.map(form => escape(form).replace(/\s+/g, "\\s*")).join("|")})`;

export function checkStockSentence(text: string, context: SentenceContext): SentenceCheck {
  const normalized = normalizeSentence(text), value = normalized.text, spans: FactSpan[] = [];
  const usedProperNames = new Set<string>();
  let cursor = 0, clauses = 0, connective = false, ended = false;
  const fail = (reason: SentenceReason): SentenceCheck => ({ accepted: false, reason, spans, normalized: value, residue: value.slice(cursor), clauses });
  if (!text.trim() || text.length > 1800 || context.sources.length > 90) return fail("invalid_schema");
  if (/[^가-힣A-Za-z0-9\s.,%()+\-:/·;!?。'"‘’“”]/.test(value)) return fail("unsupported_character");
  const stock = context.stock, has = (id: string) => context.citations.includes(id);
  const make = (start: number, end: number, kind: string, field: string, fact: string | number | null, unit: string | null, ids: readonly string[] = [], sources: SourceOffset[] = []): FactSpan => ({ start, end, kind, subject: stock.code, field, value: fact, unit, citationIds: [...ids], sourceOffsets: sources,
    originalStart: normalized.offsets[start]?.start ?? text.length, originalEnd: normalized.offsets[end - 1]?.end ?? text.length });
  const match = (pattern: string) => value.slice(cursor).match(new RegExp("^(?:" + pattern + ")"));
  const simple = (pattern: string, kind: string, field: string, expected: number | null | undefined, citation: string, unit: string, precision = 4): Clause | undefined => {
    const m = match(pattern + "(?:은|는|이|가|을|를)?\\s*(?:" + COPULA + "|(?:를\\s*)?" + OBSERVATION + ")"); if (!m) return;
    const valid = close(m[1], expected, precision); const end = cursor + m[0].length;
    return { end, spans: [make(cursor, end, kind, field, valid ? numeric(m[1]) : null, unit, [citation])], connective: /(?:이며|이고|되며|했고|했으며|하며)$/.test(m[0]), reason: !valid ? "ungrounded_fact" : !has(citation) ? "invalid_citation" : undefined };
  };
  function parseTopic(): Clause | undefined {
    const rest = value.slice(cursor);
    const forms = [
      new RegExp(`^(.*?)를\\s*다룬\\s*기사${ARTICLE_ATTRIBUTION}`),
      new RegExp(`^(.*?)을\\s*다룬\\s*기사${ARTICLE_ATTRIBUTION}`),
      /^(?:기사\s*)?(?:제목\s*기준으로|제목\s*기준|제목을\s*통해|제목상)\s+(.+?)\s+(?:관련\s*사실을|사실이|내용을|사실을)\s*(?:확인했습니다|확인되었습니다|파악되었습니다)/,
      /^(.+?)\s+(?:관련\s*기사|관련\s*\d+건의\s*기사)\s*\d*\s*건?(?:이|가)?\s*입력\s*근거로\s*(?:확인되었습니다|집계되었습니다)/,
      /^(.+?)\s+등\s*\d+건의\s*보도\s*내역이\s*입력\s*근거로\s*제공되었습니다/,
      /^(.*?)을\s*(?:발표|공개|발행|체결|결정)했다고\s*보도했습니다/,
      /^(.*?)를\s*(?:발표|공개|발행|체결|결정)했다고\s*보도했습니다/,
    ];
    for (const pattern of forms) {
      const m = rest.match(pattern); if (!m) continue;
      let topic = m[1], publishers: string[] = [];
      if (topic.startsWith("해당 기사는 ")) topic = topic.slice("해당 기사는 ".length);
      else {
        const subject = topic.match(/^(.+?)(?:은|는)\s+(.+)$/);
        if (subject) { publishers = subject[1].split(/과\s+|와\s+/); topic = subject[2]; }
      }
      // An event verb must itself occur in the same source clause as the object.
      const event = m[0].match(/(발표|공개|발행|체결|결정)했다고\s*보도했습니다$/);
      const result = neutralTopicReason(event ? topic + " " + event[1] : topic, context, publishers), end = cursor + m[0].length;
      if (event && !result.reason) {
        // An event noun in a title does not prove an event happened (공개 취소).
        // Initially support only an exact, affirmative source clause, including
        // its object/particle and completed predicate, with an optional own entity.
        const literal = new RegExp(`^(?:${escape(stock.name)}(?:은|는)\\s*)?${escape(topic).replace(/\s+/g, "\\s+")}(?:을|를)\\s*${event[1]}(?:했습니다|했다|했으며|했고)$`);
        const proofs = result.citationIds.map(id => context.sources.filter(s => s.articleId === id).flatMap(source => /않|아니|아닙|아님|취소|철회|예정|계획|미정/.test(source.text) ? [] : sourceRanges(source.text).filter(range => literal.test(source.text.slice(range.start, range.end).normalize("NFKC").trim())).map(range => ({ articleId: id, sourceKind: source.sourceKind, ...range })))[0]);
        const supported = proofs.every(Boolean);
        if (!supported) return { end, connective: false, spans: [], reason: "unsupported_predicate" };
        result.sourceOffsets = proofs;
      }
      const properNames = words(topic).map(word => stripParticle(word.text)).filter(word => !NOUNS.has(word) && !GLUE.has(word) && !context.trustedTopicEntities?.includes(word) && !/^\d/.test(word));
      if (!result.reason && properNames.some(word => usedProperNames.has(word))) return { end, connective: false, spans: [], reason: "unsupported_clause" };
      if (!result.reason) for (const word of properNames) usedProperNames.add(word);
      const topicKey = words(topic).map(word => stripParticle(word.text)).filter(word => !GLUE.has(word)).join(" ");
      return { end, connective: /이며$/.test(m[0]), spans: result.reason ? [] : [make(cursor, end, "topic", "article.topic", topicKey, null, result.citationIds, result.sourceOffsets)], reason: result.reason ?? undefined };
    }
    return;
  }
  while (cursor < value.length) {
    if (/\s/.test(value[cursor])) { cursor++; continue; }
    if (/[.!?。;]/.test(value[cursor])) {
      if (!ended || connective) return fail("unsupported_clause"); cursor++; ended = false; continue;
    }
    // A terminal sentence may be followed by another complete clause, even without whitespace.
    const start = cursor; let candidate: Clause | undefined;
    for (const form of FIXED_FORMS) if (value.startsWith(form, cursor)) {
      candidate = { end: cursor + form.length, spans: [make(cursor, cursor + form.length, "fixed", "explanation", form, null)], connective: /이며$|아니며$|않으며$/.test(form) }; break;
    }
    if (!candidate) {
      const body = match("(?:기사\\s*)?본문은\\s*(?:수집되지\\s*않았으며|미수집\\s*상태이며|미수집\\s*상태로|확인되지\\s*않았고|수집하지\\s*않았습니다)");
      if (body) {
        const bodyAvailable = context.sources.some(s => s.sourceKind === "body" && has(s.articleId) && s.text.trim());
        candidate = { end: cursor + body[0].length, spans: [make(cursor, cursor + body[0].length, "availability", "article.body", "unavailable", null)], connective: !body[0].endsWith("습니다"), reason: bodyAvailable ? "ungrounded_fact" : undefined };
      }
    }
    if (!candidate) {
      const own = match(`(?:${[stock.name, ...(context.trustedTopicEntities ?? [])].map(escape).join("|")})(?:은|는|의)\\s*`);
      if (own) { spans.push(make(cursor, cursor + own[0].length, "entity", "stock.name", stock.name, null)); cursor += own[0].length; continue; }
      const rank = match("(?:(?:모집단|전체)?\\s*(\\d+)개(?:\\s*종목)?\\s*(?:중|가운데)\\s*)?(?:모델\\s*(?:순위\\s*)?|순위\\s*)(?:는|가|은)?\\s*(\\d+)위(?:\\s*\\(상위\\s*([\\d.]+)%\\))?(?:(?:를\\s*)?(?:기록했고|기록했습니다|기록했으며)|" + COPULA + ")");
      if (rank) {
        const valid = (!rank[1] || Number(rank[1]) === stock.poolSize) && Number(rank[2]) === stock.rank && (!rank[3] || close(rank[3], stock.topPercent, 2));
        candidate = { end: cursor + rank[0].length, spans: [make(cursor, cursor + rank[0].length, "model", "rank", valid ? stock.rank : null, "위", [`R:${stock.code}`])], connective: /이며$|이고$|했고$|했으며$/.test(rank[0]), reason: !valid ? "ungrounded_fact" : !has(`R:${stock.code}`) ? "invalid_citation" : undefined };
      }
    }
    if (!candidate) candidate = simple("(?:순위\\s*)?점수(?:는|가|:)?\\s*" + number, "model", "rankScore", stock.rankScore, `R:${stock.code}`, "score");
    if (!candidate) {
      const comparison = match("20일\\s*모델\\s*순위\\s*(\\d+)위이고\\s*120일\\s*모델\\s*순위\\s*(\\d+)위로\\s*두\\s*모델은\\s*(부분\\s*일치|불일치|일치)합니다");
      if (comparison) {
        const metrics = stock.analysisMetrics, ids = [`R:${stock.code}:20`, `R:${stock.code}:120`];
        const valid = metrics?.lookbacks.find(lb => lb.sessions === 20)?.rank === Number(comparison[1]) && metrics?.lookbacks.find(lb => lb.sessions === 120)?.rank === Number(comparison[2]) && metrics?.agreement === comparison[3];
        candidate = { end: cursor + comparison[0].length, spans: [make(cursor, cursor + comparison[0].length, "model", "lookbackComparison", comparison[3], null, ids)], connective: false, reason: !valid ? "ungrounded_fact" : ids.some(id => !has(id)) ? "invalid_citation" : undefined };
      }
    }
    if (!candidate) for (const lb of stock.analysisMetrics?.lookbacks ?? []) {
      candidate = simple(`${lb.sessions}\\s*(?:거래일|일)\\s*모델(?:은|는)?\\s*순위(?:는|가)?\\s*(\\d+)위`, "model", `rank${lb.sessions}`, lb.rank, `R:${stock.code}:${lb.sessions}`, "위")
        ?? simple(`${lb.sessions}\\s*(?:거래일|일)\\s*모델(?:은|는)?\\s*상위\\s*([\\d.]+)%`, "model", `top${lb.sessions}`, lb.topPercent, `R:${stock.code}:${lb.sessions}`, "%", 2);
      if (candidate) break;
    }
    if (!candidate) for (const [label, field, expected] of [["원본(?:\\s*모델)?", "raw", stock.analysisMetrics?.rawRank], ["최종\\s*보정", "adjusted", stock.analysisMetrics?.adjustedRank]] as const) {
      candidate = simple(`${label}\\s*순위(?:는|가)?\\s*(\\d+)위`, "model", field, expected, `R:${stock.code}:${field}`, "위"); if (candidate) break;
    }
    if (!candidate) {
      const warning = match("(?:일부\\s*(?:입력\\s*)?자료는\\s*미확인입니다|주의\\s*\\d+건이\\s*있으며\\s*일부\\s*입력\\s*자료는\\s*미확인입니다)");
      if (warning) {
        const supported = stock.cautions.some(c => /일부.{0,8}자료.{0,15}(?:미확인|확인하지\s*못)/.test(c.text));
        const count = warning[0].match(/주의\s*(\d+)건/);
        candidate = { end: cursor + warning[0].length, spans: [make(cursor, cursor + warning[0].length, "fixed", "input.caution", null, null)], connective: false,
          reason: supported && (!count || Number(count[1]) === stock.cautions.length) ? undefined : "ungrounded_fact" };
      }
    }
    if (!candidate) {
      const agreement = match("(?:20일[·와\\s]+120일|두)\\s*모델(?:은|이|는)?\\s*(부분\\s*일치|불일치|일치)(?:\\s*상태)?(?:입니다|이며|합니다|하며)");
      if (agreement) {
        const citationIds = [`R:${stock.code}:20`, `R:${stock.code}:120`];
        candidate = { end: cursor + agreement[0].length, spans: [make(cursor, cursor + agreement[0].length, "model", "agreement", agreement[1], null, citationIds)], connective: /이며$|하며$/.test(agreement[0]), reason: agreement[1].replace(/\s/g, "") !== stock.analysisMetrics?.agreement?.replace(/\s/g, "") ? "ungrounded_fact" : citationIds.some(id => !has(id)) ? "invalid_citation" : undefined };
      }
    }
    if (!candidate) for (const feature of stock.analysisMetrics?.features ?? []) {
      const labels: Record<string, string> = { f_rsi: "(?:상대강도(?:\\s*지표)?|RSI)", f_pct_b: "(?:가격\\s*밴드\\s*내\\s*종가\\s*위치|밴드\\s*위치)", f_high: "(?:전일\\s*종가\\s*대비\\s*고가)" };
      if (!labels[feature.key]) continue;
      const f = match(labels[feature.key] + "(?:의)?\\s*(?:위치\\s*)?(?:백분위)?(?:는|은|가)?\\s*(상위|하위)?\\s*([\\d.]+)%(?:에)?\\s*(?:입니다|이며|위치합니다|위치하며)"); if (!f) continue;
      const expected = f[1] ? feature.tailPercent : feature.percentile, id = `E:${stock.code}:feature:${feature.key}`;
      candidate = { end: cursor + f[0].length, spans: [make(cursor, cursor + f[0].length, "feature", feature.key + (f[1] ? ".tail" : ".percentile"), expected, "%", [id])], connective: /이며$|하며$/.test(f[0]), reason: !close(f[2], expected, 2) || f[1] && (f[1] === "상위") !== (feature.side === "upper") ? "ungrounded_fact" : !has(id) ? "invalid_citation" : undefined }; break;
    }
    if (!candidate) {
      const count = match("(?:입력\\s*)?(?:(?:근거|주의|기사)\\s*\\d+건[·\\s]*)+(?:이|가|을)?\\s*(?:확인됩니다|확인했습니다|확인되었습니다|집계되었습니다)");
      if (count) {
        const counts: Record<string, number> = { 근거: stock.evidence.filter(f => f.kind !== "supply").length, 주의: stock.cautions.length, 기사: context.articleCount };
        const facts = [...count[0].matchAll(/(근거|주의|기사)\s*(\d+)건/g)], valid = facts.every(m => counts[m[1]] === Number(m[2]));
        const categoryIds: Record<string, string[]> = { 근거: stock.evidence.filter(f => f.kind !== "supply").map(f => f.id), 주의: stock.cautions.map(c => c.id), 기사: [...new Set(context.sources.map(s => s.articleId))] };
        const groundedCitations = facts.every(m => Number(m[2]) === 0 || categoryIds[m[1]].some(has));
        const ids = [...new Set(facts.flatMap(m => categoryIds[m[1]].filter(has)))];
        candidate = { end: cursor + count[0].length, spans: [make(cursor, cursor + count[0].length, "count", "input.counts", null, "건", ids)], connective: false, reason: !valid ? "ungrounded_fact" : !groundedCitations ? "invalid_citation" : undefined };
      }
    }
    if (!candidate && context.baseDate) {
      const date = match("모델\\s*기준일(?:은|이)?\\s*\\(?" + escape(context.baseDate) + "\\)?(?:입니다|이며)?");
      if (date) candidate = { end: cursor + date[0].length, spans: [make(cursor, cursor + date[0].length, "date", "model.baseDate", context.baseDate, null)], connective: !date[0].endsWith("입니다") };
      const mismatch = match("(?:과\\s*당일의\\s*시점\\s*차이가\\s*있습니다|기준일과\\s*당일\\s*일자\\s*간\\s*불일치가\\s*존재합니다|모델\\s*기준일과\\s*당일\\s*간\\s*시점\\s*차이가\\s*있습니다|기준일\\s*차이가\\s*있습니다)");
      if (!candidate && mismatch) candidate = { end: cursor + mismatch[0].length, spans: [make(cursor, cursor + mismatch[0].length, "date", "baseDateMismatch", context.baseDate, null)], connective: false,
        reason: context.today && context.today !== context.baseDate || stock.cautions.some(c => /기준일.{0,30}오늘.{0,15}다릅니다/.test(c.text)) ? undefined : "ungrounded_fact" };
    }
    if (!candidate) for (const row of context.market ?? []) {
      const aliases: Record<string, string[]> = { NASDAQ: ["나스닥"], SOX: ["필라델피아 반도체 지수", "필라델피아 반도체", "반도체 지수", "SOX"], UST10Y: ["미 국채 10년물", "미 10년물", "미국 국채 10년 금리", "금리"], USDKRW: ["원/달러", "원·달러 환율", "환율"], KOSPI200_FOREIGN_FUTURES: ["선물 외국인", "외국인 선물", "코스피200 선물 외국인 순매수"] };
      if (row.status !== "ok" || !aliases[row.id]) continue;
      const label = `(?:${[row.name, ...aliases[row.id]].map(escape).join("|")})(?:은|는|이|가)?\\s*`;
      const flow = match(label + "(?:최근\\s*)?(\\d+)\\s*(?:거래일|일)\\s*연속\\s*순매([수도])(?:입니다|이며)");
      if (flow) {
        const valid = Number(flow[1]) === Math.abs(row.consecutiveDays ?? NaN) && Math.sign(row.consecutiveDays ?? NaN) === (flow[2] === "수" ? 1 : -1);
        candidate = { end: cursor + flow[0].length, spans: [make(cursor, cursor + flow[0].length, "market", row.id + ".consecutiveDays", row.consecutiveDays ?? null, "일", [`M:${row.id}`])], connective: /이며$/.test(flow[0]), reason: !valid ? "ungrounded_fact" : !has(`M:${row.id}`) ? "invalid_citation" : undefined }; break;
      }
      const m = match(label + "(?:(전일\\s*대비|최근\\s*5거래일\\s*합계|5일\\s*합계|5일\\s*변화|직전일)\\s*)?" + number + "\\s*(%p|%|bp|pt|원|계약)(?:\\s*(상승|하락|보합|순매수|순매도))?(?:\\s*마감)?(?:입니다|이며|마감했습니다|했습니다)");
      if (!m) continue;
      const field = /합계/.test(m[1] ?? "") ? "fiveDaySum" : /5일/.test(m[1] ?? "") ? "fiveDayChange" : m[3] === "%p" || m[3] === "bp" ? "change" : m[3] === "%" && row.unit !== "%" ? "changePct" : /전일/.test(m[1] ?? "") ? "change" : "value";
      const expected = row[field], direction = /하락|순매도/.test(m[4] ?? "") ? -1 : /상승|순매수/.test(m[4] ?? "") ? 1 : m[4] === "보합" ? 0 : undefined;
      const canonicalUnit = row.unit === "KRW" ? "원" : row.unit;
      const unitValid = field === "changePct" ? m[3] === "%" : field === "change" && row.unit === "%" ? ["%p", "bp"].includes(m[3]) : m[3] === canonicalUnit;
      const target = typeof expected === "number" ? (m[3] === "bp" ? expected * 100 : expected) : null;
      const valid = !(field === "value" && direction !== undefined) && unitValid && close(m[2], direction === undefined || target === null ? target : Math.abs(target), row.unit === "%" ? 3 : 2) && (direction === undefined || Math.sign(target ?? NaN) === direction);
      candidate = { end: cursor + m[0].length, spans: [make(cursor, cursor + m[0].length, "market", `${row.id}.${field}`, target, m[3], [`M:${row.id}`])], connective: /이며$/.test(m[0]), reason: !valid ? "ungrounded_fact" : !has(`M:${row.id}`) ? "invalid_citation" : undefined }; break;
    }
    if (!candidate) candidate = parseTopic();
    if (!candidate) return fail("evaluative_residue");
    if (candidate.reason) return fail(candidate.reason);
    if (context.field === "news" && candidate.spans.some(s => !["topic", "fixed", "availability"].includes(s.kind))) return fail("unsupported_clause");
    if (candidate.end <= start || ++clauses > 20) return fail("ambiguous_span");
    spans.push(...candidate.spans); cursor = candidate.end; connective = candidate.connective; ended = !connective;
  }
  if (connective) return fail("unsupported_clause");
  if (!spans.some(s => s.kind !== "entity")) return fail("no_anchor");
  return { accepted: true, reason: null, spans, normalized: value, residue: "", clauses };
}

export const stockSentenceAllowlistReason = (text: string, context: SentenceContext) => checkStockSentence(text, context).reason;
export const collectFactSpans = (text: string, context: SentenceContext) => checkStockSentence(text, context).spans;

/** Fixed explanations cannot fill a factual minimum; surface/publisher variants
 * of the same topic or fact share one identity. No source text is returned. */
export function stockSentenceFactKey(check: SentenceCheck): string | null {
  const facts = check.spans.filter(span => !["entity", "fixed"].includes(span.kind));
  return check.accepted && facts.length ? JSON.stringify(facts.map(({ kind, field, value, unit }) => ({ kind, field, value, unit }))) : null;
}
export function uniqueStockSentenceIndices(checks: readonly SentenceCheck[]): number[] {
  const seen = new Set<string>(), kept: number[] = [];
  for (const [index, check] of checks.entries()) {
    if (!check.accepted) continue;
    const key = stockSentenceFactKey(check) ?? check.normalized.trim().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    const topics = check.spans.filter(span => span.kind === "topic");
    if (topics.length === 1 && check.spans.filter(span => !["entity", "fixed"].includes(span.kind)).length === 1 && kept.some(i => {
      const previous = checks[i].spans.filter(span => span.kind === "topic");
      if (previous.length !== 1 || checks[i].spans.filter(span => !["entity", "fixed"].includes(span.kind)).length !== 1) return false;
      const left = ` ${topics[0].value} `, right = ` ${previous[0].value} `;
      return left.includes(right) || right.includes(left);
    })) continue;
    seen.add(key); kept.push(index);
  }
  return kept;
}
