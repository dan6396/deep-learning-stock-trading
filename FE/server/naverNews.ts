/**
 * Metadata only: description is an untrusted excerpt, never a fetched article body.
 * https://developers.naver.com/docs/serviceapi/search/news/news.md
 * Search API quota: 25,000 calls/day, shared across search APIs. TOP5 costs about
 * five calls per analysis; the caller must cache/budget calls. No automatic retry.
 */
export const NAVER_NEWS_TIMEOUT_MS = 5000;
export const NAVER_NEWS_MAX_RESPONSE_BYTES = 512_000;
export const NAVER_NEWS_TITLE_LIMIT = 300;
export const NAVER_NEWS_DESCRIPTION_LIMIT = 2000;

export type NaverNewsItem = {
  title: string;
  description: string;
  originalUrl: string;
  /** The API's link may itself be a publisher URL, per the official contract. */
  naverUrl: string;
  pubDate: string;
  sourceHost: string;
};
type ErrorCode = "invalid_query" | "http_error" | "timeout" | "aborted" | "response_too_large" | "invalid_response" | "network_error";
type NewsError = { code: ErrorCode; httpStatus?: number; retryable: boolean; retryAfterMs?: number };
export type NaverNewsResult =
  | { status: "ok"; items: NaverNewsItem[]; httpStatus: number }
  | { status: "unconfigured"; items: [] }
  | { status: "error"; items: []; error: NewsError };
