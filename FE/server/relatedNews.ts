import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRelatedArticle } from "../src/shared/lib/relatedArticles";
import { safeArticleUrl } from "../src/shared/lib/articleUrl";
import type { PipelineNewsItem, PipelineOutputRow } from "../src/types/trading";
import { cachedNaverNewsSearch, selectCompanyNaverNews, excludedNewsSection, excludedNewsTopicReason } from "./naverNewsCollection";
import { rememberArticleExcerpt } from "./articleExcerpts";

export const RELATED_NEWS_FILE = "related_news.json";
type NewsEntry = { name: string; baseDate: string; status: "collected" | "collection_failed"; articles: (PipelineNewsItem & { matchedCompany?: string })[] };
export type RelatedNewsSnapshot = { version: 1; startedAt: number; collectedAt: string; stocks: Record<string, NewsEntry> };
type ModelRecord = Record<string, string>;

function articleIdentity(raw: string): string {
  try {
    const url = new URL(raw); url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString();
  } catch { return raw; }
}
function titleKey(title: string): string { return title.normalize("NFKC").toLowerCase().replace(/\[(?:속보|단독|종합)[^\]]*\]/g, "").replace(/[^\p{L}\p{N}]/gu, ""); }
function similarTitle(left: string, right: string): boolean {
  const a = titleKey(left), b = titleKey(right);
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 10) return false;
  const grams = (text: string) => new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
  const x = grams(a), y = grams(b);
  return 2 * [...x].filter(token => y.has(token)).length / (x.size + y.size) >= .86;
}
export function mergeNewsArticles(...groups: PipelineNewsItem[][]): PipelineNewsItem[] {
  const result: PipelineNewsItem[] = [];
  for (const article of groups.flat()) {
    if (!article.url || result.some(saved => articleIdentity(saved.url!) === articleIdentity(article.url!) || similarTitle(saved.title, article.title))) continue;
    result.push({ ...article, index: result.length + 1 });
    if (result.length === 3) break;
  }
  return result;
}

function decodeXml(value: string): string {
  return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => { const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ""; })
    .replace(/&(quot|apos|lt|gt|amp);/g, (_, key: string) => ({ quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" })[key] ?? "").trim();
}

/** RSS metadata only. No body fetch, sentiment evaluation or LLM invocation. */
export function parseRelatedNews(xml: string, name: string, limit = 3): PipelineNewsItem[] {
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml) || !/<\/rss\s*>/i.test(xml)) throw new Error("Invalid news feed.");
  const articles: PipelineNewsItem[] = [], urls = new Set<string>();
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)) {
    const field = (tag: string) => decodeXml(item[1].match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"))?.[1] ?? "");
    const source = field("source"), rawTitle = field("title"), title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -source.length - 3).trim() : rawTitle;
    const url = safeArticleUrl(field("link")), date = field("pubDate");
    if (!isRelatedArticle(title, name) || !url || urls.has(url)) continue;
    urls.add(url);
    articles.push({ index: articles.length + 1, title, url, source, pub_date: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : "" });
  }
  return articles.sort((left, right) => (Date.parse(right.pub_date) || 0) - (Date.parse(left.pub_date) || 0)).slice(0, Math.max(1, Math.min(20, limit)))
    .map((article, index) => ({ ...article, index: index + 1 }));
}

