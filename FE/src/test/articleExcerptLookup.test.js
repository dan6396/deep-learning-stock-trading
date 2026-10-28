import { describe, expect, it, vi } from "vitest";
import { articleExcerptLookup, cachedArticleExcerpts, rememberArticleExcerpt } from "../../server/articleExcerpts";
const stocks = url => [{ news: { articles: [{ id: "N:030200:1", url }] } }];
describe("private excerpt lookup identity", () => {
  it("normalizes directory aliases and tracking/query/hash URL differences", () => {
    const dir = "node_modules/.tmp/excerpt-identity";
    rememberArticleExcerpt(`${dir}/child/..`, "https://PAPER.example:443/a?z=2&utm_source=test&a=1#headline", "PRIVATE_EXCERPT_LOOKUP_SENTINEL", 1000);
    const articles = stocks("https://paper.example/a?a=1&z=2&fbclid=tracking#other");
    expect(articleExcerptLookup(articles, dir, 2000)).toMatchObject({ requested: 1, found: 1, missing: 0, expired: 0, cacheVersion: 2 });
    expect(cachedArticleExcerpts(articles, dir, 2000)["N:030200:1"].text).toBe("PRIVATE_EXCERPT_LOOKUP_SENTINEL");
    expect(articleExcerptLookup(articles, `${dir}-different`, 2000)).toMatchObject({ found: 0, missing: 1 });
    expect(JSON.stringify(articleExcerptLookup(articles, dir, 2000))).not.toMatch(/PRIVATE_EXCERPT|paper|identity/);
  });
  it("retains private memory across a same-process server module reload", async () => {
    rememberArticleExcerpt("node_modules/.tmp/excerpt-module-reload", "https://paper.example/reload", "MODULE_RELOAD_SENTINEL", 1000);
    vi.resetModules();
    const reloaded = await import("../../server/articleExcerpts");
    expect(reloaded.cachedArticleExcerpts(stocks("https://paper.example/reload"), "node_modules/.tmp/excerpt-module-reload", 1001)["N:030200:1"].text).toBe("MODULE_RELOAD_SENTINEL");
  });
  it("distinguishes TTL expiration from missing and fails closed on malformed URLs", () => {
    const dir = "node_modules/.tmp/excerpt-expiration";
    rememberArticleExcerpt(dir, "https://paper.example/expire", "SYNTHETIC_PRIVATE_TEXT", 1000);
    const articles = stocks("https://paper.example/expire");
    expect(articleExcerptLookup(articles, dir, 86_401_000)).toMatchObject({ found: 0, expired: 1, missing: 0 });
    expect(cachedArticleExcerpts(articles, dir, 86_401_000)).toEqual({});
    expect(articleExcerptLookup(articles, dir, 86_401_001)).toMatchObject({ expired: 0, missing: 1 });
    for (const url of ["broken", "file:///c:/private", "javascript:alert(1)"]) {
      expect(() => rememberArticleExcerpt(dir, url, "IGNORED")).not.toThrow();
      expect(cachedArticleExcerpts(stocks(url), dir)).toEqual({});
      expect(articleExcerptLookup(stocks(url), dir)).toMatchObject({ found: 0, missing: 1 });
    }
  });
});
