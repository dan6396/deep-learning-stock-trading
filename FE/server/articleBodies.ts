import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { join } from "node:path";
import { extractArticleText } from "./articleText";

export const ARTICLE_USER_AGENT = "StockBriefingResearch/1.0 (local exhibition; article attribution)";
export type ArticleBody = { url: string; resolvedUrl: string; text: string; collectedAt: string };
export type ArticleBodyRecord = { version: 1; url: string; status: "ready" | "unavailable"; reason?: string; failureCode?: string; body?: ArticleBody; attemptedAt: number; retryAt: number; failures: number };
export type ArticleBodyContext = Record<string, ArticleBody>;
export type ArticleTrace = { articleUrl: string; stage: "robots" | "article" | "redirect" | "extract"; url: string; status?: number; error?: string; cached?: boolean; domain?: string; characters?: number };
type HttpResult = { status: number; text: string; location?: string; contentType?: string };
export type ArticleTransport = (url: string, options: { signal: AbortSignal; method?: "GET" | "POST"; body?: string }) => Promise<HttpResult>;
const key = (url: string) => createHash("sha256").update(url).digest("hex");
const bytesLimit = 1_000_000;
export function publicArticleUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || !url.hostname.includes(".") || isIP(url.hostname.replace(/[\[\]]/g, ""))
    || /(?:^|\.)(?:localhost|local|internal|invalid|test|home|lan)$/.test(url.hostname)) throw Error("unsafe_url");
  url.hash = ""; return url;
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
  }
  if (isIP(address) !== 6 || !/^[23][\da-f]{3}:/i.test(address)) return false;
  const [first, second] = address.split(":").slice(0, 2).map(part => parseInt(part || "0", 16));
  return !(first === 0x2001 && (second === 0 || second === 0xdb8) || first === 0x2002 || first === 0x3fff && second <= 0x0fff);
}

/** Pin each verified public DNS answer into HTTPS; redirects are checked separately. */
export const fetchPublicArticle: ArticleTransport = async (raw, options) => {
  const url = publicArticleUrl(raw), addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(row => !publicAddress(row.address))) throw Error("unsafe_address");
  const target = addresses.find(row => row.family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    // Node's socket option is supported at runtime; older HTTPS typings omit it.
    const familyPolicy = { autoSelectFamily: false };
    const request = httpsRequest(url, { ...familyPolicy, method: options.method ?? "GET", signal: options.signal,
      headers: { "User-Agent": ARTICLE_USER_AGENT, Accept: "text/html, text/plain;q=0.8", ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(options.body) } : {}) },
      lookup: (_hostname, _settings, callback) => callback(null, target.address, target.family) }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > bytesLimit) { request.destroy(Error("response_too_large")); return; } chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => {
        const buffer = Buffer.concat(chunks), charset = response.headers["content-type"]?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
          ?? buffer.subarray(0, 4096).toString("latin1").match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? "utf-8";
        let text: string; try { text = new TextDecoder(charset).decode(buffer); } catch { text = buffer.toString("utf8"); }
        resolve({ status: response.statusCode ?? 0, text, location: response.headers.location, contentType: response.headers["content-type"] });
      });
    });
    request.on("error", reject); request.end(options.body);
  });
};

/** KMP searches consume disjoint path spans: no regexp or wildcard backtracking. */
function literalIndex(path: string, literal: string, from: number, limit: number): number {
  if (!literal) return from;
  const prefix = new Array<number>(literal.length).fill(0);
  for (let index = 1, matched = 0; index < literal.length; index++) { while (matched && literal[index] !== literal[matched]) matched = prefix[matched - 1]; if (literal[index] === literal[matched]) matched++; prefix[index] = matched; }
  for (let index = from, matched = 0; index < limit; index++) { while (matched && path[index] !== literal[matched]) matched = prefix[matched - 1]; if (path[index] === literal[matched]) matched++; if (matched === literal.length) return index - matched + 1; }
  return -1;
}
export function robotsGlobMatches(pattern: string, path: string): boolean {
  if (pattern.length > 1024 || path.length > 8192 || (pattern.match(/\*/g)?.length ?? 0) > 64) return false;
  const anchored = pattern.endsWith("$"), body = anchored ? pattern.slice(0, -1) : pattern, parts = body.split("*");
  if (parts.length === 1) return anchored ? path === body : path.startsWith(body);
  const first = parts.shift()!, last = parts.pop()!;
  if (!path.startsWith(first)) return false;
  let cursor = first.length;
  const limit = anchored ? path.length - last.length : path.length;
  if (anchored && (!path.endsWith(last) || cursor > limit)) return false;
  for (const literal of parts) { const start = literalIndex(path, literal, cursor, limit); if (start < 0) return false; cursor = start + literal.length; }
  return anchored ? cursor <= limit : literalIndex(path, last, cursor, path.length) >= 0;
}
/** Exact product-token groups, bounded policy/rules and a linear wildcard matcher. */
export function robotsAllowed(text: string, raw: string): boolean {
  if (text.length > 256_000) return false;
  const url = new URL(raw), groups: { agents: string[]; rules: { path: string; allow: boolean }[] }[] = [];
  if ((url.pathname + url.search).length > 8192) return false;
  let count = 0;
  let current = { agents: [] as string[], rules: [] as { path: string; allow: boolean }[] };
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*/, "").trim().match(/^([^:]+):\s*(.*)$/); if (!match) continue;
    const field = match[1].toLowerCase(), value = match[2].trim();
    if (field === "user-agent") { if (current.rules.length) { groups.push(current); current = { agents: [], rules: [] }; } if (value) current.agents.push(value.toLowerCase()); }
    else if (["allow", "disallow"].includes(field) && current.agents.length && value) { if (++count > 2048 || value.length > 1024 || (value.match(/\*/g)?.length ?? 0) > 64) return false; current.rules.push({ path: value, allow: field === "allow" }); }
  }
  groups.push(current);
  const product = ARTICLE_USER_AGENT.split("/")[0].toLowerCase();
  const specific = groups.filter(group => group.agents.some(agent => agent === product));
  const applicable = specific.length ? specific : groups.filter(group => group.agents.includes("*"));
  const path = url.pathname + url.search;
  const rules = applicable.flatMap(group => group.rules).filter(rule => robotsGlobMatches(rule.path, path))
    .sort((a, b) => b.path.replace(/[*$]/g, "").length - a.path.replace(/[*$]/g, "").length || Number(b.allow) - Number(a.allow));
  return rules[0]?.allow ?? true;
}
const decode = (text: string) => text.replace(/&#(x[\da-f]+|\d+);/gi, (_all, token) => { const n = token[0].toLowerCase() === "x" ? parseInt(token.slice(1), 16) : Number(token); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; })
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_all, token) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[token as "amp"]);
export { extractArticleText } from "./articleText";

