import { resolve } from "node:path";

export type ArticleExcerptContext = Record<string, { text: string }>;
export type ArticleExcerptLookup = { requested: number; found: number; missing: number; expired: number; entries: number; cacheVersion: 2 };
type Excerpt = { text: string; expiresAt: number };
// Vite can load a new server config bundle in the same Node process. Keep private
// state across module instances, without persisting any plaintext to disk.
const slot = Symbol.for("kospi.private-news-excerpts.v2");
const processState = globalThis as typeof globalThis & { [key: symbol]: Map<string, Excerpt> | undefined };
const excerpts = processState[slot] ??= new Map<string, Excerpt>();
function key(directory: string, raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.hash = "";
  for (const name of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/i.test(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  let path = resolve(directory).replace(/\\/g, "/").replace(/\/$/, "");
  if (process.platform === "win32") path = path.toLowerCase();
  return JSON.stringify([path, url.toString()]);
}

/** Private process memory only. Never serialize snippets into news/results caches.
 * A restart intentionally loses excerpts; GET never refetches them to fill a gap. */
export function rememberArticleExcerpt(directory: string, url: string, text: string, now = Date.now()): void {
  if (!text.trim()) return;
  const id = key(directory, url);
  if (!id) return;
  excerpts.delete(id);
  excerpts.set(id, { text: text.slice(0, 4000), expiresAt: now + 86_400_000 });
  while (excerpts.size > 1000) excerpts.delete(excerpts.keys().next().value!);
}
export function cachedArticleExcerpts(stocks: { news: { articles: { id: string; url: string }[] } }[], directory: string, now = Date.now()): ArticleExcerptContext {
  return Object.fromEntries(stocks.flatMap(stock => stock.news.articles).flatMap(article => {
    const id = key(directory, article.url);
    if (!id) return [];
    const value = excerpts.get(id);
    if (!value || value.expiresAt <= now) { excerpts.delete(id); return []; }
    return [[article.id, { text: value.text }]];
  }));
}

export function articleExcerptLookup(stocks: { news: { articles: { id: string; url: string }[] } }[], directory: string, now = Date.now()): ArticleExcerptLookup {
  const result: ArticleExcerptLookup = { requested: 0, found: 0, missing: 0, expired: 0, entries: excerpts.size, cacheVersion: 2 };
  for (const stock of stocks) for (const article of stock.news.articles) {
    result.requested++;
    const id = key(directory, article.url), value = id ? excerpts.get(id) : undefined;
    if (!value) result.missing++;
    else if (value.expiresAt <= now) result.expired++;
    else result.found++;
  }
  return result;
}