/** The caller supplies validated, current model records. Only the first five raw ranks are queried. */
export async function collectTopFiveArticles(records: ModelRecord[], outputDir: string, startedAt: number, transport: typeof fetch = fetch, bodies?: (articles: { url: string }[], directory: string) => Promise<unknown>, options: { env?: Record<string, string | undefined>; now?: () => number } = {}): Promise<RelatedNewsSnapshot> {
  const top = records.filter(row => /^\d{6}$/.test(row.ticker) && Number.isInteger(Number(row.pred_rank)) && Number(row.pred_rank) > 0)
    .sort((a, b) => Number(a.pred_rank) - Number(b.pred_rank)).slice(0, 5);
  const entries = await Promise.all(top.map(async row => {
    const entry: NewsEntry = { name: row.company_name, baseDate: row.prediction_base_date, status: "collection_failed", articles: [] };
    try {
      if (!entry.name?.trim()) return [row.ticker, entry] as const;
      const now = options.now ?? Date.now;
      const naver = await cachedNaverNewsSearch(entry.name, { display: 20, env: options.env, fetchImpl: transport, now,
        cacheKey: JSON.stringify([outputDir, entry.baseDate, row.ticker, entry.name]) });
      if (naver.status === "ok") {
        const selected = selectCompanyNaverNews(naver.items, entry.name, now());
        // Snippets are memory-only, never fields in related_news.json or rank APIs.
        for (const item of selected) rememberArticleExcerpt(outputDir, item.originalUrl, item.description, now());
        entry.articles = mergeNewsArticles(selected.map((item, index) => ({ index: index + 1, title: item.title,
          url: item.originalUrl, pub_date: item.pubDate, source: `${item.sourceHost} · 네이버 뉴스 경유`, matchedCompany: entry.name })));
        if (entry.articles.length) entry.status = "collected";
      }
      if (entry.articles.length === 3) return [row.ticker, entry] as const;
      // Fixed trusted provider. Neither the UI nor stored articles can select the fetch origin.
      const endpoint = new URL("https://news.google.com/rss/search");
      endpoint.searchParams.set("q", `"${entry.name}" when:7d`);
      endpoint.searchParams.set("hl", "ko"); endpoint.searchParams.set("gl", "KR"); endpoint.searchParams.set("ceid", "KR:ko");
      const response = await transport(endpoint.toString(), { signal: AbortSignal.timeout(8000), redirect: "error", headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
      if (!response.ok) throw new Error("News collection failed.");
      const candidates = parseRelatedNews(await response.text(), entry.name, 20), reasonCounts: Record<string, number> = {};
      const supplement = candidates.filter(article => {
        const reason = excludedNewsSection(article.url!) ? "excluded_section" : excludedNewsTopicReason(article.title);
        if (reason) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
        return !reason;
      });
      if (Object.keys(reasonCounts).length) console.info("[news] RSS filtered", { total: candidates.length, selected: supplement.length, reasonCounts });
      entry.articles = mergeNewsArticles(entry.articles, supplement);
      entry.status = "collected";
    } catch { /* Keep successful Naver metadata even when the RSS supplement fails. */ }
    return [row.ticker, entry] as const;
  }));
  const snapshot: RelatedNewsSnapshot = { version: 1, startedAt, collectedAt: new Date().toISOString(), stocks: Object.fromEntries(entries) };
  await writeFile(join(outputDir, RELATED_NEWS_FILE), JSON.stringify(snapshot), "utf8");
  // Separate private cache only; related_news.json and attached public articles stay metadata-only.
  try { await bodies?.(entries.flatMap(([, entry]) => entry.articles.flatMap(article => typeof article.url === "string" ? [{ url: article.url }] : [])), outputDir); } catch { /* Body failures retain title-only news and do not fail an analysis. */ }
  return snapshot;
}

export function attachRelatedNews(rows: PipelineOutputRow[], snapshot: RelatedNewsSnapshot | null, startedAt: number | undefined): PipelineOutputRow[] {
  return rows.map(row => {
    const code = String(row.input_row.ticker ?? row.result.ticker), entry = typeof startedAt === "number" && Number.isFinite(startedAt) && snapshot?.version === 1 && snapshot.startedAt === startedAt ? snapshot.stocks?.[code] : undefined;
    const matches = entry && entry.name === row.result.company_name && entry.baseDate === row.input_row.prediction_base_date;
    const status = matches && (entry.status === "collected" || entry.status === "collection_failed") ? entry.status : "not_collected";
    // Naver may match the company only in its private excerpt. Persist the matched
    // company name, never the excerpt, and bind it to the same run/date above.
    const news = status === "collected" && Array.isArray(entry?.articles) ? entry.articles.filter(article => article && typeof article.title === "string" && typeof article.url === "string" && (isRelatedArticle(article.title, row.result.company_name) || article.matchedCompany === row.result.company_name) && safeArticleUrl(article.url)).slice(0, 3)
      .map((article, index) => ({ index: index + 1, title: article.title, url: safeArticleUrl(article.url)!, source: article.source, pub_date: article.pub_date })) : [];
    return { ...row, news, data_meta: { ...row.data_meta, newsStatus: status, newsCollected: status === "collected", newsMethod: "unknown", newsTally: null } };
  });
}