export type NaverNewsOptions = {
  display?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

const entities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ensp: " ", emsp: " ", thinsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  middot: "·", bull: "•", copy: "©", reg: "®", trade: "™", euro: "€",
  pound: "£", yen: "¥", cent: "¢", times: "×", divide: "÷", plusmn: "±",
  deg: "°", micro: "µ", larr: "←", rarr: "→", uarr: "↑", darr: "↓",
};
function plainText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  // Repeated decoding handles encoded tags; cap passes for hostile nested entities.
  let text = value;
  for (let pass = 0; pass < 4; pass++) {
    const next = text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, token: string) => {
      if (!token.startsWith("#")) return entities[token] ?? all;
      const point = token[1].toLowerCase() === "x" ? parseInt(token.slice(2), 16) : Number(token.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
    });
    text = next;
    if (!/&(?:#x[\da-f]+|#\d+|[a-z]+);/i.test(text)) break;
  }
  return Array.from(text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/?(?:br|p|div|li|h[1-6])\b[^>]*>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, limit).join("");
}
function normalizedUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) return "";
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}
function hasCredential(value: string, credentials: string[]): boolean {
  return credentials.some(key => value.includes(key) || value.includes(encodeURIComponent(key)) || value.includes(JSON.stringify(key).slice(1, -1)));
}
function parseItems(payload: unknown, display: number, credentials: string[]): NaverNewsItem[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) throw new Error("invalid_response");
  const items: NaverNewsItem[] = [], seen = new Set<string>();
  for (const value of (payload as { items: unknown[] }).items.slice(0, 100)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const naverUrl = normalizedUrl(row.link), originalUrl = normalizedUrl(row.originallink) || naverUrl;
    const title = plainText(row.title, NAVER_NEWS_TITLE_LIMIT), description = plainText(row.description, NAVER_NEWS_DESCRIPTION_LIMIT);
    const date = typeof row.pubDate === "string" ? Date.parse(row.pubDate) : NaN;
    // Missing/unsafe original links fall back to link; no usable URL, title or date
    // means omission. Downstream articleBodies still owns robots/DNS/SSRF checks.
    if (!originalUrl || !title || !Number.isFinite(date) || seen.has(originalUrl)) continue;
    const item: NaverNewsItem = { title, description, originalUrl, naverUrl, pubDate: new Date(date).toISOString(), sourceHost: new URL(originalUrl).hostname };
    // Never propagate credentials even if an upstream response echoes them.
    if (hasCredential(JSON.stringify(item), credentials)) continue;
    seen.add(originalUrl); items.push(item);
    if (items.length >= display) break;
  }
  return items;
}
function retryDelay(response: Response): number | undefined {
  if (response.status !== 429 && response.status < 500) return undefined;
  const raw = response.headers.get("retry-after"), seconds = raw && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : raw && /^[a-z]{3}, \d{2} [a-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(raw.trim()) ? Date.parse(raw) - Date.now() : NaN;
  return Number.isFinite(delay) ? Math.min(300_000, Math.max(1000, delay)) : response.status === 429 ? 60_000 : 1000;
}
function cancelBody(response: Response): void { void response.body?.cancel().catch(() => {}); }
class ResponseTooLargeError extends Error {}
async function readBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (length > NAVER_NEWS_MAX_RESPONSE_BYTES) { cancelBody(response); throw new ResponseTooLargeError(); }
  if (!response.body) throw new Error("invalid_response");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let size = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > NAVER_NEWS_MAX_RESPONSE_BYTES) { cancel(); throw new ResponseTooLargeError(); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export async function searchNaverNews(query: string, options: NaverNewsOptions = {}): Promise<NaverNewsResult> {
  const env = options.env ?? process.env;
  const clientId = env.NAVER_CLIENT_ID?.trim(), clientSecret = env.NAVER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { status: "unconfigured", items: [] };
  const credentials = [clientId, clientSecret];
  const fail = (code: ErrorCode, retryable = false, retryAfterMs?: number): NaverNewsResult => ({ status: "error", items: [], error: { code, retryable, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } });
  if (typeof query !== "string" || !query.trim() || query.length > 200 || hasCredential(query, credentials)) return fail("invalid_query");
  if (options.signal?.aborted) return fail("aborted");
  const requested = options.display ?? 10, display = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 10;
  const endpoint = new URL("https://openapi.naver.com/v1/search/news.json");
  endpoint.search = new URLSearchParams({ query: query.trim(), display: String(display), start: "1", sort: "date" }).toString();
  const controller = new AbortController();
  let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (error: Error) => void = () => {};
  const interruption = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new Error("aborted")); };
  options.signal?.addEventListener("abort", abort, { once: true });
  timer = setTimeout(() => { timedOut = true; abort(); }, NAVER_NEWS_TIMEOUT_MS);
  let readingResponse = false;
  try {
    const operation = (async (): Promise<NaverNewsResult> => {
      const response = await (options.fetchImpl ?? fetch)(endpoint.toString(), {
        method: "GET", redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
      });
      if (controller.signal.aborted) { cancelBody(response); return fail("aborted"); }
      if (!response.ok) {
        const retryAfterMs = retryDelay(response);
        cancelBody(response);
        return { status: "error", items: [], error: { code: "http_error", httpStatus: response.status, retryable: retryAfterMs !== undefined, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } };
      }
      readingResponse = true;
      const payload = await readBounded(response, controller.signal);
      return { status: "ok", items: parseItems(payload, display, credentials), httpStatus: response.status };
    })();
    // Covers both headers and body, including test transports that ignore AbortSignal.
    return await Promise.race([operation, interruption]);
  } catch (error) {
    const interrupted = controller.signal.aborted;
    controller.abort();
    if (timedOut) return fail("timeout", true, 1000);
    if (interrupted) return fail("aborted");
    if (error instanceof ResponseTooLargeError) return fail("response_too_large");
    // Do not expose upstream bodies, exceptions, URLs, request objects or headers.
    if (readingResponse) return fail("invalid_response");
    return fail("network_error", true, 1000);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/** A lexical candidate filter, not proof of company identity or investment relevance.
 * Aliases require caller curation. ASCII boundaries keep KT from matching SKT.
 */
export function filterRelevantNaverNews(items: NaverNewsItem[], companyName: string, options: { aliases?: string[]; maxAgeDays?: number; now?: number } = {}): NaverNewsItem[] {
  const now = options.now ?? Date.now(), requestedAge = options.maxAgeDays ?? 7;
  const maxAge = Number.isFinite(requestedAge) && requestedAge >= 0 ? requestedAge * 86_400_000 : 7 * 86_400_000;
  const terms = [companyName, ...(options.aliases ?? [])].map(value => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
  if (!Number.isFinite(now) || !terms.length) return [];
  return items.filter(item => {
    const date = Date.parse(item.pubDate), age = now - date;
    if (!Number.isFinite(date) || age < 0 || age > maxAge) return false;
    const text = `${item.title} ${item.description}`.normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
    return terms.some(term => /^[\x00-\x7f]+$/.test(term)
      ? new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i").test(text)
      : text.includes(term));
  });
}
