import { normalizeSentence, type SentenceCheck, type SentenceContext, type SentenceReason, type SourceOffset } from "./stockSentenceAllowlist";

const endings = ["하였다고", "되었다고", "이었다고", "했습니다", "하였습니다", "되었습니다", "않았다고", "했다고", "된다고", "한다고", "었다고", "았다고", "였다고", "됐다고", "입니다", "됩니다", "합니다", "있습니다", "없습니다", "이라고", "라고", "하였다", "되었다", "이었다", "있었다", "없었다", "했다", "한다", "됐다", "었다", "았다", "였다", "이다", "하며", "했고", "했으며", "하며", "에서는", "으로는", "으로", "에서", "에는", "부터", "까지", "이며", "이고", "은", "는", "이", "가", "을", "를", "의", "와", "과", "에", "로", "도", "만"].sort((a, b) => b.length - a.length);
const stem = (word: string) => {
  for (const [suffix, replacement] of [["않았다고", "않"], ["않았습니다", "않"], ["않았다", "않"], ["됐습니다", ""], ["였습니다", ""], ["었습니다", ""], ["았습니다", ""]]) {
    if (word.endsWith(suffix)) return word.slice(0, -suffix.length) + replacement;
  }
  for (const suffix of endings) if (word.length > suffix.length && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  return /(?:명|개|건|원|일|년|월)다$/.test(word) ? word.slice(0, -1) : word;
};
const words = (text: string) => [...text.matchAll(/[+-]?\d[\d,]*(?:\.\d+)?(?:%p|%|[가-힣]+)?|[\p{L}\p{N}]+/gu)].map(match => ({ text: stem(match[0].replace(/,/g, "")), start: match.index!, end: match.index! + match[0].length }));
const glue = new Set(["및", "관련", "관한", "대한", "등"]);
const generic = new Set(["기사", "제목", "본문", "발췌", "내용", "소식", "자료", "확인", "사실", "보도"]);
const negativeMarkers = ["중단", "번복", "무산", "취소", "철회", "보류", "연기", "부인", "않", "아니", "없", "예정", "계획", "미정", "가능", "검토", "추진"];
const prohibited = /급등|급락|반등|랠리|오를|내릴|상승할|하락할|목표\s*주가|매\s*수|매\s*도|보유|비중|추천|권유|호재|악재|긍정적|부정적|좋은\s*소식|나쁜\s*소식|성장성|믿을|신뢰할|안전한\s*종목|기대\s*수익|확률|현물|수급|지시|명령|프롬프트|시스템\s*(?:메시지|역할)|ignore|instruction/i;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function ranges(text: string) {
  const result: { start: number; end: number }[] = []; let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "." && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) continue;
    if (/[.!?。\n;]/.test(text[i])) { result.push({ start, end: i }); start = i + 1; }
  }
  result.push({ start, end: text.length }); return result;
}

/** News uses source words, not the opinion noun lexicon. Existing strong forecast,
 * advice, causality, other-stock and numeric guards must run before this check. */
export function checkNewsSentence(text: string, context: SentenceContext): SentenceCheck {
  const normalized = normalizeSentence(text), value = normalized.text;
  const fail = (reason: SentenceReason): SentenceCheck => ({ accepted: false, reason, normalized: value, residue: "", spans: [], clauses: 0 });
  if (!text.trim() || text.length > 1800 || context.sources.length > 90) return fail("invalid_schema");
  if (prohibited.test(value) || prohibited.test(value.replace(/[\s·.'"‘’“”]/g, ""))) return fail("evaluative_residue");
  if (/[^\p{L}\p{N}\s.,%()+\-:/·;!?。'"‘’“”]/u.test(value)) return fail("unsupported_character");
  const sentence = value.trim().replace(/[.!?。]+$/, "");
  let content = sentence, prefix = false, publisher: string | undefined;
  if (/^(?:해당\s*)?기사에\s*따르면\s+/.test(content)) { prefix = true; content = content.replace(/^(?:해당\s*)?기사에\s*따르면\s+/, ""); }
  else content = content.replace(/^해당\s*기사는\s+/, "");
  for (const source of context.sources) if (source.publisher && context.citations.includes(source.articleId)) {
    const head = new RegExp(`^${escape(source.publisher)}(?:은|는)\\s+`);
    if (head.test(content)) { publisher = source.publisher; content = content.replace(head, ""); break; }
  }
  const topic = content.match(/^(.+?)(?:을|를)\s*다룬\s*기사(?:입니다|를\s*(?:보도했습니다|전했습니다|실었습니다|게재했습니다|다루었습니다))$/);
  const report = content.match(/^(.+(?:라고|다고))\s*(?:보도했습니다|전했습니다|밝혔습니다|설명했습니다)$/);
  if (topic) content = topic[1];
  else if (report) content = report[1];
  else if (!prefix || !/(?:입니다|했습니다|합니다|됩니다|됐습니다|있습니다|없습니다)$/.test(content)) return fail("missing_attribution");
  const tokens = words(content).filter(word => !glue.has(word.text));
  if (!tokens.length || tokens.every(word => generic.has(word.text))) return fail("no_anchor");
  const completed = /(?:했|하였|됐|되었|였|있었|없었)(?:다고|습니다|다)/.test(content);
  const sources = context.sources.filter(source => context.citations.includes(source.articleId) && (!publisher || source.publisher === publisher) && source.text.length <= 30000);
  if (!sources.length) return fail("invalid_citation");
  let negation = false;
  for (const source of sources) {
    const original = normalizeSentence(source.text), sourceWords = words(original.text);
    for (const range of ranges(original.text)) {
      const local = sourceWords.filter(word => word.start >= range.start && word.end <= range.end);
      for (let start = 0; start < local.length; start++) {
        if (local[start].text !== tokens[0].text) continue;
        const offsets: SourceOffset[] = []; let cursor = start;
        for (const token of tokens) {
          while (cursor < local.length && glue.has(local[cursor].text)) cursor++;
          if (local[cursor]?.text !== token.text) break;
          const word = local[cursor++]; offsets.push({ articleId: source.articleId, sourceKind: source.sourceKind, start: original.offsets[word.start].start, end: original.offsets[word.end - 1].end });
        }
        if (offsets.length !== tokens.length) continue;
        const clause = original.text.slice(range.start, range.end);
        // A nominal headline alone cannot prove that an event was completed.
        if (completed && !/(?:했|하였|됐|되었|였|있었|없었)(?:다고|습니다|다)/.test(clause)) continue;
        if (negativeMarkers.some(marker => clause.includes(marker) && !content.includes(marker))) { negation = true; continue; }
        return { accepted: true, reason: null, normalized: value, residue: "", clauses: 1, spans: [{ start: 0, end: value.length, originalStart: 0, originalEnd: text.length,
          kind: "topic", subject: context.stock.code, field: "news.source_fact", value: tokens.map(word => word.text).join(" "), unit: null, citationIds: [source.articleId], sourceOffsets: offsets }] };
      }
    }
  }
  return fail(negation ? "negation_omitted" : "source_not_grounded");
}
