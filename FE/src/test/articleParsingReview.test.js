import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { robotsAllowed, robotsGlobMatches, extractArticleText, publicAddress, createArticleBodyStore } from "../../server/articleBodies";
import { articleBodyHashes, removeArticlePassages } from "../../server/articlePrivacy";
import { briefingInputHash } from "../../server/briefingNarrative";
describe("bounded article and robots parsing", () => {
  it("matches star/end globs without regular-expression backtracking", () => {
    for (const [pattern, path, expected] of [["/foo*bar$", "/foo/a/bar", true], ["/foo*bar$", "/foobar/more", false], ["/foo*bar", "/foo/bar/more", true], ["/*a*a*a*a$", "/aaaab", false], ["/foo$", "/foo", true], ["/*", "/any/path", true]]) expect(robotsGlobMatches(pattern, path)).toBe(expected);
    const url = "https://paper.example/" + "a".repeat(2000), policy = "User-agent: *\nDisallow: /*a*a*a*a";
    const start = performance.now(); for (let i = 0; i < 100; i++) expect(robotsAllowed(policy, url)).toBe(false);
    const mean = (performance.now() - start) / 100; expect(mean).toBeLessThan(5); console.info("[robots performance]", JSON.stringify({ meanMs: mean, pathLength: 2001, repeats: 100 }));
  });
  it("bounds rules, stars, path size and matches only the exact product token", () => {
    expect(robotsAllowed("User-agent: *\nAllow: /\nUser-agent: Briefing\nDisallow: /", "https://paper.example/a")).toBe(true);
    expect(robotsAllowed("User-agent: *\nAllow: /\nUser-agent: stockbriefingresearch\nDisallow: /", "https://paper.example/a")).toBe(false);
    expect(robotsAllowed("User-agent: \nDisallow: /", "https://paper.example/a")).toBe(true);
    expect(robotsAllowed("User-agent: *\n" + "Allow: /\n".repeat(2049), "https://paper.example/a")).toBe(false);
    expect(robotsAllowed("User-agent: *\nDisallow: /" + "*".repeat(65), "https://paper.example/a")).toBe(false);
  });
  it("rejects 300KB of unclosed nav tags in less than 100ms", () => {
    const html = "<nav>".repeat(60000), start = performance.now(); expect(extractArticleText(html)).toBeNull();
    const elapsed = performance.now() - start; expect(elapsed).toBeLessThan(100); console.info("[article performance]", JSON.stringify({ ms: elapsed, bytes: html.length, tags: 60000 }));
  });
  it("keeps nested article text but excludes nav/script/ad descendants", () => {
    const fact = "회사는 신규 서비스와 운영 현황을 발표했다고 보도했습니다. ".repeat(10);
    const text = extractArticleText(`<article><div><p>${fact}</p><nav>HIDDEN_NAV</nav><div class="advert">HIDDEN_AD</div><script>HIDDEN_SCRIPT</script></div></article>`);
    expect(text).toContain(fact.trim()); expect(text).not.toMatch(/HIDDEN_/);
  });
  it("rejects Teredo, documentation and translated special IPv6 ranges", () => {
    for (const address of ["2001::1", "2001:0000:1234::1", "3fff::1", "3fff:abc::1", "2002:7f00:1::1"]) expect(publicAddress(address)).toBe(false);
    expect(publicAddress("2606:4700::1111")).toBe(true);
  });
  it("uses the same body hash with or without plaintext and removes long copied passages field by field", () => {
    const text = ("PRIVATE_RAW_SENTINEL 기사가 공개한 서비스 안내와 관측된 운영 현황을 그대로 기록했습니다. ").repeat(5);
    const input = { model: null, macro: { indicators: [] }, stocks: [{ rank: 1, code: "005930", name: "삼성전자", rankScore: 1.7, poolSize: 200, evidence: [], cautions: [], news: { status: "collected", articles: [{ id: "N:005930:1", title: "공시", url: "https://paper.example/a", source: "가일보" }] } }], articleBodies: { "N:005930:1": { text } } };
    const stored = { ...input, articleBodies: undefined, articleBodyHashes: articleBodyHashes(input) };
    expect(briefingInputHash(stored)).toBe(briefingInputHash(input));
    expect(briefingInputHash({ ...input, articleBodies: { "N:005930:1": { text: text + "정정된 기사입니다." } } })).not.toBe(briefingInputHash(stored));
    // Whole source sentences are removed; a truncated final fragment below 40
    // characters is deliberately permitted by the new short-quote policy.
    expect(removeArticlePassages({ overview: text.trim(), marketNote: "독립된 관측 요약입니다." }, input)).toEqual({ overview: "", marketNote: "독립된 관측 요약입니다." });
    expect(removeArticlePassages({ overview: text.trim() + " 독립된 관측 요약입니다." }, input)).toEqual({ overview: "독립된 관측 요약입니다." });
  });
  it("accepts only HTML/XHTML for extraction even when another content type contains article markup", async () => {
    const store = createArticleBodyStore({ directory: "node_modules/.tmp/non-html", transport: async url => url.endsWith("robots.txt") ? { status: 404, text: "" } : { status: 200, contentType: "application/pdf", text: "<article>" + "article".repeat(100) + "</article>" } });
    expect((await store.collect("https://paper.example/a")).reason).toBe("unsupported_content_type");
  });
});
