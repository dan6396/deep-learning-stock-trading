import { createHash } from "node:crypto";
import type { BriefingInput } from "./briefing";
import { cachedArticleBodies } from "./articleBodies";
import { cachedArticleExcerpts, articleExcerptLookup } from "./articleExcerpts";
import { newsValidationEnabled } from "./newsValidation";
export function articleBodyHashes(input: BriefingInput): Record<string, string> {
  return input.articleBodies === undefined ? input.articleBodyHashes ?? {} : Object.fromEntries(Object.entries(input.articleBodies).map(([id, body]) => [id, createHash("sha256").update(body.text).digest("hex")]));
}
export function articleExcerptHashes(input: BriefingInput): Record<string, string> {
  return input.articleExcerpts === undefined ? input.articleExcerptHashes ?? {} : Object.fromEntries(Object.entries(input.articleExcerpts).map(([id, excerpt]) => [id, createHash("sha256").update(excerpt.text).digest("hex")]));
}
export function hasPrivateArticleContext(input: BriefingInput): boolean {
  return Object.keys(articleBodyHashes(input)).length > 0 || Object.keys(articleExcerptHashes(input)).length > 0;
}
/** Cache-only. The caller decides whether to require a saved hash match. */
export async function cachedArticleContext(input: BriefingInput, directory: string) {
  const articleExcerptLookupStats = articleExcerptLookup(input.stocks, directory);
  return { articleBodies: await cachedArticleBodies(input.stocks, directory), articleExcerpts: cachedArticleExcerpts(input.stocks, directory), articleExcerptLookupStats };
}
/** Short terms/quotes remain usable. Drop only sentences containing a contiguous
 * 40-character private-source copy; never discard an unrelated surviving sentence. */
export function createArticlePassageGuard(input: BriefingInput) {
  const passages = new Set<string>(), size = 40, normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ");
  for (const source of [...Object.values(input.articleBodies ?? {}), ...Object.values(input.articleExcerpts ?? {})]) {
    const text = normalize(source.text);
    for (let index = 0; index + size <= text.length; index++) passages.add(text.slice(index, index + size));
  }
  const spans = (raw: string) => {
    const text = normalize(raw), result: { start: number; end: number }[] = [];
    if (!passages.size) return result;
    for (let i = 0; i + size <= text.length; i++) if (passages.has(text.slice(i, i + size))) {
      const last = result[result.length - 1];
      if (last && i <= last.end) last.end = i + size; else result.push({ start: i, end: i + size });
    }
    return result;
  };
  const clean = (text: string) => {
    const sentences = text.split(/(?<=[.!?。])\s+|\n+/), kept = sentences.map((_sentence, index) => index).filter(index => !spans(sentences[index]).length);
    return { text: kept.length === sentences.length ? text : kept.map(index => sentences[index]).join(" "), kept, originalCount: sentences.length };
  };
  return { clean, stats: (text: string) => { const lengths = spans(text).map(span => span.end - span.start), checked = clean(text); return {
    matchCount: lengths.length, matchLengths: lengths, matchedCharacters: lengths.reduce((sum, length) => sum + length, 0),
    removedSentences: checked.originalCount - checked.kept.length };
  } };
}

export function removeArticlePassages(value: unknown, input: BriefingInput): unknown {
  const guard = createArticlePassageGuard(input);
  const walk = (node: unknown, field?: string): unknown => {
    if (field === "newsSummaries" && !newsValidationEnabled(input)) return node;
    if (typeof node === "string") return guard.clean(node).text;
    if (Array.isArray(node)) return node.map(child => walk(child, field));
    if (node && typeof node === "object") {
      const result = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child, key)]));
      const raw = node as Record<string, unknown>;
      if (field === "newsSummaries" && typeof raw.text === "string") {
        const cleaned = guard.clean(raw.text);
        if (cleaned.kept.length !== cleaned.originalCount && cleaned.text.split(/(?<=[.!?。])\s+|\n+/).filter(sentence => sentence.trim()).length < 2) result.text = "";
      }
      if (typeof raw.text === "string" && Array.isArray(raw.sentenceCitations)) {
        const cleaned = guard.clean(raw.text);
        if (raw.sentenceCitations.length === cleaned.originalCount) result.sentenceCitations = cleaned.kept.map(index => (raw.sentenceCitations as unknown[])[index]);
      }
      return result;
    }
    return node;
  };
  return walk(value);
}