/** Decode old RSS payloads locally; modern opaque payloads require the publisher redirect. */
export function decodeGoogleArticle(raw: string): string | null {
  const url = new URL(raw); if (url.hostname !== "news.google.com") return null;
  const id = url.pathname.match(/\/(?:rss\/)?articles\/([^/]+)/)?.[1]; if (!id) return null;
  try { const decoded = Buffer.from(id, "base64url").toString("utf8"); const candidate = decoded.match(/https:\/\/[^\s\x00-\x20"<>]+/)?.[0]; return candidate ? publicArticleUrl(candidate).toString() : null; } catch { return null; }
}

export function createArticleBodyStore({ directory, transport = fetchPublicArticle, now = Date.now, timeoutMs = 5000, trace, persist = true }: { directory: string; transport?: ArticleTransport; now?: () => number; timeoutMs?: number; trace?: (event: ArticleTrace) => void; persist?: boolean }) {
  const memo = new Map<string, ArticleBodyRecord>(), pending = new Map<string, Promise<ArticleBodyRecord>>(), policies = new Map<string, Promise<{ text: string; status: number }>>();
  const path = (url: string) => join(directory, ".private-news-bodies", `${key(url)}.json`);
  async function read(url: string): Promise<ArticleBodyRecord | null> {
    if (memo.has(url)) return memo.get(url)!;
    if (!persist) return null;
    try { const value = JSON.parse(await readFile(path(url), "utf8"));
      if (value.version !== 1 || value.url !== url || !Number.isFinite(value.retryAt) || !["ready", "unavailable"].includes(value.status)) return null;
      if (value.status === "ready" && (!value.body || value.body.url !== url || typeof value.body.text !== "string" || value.body.text.length < 100 || value.body.text.length > 2000 || !Number.isFinite(Date.parse(value.body.collectedAt)))) return null;
      memo.set(url, value); return value;
    } catch { return null; }
  }
  async function checked(raw: string, signal: AbortSignal, articleUrl: string): Promise<HttpResult> {
    const url = publicArticleUrl(raw), robots = url.origin + "/robots.txt";
    const cached = policies.has(url.origin);
    if (!policies.has(url.origin)) policies.set(url.origin, (async () => {
      const response = await transport(robots, { signal });
      if (response.status === 404 || response.status === 410) return { text: "", status: response.status };
      if (response.status !== 200) throw Object.assign(Error("robots_unavailable"), { code: `HTTP_${response.status}`, status: response.status }); return { text: response.text, status: response.status };
    })());
    let policy: { text: string; status: number }; try { policy = await policies.get(url.origin)!; } catch (error) {
      const failure = error as { code?: string; status?: number; name?: string };
      trace?.({ articleUrl, stage: "robots", url: robots, status: failure.status, error: failure.code ?? failure.name ?? "network_error", cached });
      policies.delete(url.origin); throw Object.assign(Error("robots_unavailable"), { code: failure.code });
    }
    trace?.({ articleUrl, stage: "robots", url: robots, status: policy.status, cached });
    if (!robotsAllowed(policy.text, url.toString())) { trace?.({ articleUrl, stage: "robots", url: robots, status: policy.status, error: "explicit_disallow", cached }); throw Error("robots_disallowed"); }
    try { const response = await transport(url.toString(), { signal }); trace?.({ articleUrl, stage: "article", url: url.toString(), status: response.status }); return response; }
    catch (error) { trace?.({ articleUrl, stage: "article", url: url.toString(), error: (error as { code?: string; name?: string }).code ?? (error as Error).name }); throw error; }
  }
  async function collect(url: string): Promise<ArticleBodyRecord> {
    const saved = await read(url); if (saved && now() < saved.retryAt) return saved;
    if (pending.has(url)) return pending.get(url)!;
    const work = (async () => {
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      let result: ArticleBodyRecord;
      try {
        const body = await Promise.race([(async () => {
          let next = decodeGoogleArticle(url) ?? url;
          if (next !== url) trace?.({ articleUrl: url, stage: "redirect", url: next, domain: new URL(next).hostname });
          for (let redirects = 0; redirects <= 5; redirects++) {
            const response = await checked(next, controller.signal, url);
            if ([301, 302, 303, 307, 308].includes(response.status) && response.location) { next = publicArticleUrl(new URL(response.location, next).toString()).toString(); trace?.({ articleUrl: url, stage: "redirect", url: next, status: response.status, domain: new URL(next).hostname }); continue; }
            if (response.status !== 200) throw Error(response.status === 403 || response.status === 429 ? "blocked" : "http_failed");
            if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(response.contentType ?? "")) throw Error("unsupported_content_type");
            if (new URL(next).hostname === "news.google.com") {
              // A public publisher canonical/link is accepted only on the Google article shell.
              const target = response.text.match(/<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*jsname=["']tljFtd["']/i)?.[1]
                ?? response.text.match(/<a\b[^>]*jsname=["']tljFtd["'][^>]*href=["'](https:\/\/[^"']+)["']/i)?.[1];
              if (target && new URL(decode(target)).hostname !== "news.google.com") { next = publicArticleUrl(decode(target)).toString(); trace?.({ articleUrl: url, stage: "redirect", url: next, domain: new URL(next).hostname }); continue; }
              trace?.({ articleUrl: url, stage: "redirect", url: next, error: "redirect_unresolved" });
              throw Error("redirect_unresolved");
            }
            const text = extractArticleText(response.text); trace?.({ articleUrl: url, stage: "extract", url: next, characters: text?.length ?? 0, domain: new URL(next).hostname }); if (!text) throw Error("extraction_failed");
            return { url, resolvedUrl: next, text, collectedAt: new Date(now()).toISOString() };
          }
          throw Error("redirect_limit");
        })(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("timeout")); }, timeoutMs); })]);
        result = { version: 1, url, status: "ready", body, attemptedAt: now(), retryAt: now() + 86_400_000, failures: 0 };
      } catch (error) {
        const reason = error instanceof Error && /^(?:unsafe_url|unsafe_address|response_too_large|robots_unavailable|robots_disallowed|blocked|http_failed|redirect_unresolved|extraction_failed|unsupported_content_type|redirect_limit|timeout)$/.test(error.message) ? error.message : "fetch_failed";
        const failures = (saved?.failures ?? 0) + 1;
        const code = (error as { code?: unknown })?.code;
        result = { version: 1, url, status: "unavailable", reason, ...(typeof code === "string" && /^[A-Z0-9_]{1,50}$/.test(code) ? { failureCode: code } : {}), attemptedAt: now(), retryAt: now() + Math.min(21_600_000, 60_000 * 2 ** Math.min(failures - 1, 9)), failures };
      } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
      memo.set(url, result);
      if (persist) try { const dir = join(directory, ".private-news-bodies"); await mkdir(dir, { recursive: true }); const temp = path(url) + ".tmp"; await writeFile(temp, JSON.stringify(result), "utf8"); await rename(temp, path(url)); } catch { /* Cache persistence cannot fail the analysis run. */ }
      return result;
    })();
    pending.set(url, work); try { return await work; } finally { pending.delete(url); }
  }
  return { read, collect };
}

export async function collectArticleBodies(articles: { url: string }[], directory: string, options: { store?: ReturnType<typeof createArticleBodyStore>; budgetMs?: number } = {}): Promise<ArticleBodyRecord[]> {
  const store = options.store ?? createArticleBodyStore({ directory }), end = Date.now() + (options.budgetMs ?? 20_000);
  const unique = [...new Set(articles.slice(0, 15).map(article => article.url))], results: ArticleBodyRecord[] = []; let cursor = 0;
  // Reserve the whole per-article timeout before starting another request.
  await Promise.all([0, 1].map(async () => { while (cursor < unique.length && Date.now() + 5000 <= end) { const url = unique[cursor++]; results.push(await store.collect(url)); } }));
  return results;
}

/** Cache-only enrichment. This function must never initiate article/provider requests. */
export async function cachedArticleBodies(stocks: { news: { articles: { id: string; url: string }[] } }[], directory: string): Promise<ArticleBodyContext> {
  const store = createArticleBodyStore({ directory }), pairs = await Promise.all(stocks.flatMap(stock => stock.news.articles).map(async article => {
    const record = await store.read(article.url); return record?.status === "ready" && record.body ? [article.id, record.body] as const : null;
  }));
  return Object.fromEntries(pairs.filter((pair): pair is NonNullable<typeof pair> => pair !== null));
}
