import { describe, expect, it, vi } from "vitest";
const captured = vi.hoisted(() => ({ options: null }));
vi.mock("node:dns/promises", () => { const api = { lookup: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) }; return { ...api, default: api }; });
vi.mock("node:https", async () => {
  const { EventEmitter } = await import("node:events");
  const api = { request: vi.fn((_url, options, callback) => {
    captured.options = options;
    const request = new EventEmitter(); request.end = () => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.headers = { "content-type": "text/html; charset=utf-8" };
      callback(response); response.emit("data", Buffer.from("<article>기사</article>")); response.emit("end");
    }); return request;
  }) }; return { ...api, default: api };
});
import { fetchPublicArticle, ARTICLE_USER_AGENT } from "../../server/articleBodies";
describe("public DNS-pinned article transport", () => {
  it("disables auto-family lookup before pinning a single validated public address", async () => {
    const signal = new AbortController().signal;
    expect((await fetchPublicArticle("https://paper.example/article", { signal })).status).toBe(200);
    expect(captured.options.autoSelectFamily).toBe(false);
    const answer = vi.fn(); captured.options.lookup("paper.example", {}, answer);
    expect(answer).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(captured.options.headers["User-Agent"]).toBe(ARTICLE_USER_AGENT);
    expect(captured.options.signal).toBe(signal);
  });
});
