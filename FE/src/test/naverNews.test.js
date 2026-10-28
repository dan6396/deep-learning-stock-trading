import { afterEach, describe, expect, it, vi } from "vitest";
import { searchNaverNews, filterRelevantNaverNews, NAVER_NEWS_TIMEOUT_MS, NAVER_NEWS_MAX_RESPONSE_BYTES } from "../../server/naverNews";

const env = { NAVER_CLIENT_ID: "fixture-client-id", NAVER_CLIENT_SECRET: "fixture-client-secret" };
const date = "Wed, 28 Oct 2026 09:00:00 +0900";
const item = (overrides = {}) => ({ title: "<b>KT</b> &quot;통신&quot; &#x1F4F0;", description: "새&nbsp;소식 &amp; &#54620;국 <b>공개</b>", originallink: "https://PAPER.example:443/a#section", link: "https://n.news.naver.com/article/001/001", pubDate: date, ...overrides });
function response(payload, { status = 200, headers = {}, chunks } = {}) {
  const bytes = chunks ?? [new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload))];
  let index = 0;
  const cancel = vi.fn(async () => {}), releaseLock = vi.fn();
  return { ok: status >= 200 && status < 300, status, headers: { get: key => headers[key.toLowerCase()] ?? null }, body: { cancel, getReader: () => ({ read: vi.fn(async () => index < bytes.length ? { value: bytes[index++], done: false } : { done: true }), cancel, releaseLock }) } };
}
const call = (fetchImpl, options = {}, query = "KT") => searchNaverNews(query, { env, fetchImpl, ...options });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("standalone Naver news search", () => {
  it.each([{}, { NAVER_CLIENT_ID: "id" }, { NAVER_CLIENT_SECRET: "secret" }, { ...env, NAVER_CLIENT_SECRET: "  " }])("skips transport with missing credentials", async missing => {
    const fetchImpl = vi.fn();
    expect(await call(fetchImpl, { env: missing })).toEqual({ status: "unconfigured", items: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("uses fixed endpoint, date sort and credentials only in headers; parses plain metadata", async () => {
    const fetchImpl = vi.fn(async () => response({ items: [item()] }));
    const result = await call(fetchImpl, { display: 3 }, "KT 통신");
    expect(result).toEqual({ status: "ok", httpStatus: 200, items: [{ title: 'KT "통신" 📰', description: "새 소식 & 한국 공개", originalUrl: "https://paper.example/a", naverUrl: "https://n.news.naver.com/article/001/001", pubDate: "2026-10-28T00:00:00.000Z", sourceHost: "paper.example" }] });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [raw, init] = fetchImpl.mock.calls[0], url = new URL(raw);
    expect(url.origin + url.pathname).toBe("https://openapi.naver.com/v1/search/news.json");
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: "KT 통신", display: "3", start: "1", sort: "date" });
    expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { "X-Naver-Client-Id": env.NAVER_CLIENT_ID, "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET } });
    for (const credential of Object.values(env)) { expect(raw).not.toContain(credential); expect(JSON.stringify(result)).not.toContain(credential); }
  });
  it("falls back to link, normalizes/deduplicates URLs and omits unusable rows", async () => {
    const rows = [item({ originallink: undefined }), item({ originallink: "javascript:bad", link: "https://publisher.example/b" }), item(), item({ originallink: "https://paper.example/a#duplicate" }), item({ originallink: "ftp://bad", link: "javascript:bad" }), item({ originallink: "https://user:pass@bad.example", link: "" }), item({ pubDate: "invalid" }), item({ title: "<b> </b>" }), null];
    const result = await call(async () => response({ items: rows }));
    expect(result.items.map(row => row.originalUrl)).toEqual(["https://n.news.naver.com/article/001/001", "https://publisher.example/b", "https://paper.example/a"]);
    expect(result.items[0].sourceHost).toBe("n.news.naver.com");
  });
  it("removes encoded markup, scripts, invalid codepoints and bounds Unicode text", async () => {
    const result = await call(async () => response({ items: [item({ title: "&lt;b&gt;KT&lt;/b&gt; <script>hide()</script> &apos;x&apos; &#0;&#xD800;&#x110000;", description: "😀".repeat(2100) })] }));
    expect(result.items[0].title).toBe("KT 'x'");
    expect(Array.from(result.items[0].description)).toHaveLength(2000);
    const bounded = await call(async () => response({ items: [item({ title: "가".repeat(400) })] }));
    expect(bounded.items[0].title).toHaveLength(300);
    const inline = await call(async () => response({ items: [item({ title: "삼성<b>전자</b><br>소식" })] }));
    expect(inline.items[0].title).toBe("삼성전자 소식");
  });
  it.each([[401, false, undefined], [403, false, undefined], [429, true, 60_000], [500, true, 1000], [503, true, 1000]])("returns safe HTTP %s metadata with no automatic retry", async (status, retryable, retryAfterMs) => {
    const fetchImpl = vi.fn(async () => response(`${env.NAVER_CLIENT_ID} ${env.NAVER_CLIENT_SECRET}`, { status }));
    const result = await call(fetchImpl);
    expect(result).toMatchObject({ status: "error", items: [], error: { code: "http_error", httpStatus: status, retryable } });
    expect(result.error.retryAfterMs).toBe(retryAfterMs);
    expect(fetchImpl).toHaveBeenCalledOnce();
    for (const credential of Object.values(env)) expect(JSON.stringify(result)).not.toContain(credential);
  });
  it.each([["2", 2000], ["99999999", 300_000], ["-100", 60_000], [env.NAVER_CLIENT_SECRET, 60_000]])("bounds Retry-After without exposing raw headers", async (header, expected) => {
    const result = await call(async () => response("", { status: 429, headers: { "retry-after": header } }));
    expect(result.error.retryAfterMs).toBe(expected);
    expect(JSON.stringify(result)).not.toContain(env.NAVER_CLIENT_SECRET);
  });
  it("interprets HTTP-date Retry-After", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));
    const result = await call(async () => response("", { status: 503, headers: { "retry-after": "Wed, 28 Oct 2026 00:00:03 GMT" } }));
    expect(result.error.retryAfterMs).toBe(3000);
  });
  it("times out an uncooperative transport at five seconds", async () => {
    vi.useFakeTimers(); const fetchImpl = vi.fn(async () => new Promise(() => {}));
    const pending = call(fetchImpl); await vi.advanceTimersByTimeAsync(NAVER_NEWS_TIMEOUT_MS);
    expect(await pending).toMatchObject({ status: "error", error: { code: "timeout", retryable: true, retryAfterMs: 1000 } });
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("applies the deadline to a stalled response body too", async () => {
    vi.useFakeTimers(); const result = response({ items: [] });
    result.body.getReader = () => ({ read: () => new Promise(() => {}), cancel: result.body.cancel, releaseLock: vi.fn() });
    const pending = call(async () => result); await vi.advanceTimersByTimeAsync(NAVER_NEWS_TIMEOUT_MS);
    expect(await pending).toMatchObject({ error: { code: "timeout" } });
    expect(result.body.cancel).toHaveBeenCalledOnce();
  });
  it("cancels when caller aborts and skips pre-aborted requests", async () => {
    const controller = new AbortController(); controller.abort(env.NAVER_CLIENT_SECRET);
    const fetchImpl = vi.fn(async () => new Promise(() => {}));
    expect(await call(fetchImpl, { signal: controller.signal })).toMatchObject({ error: { code: "aborted" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    const next = new AbortController(), pending = call(fetchImpl, { signal: next.signal }); next.abort(env.NAVER_CLIENT_SECRET);
    expect(await pending).toMatchObject({ error: { code: "aborted", retryable: false } });
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("rejects declared oversized responses without reading", async () => {
    const result = response({}, { headers: { "content-length": String(NAVER_NEWS_MAX_RESPONSE_BYTES + 1) } });
    const read = vi.spyOn(result.body, "getReader");
    expect(await call(async () => result)).toMatchObject({ error: { code: "response_too_large" } });
    expect(read).not.toHaveBeenCalled(); expect(result.body.cancel).toHaveBeenCalledOnce();
  });
  it("bounds streamed bytes even with absent or misleading Content-Length", async () => {
    const result = response({}, { headers: { "content-length": "1" }, chunks: [new Uint8Array(NAVER_NEWS_MAX_RESPONSE_BYTES), new Uint8Array(1)] });
    expect(await call(async () => result)).toMatchObject({ error: { code: "response_too_large" } });
    expect(result.body.cancel).toHaveBeenCalledOnce();
  });
  it("decodes a multibyte character split across chunks", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({ items: [item({ title: "한" })] }));
    const position = encoded.findIndex(byte => byte === 0xed);
    expect((await call(async () => response({}, { chunks: [encoded.slice(0, position + 1), encoded.slice(position + 1)] }))).items[0].title).toBe("한");
  });
  it.each(["not JSON", {}, { items: {} }])("fails closed on invalid payload", async payload => {
    expect(await call(async () => response(payload))).toMatchObject({ status: "error", error: { code: "invalid_response" } });
  });
  it("never returns exception details or echoed credentials in normalized metadata", async () => {
    const log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    const failed = await call(async () => { throw new Error(`${env.NAVER_CLIENT_ID} ${env.NAVER_CLIENT_SECRET}`); });
    expect(failed).toMatchObject({ error: { code: "network_error" } });
    const result = await call(async () => response({ items: [item({ title: env.NAVER_CLIENT_ID }), item({ description: env.NAVER_CLIENT_SECRET }), item({ originallink: `https://paper.example/${env.NAVER_CLIENT_SECRET}` }), item()] }));
    expect(result.items).toHaveLength(1);
    for (const credential of Object.values(env)) { expect(JSON.stringify(failed)).not.toContain(credential); expect(JSON.stringify(result)).not.toContain(credential); }
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it("classifies fetch TypeErrors as network failures and never returns their message", async () => {
    const result = await call(async () => { throw new TypeError(env.NAVER_CLIENT_SECRET); });
    expect(result).toMatchObject({ error: { code: "network_error", retryable: true } });
    expect(JSON.stringify(result)).not.toContain(env.NAVER_CLIENT_SECRET);
  });
  it.each(["", "  ", "x".repeat(201), env.NAVER_CLIENT_SECRET])("rejects invalid query without fetch", async query => {
    const fetchImpl = vi.fn(); expect(await call(fetchImpl, {}, query)).toMatchObject({ error: { code: "invalid_query" } }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([[0, "1"], [101, "100"], [3.9, "3"], [NaN, "10"]])("clamps display %s", async (display, expected) => {
    const fetchImpl = vi.fn(async () => response({ items: [] })); await call(fetchImpl, { display });
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("display")).toBe(expected);
  });
});

describe("optional lexical relevance and recency filter", () => {
  const now = Date.parse("2026-10-28T01:00:00Z");
  const article = (title, description = "", pubDate = "2026-10-28T00:00:00Z") => ({ title, description, pubDate });
  it("matches title/description, aliases, case and Korean particles but avoids SKT", () => {
    const rows = [article("KT가 발표"), article("소식", "kt 통신"), article("SKT 발표"), article("케이티 소식"), article("KTX 운행")];
    expect(filterRelevantNaverNews(rows, "KT", { now, aliases: ["케이티"] })).toEqual([rows[0], rows[1], rows[3]]);
  });
  it("drops stale/future/invalid dates, handles exact boundary and curated Korean aliases", () => {
    const rows = [article("하이닉스 소식"), article("SK하이닉스", "", "2026-10-21T01:00:00Z"), article("SK하이닉스", "", "2026-10-21T00:59:59Z"), article("SK하이닉스", "", "2026-10-29T00:00:00Z"), article("SK하이닉스", "", "invalid")];
    expect(filterRelevantNaverNews(rows, "SK하이닉스", { now, aliases: ["하이닉스"] })).toEqual(rows.slice(0, 2));
    expect(filterRelevantNaverNews(rows, "SK하이닉스", { now, maxAgeDays: 0 })).toEqual([]);
    expect(filterRelevantNaverNews(rows, "", { now })).toEqual([]);
    expect(filterRelevantNaverNews(rows, "SK하이닉스", { now: NaN })).toEqual([]);
  });
});
