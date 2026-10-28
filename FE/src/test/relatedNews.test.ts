import { describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => { const mocks = { writeFile: vi.fn(async () => {}) }; return { ...mocks, default: mocks }; });
import { attachRelatedNews, collectTopFiveArticles, parseRelatedNews } from "../../server/relatedNews";
import { isRelatedArticle } from "../shared/lib/relatedArticles";
import { pipelineRow } from "./dataFixtures";

const item = (title: string, url = "https://news.google.com/rss/articles/fixture", source = "테스트일보") => `<item><title><![CDATA[${title} - ${source}]]></title><link>${url}</link><source url="https://example.com">${source}</source><pubDate>Sat, 10 Oct 2026 10:30:00 GMT</pubDate></item>`;
const feed = (items: string) => `<rss version="2.0"><channel>${items}</channel></rss>`;

describe("related articles without news analysis", () => {
  it.each(["삼성전자 실적 발표", "[속보] 삼성전자는 실적 발표", "삼성전자의 실적", "삼성전자에서 발표", "삼성전자·SK하이닉스 동반 상승"])("accepts company-name boundaries and grammatical particles: %s", title => {
    expect(isRelatedArticle(title, "삼성전자")).toBe(true);
  });
  it.each(["삼성전자서비스 실적", "삼성전자우 상승", "삼성전자판매 실적", "삼성전자동차 소식", "한국삼성전자 실적", "삼성전자가구 할인", "시장 전반 상승"])("rejects peers, company suffixes and unrelated headlines: %s", title => {
    expect(isRelatedArticle(title, "삼성전자")).toBe(false);
  });
  it("keeps Orion Holdings particles, regex punctuation and exact short-company names safe", () => {
    expect(isRelatedArticle("오리온홀딩스의 실적 발표", "오리온홀딩스")).toBe(true);
    expect(isRelatedArticle("오리온홀딩스 실적 발표", "오리온")).toBe(false);
    expect(isRelatedArticle("한화솔루션 실적", "한화")).toBe(false);
    expect(isRelatedArticle("한화, 가을야구 진출", "한화")).toBe(false);
    expect(isRelatedArticle("기아 문제 심각, 식량 지원 필요", "기아")).toBe(false);
    expect(isRelatedArticle("오리온 별자리 관측", "오리온")).toBe(false);
    expect(isRelatedArticle("대상 수상한 배우", "대상")).toBe(false);
    expect(isRelatedArticle("한화는 실적 발표", "한화")).toBe(true);
    expect(isRelatedArticle("S-Oil은 실적 발표", "S-Oil")).toBe(true);
    expect(isRelatedArticle("LGX화학 실적", "LG.화학")).toBe(false);
    expect(isRelatedArticle("삼성전자", null)).toBe(false);
  });
  it("parses source/date/link, filters company names, unsafe URLs and duplicates without sentiment", () => {
    const articles = parseRelatedNews(feed(item("삼성전자 실적 &amp; 전망") + item("삼성전자서비스 실적", "https://example.com/peer") + item("시장 전망", "https://example.com/general") + item("삼성전자 실적", "javascript:alert(1)") + item("삼성전자 다른 제목")), "삼성전자");
    expect(articles).toEqual([{ index: 1, title: "삼성전자 실적 & 전망", source: "테스트일보", pub_date: "2026-10-10T10:30:00.000Z", url: "https://news.google.com/rss/articles/fixture" }]);
    expect(() => parseRelatedNews("<html>blocked</html>", "삼성전자")).toThrow("Invalid news feed");
    expect(parseRelatedNews(feed(""), "삼성전자")).toEqual([]);
    const unordered = [1, 4, 2, 3].map(day => item(`삼성전자 실적 ${day}`, `https://example.com/${day}`).replace("10 Oct 2026", `0${day} Oct 2026`)).join("");
    expect(parseRelatedNews(feed(unordered), "삼성전자").map(article => article.url)).toEqual(["https://example.com/4", "https://example.com/3", "https://example.com/2"]);
  });
  it("requests exactly five raw model ranks from the fixed RSS provider; distinguishes failure and successful zero", async () => {
    const records = [6, 3, 1, 5, 2, 4, 7].map(rank => ({ ticker: String(100000 + rank), company_name: `테스트${rank}`, pred_rank: String(rank), prediction_base_date: "2026-10-08" }));
    const transport = vi.fn<typeof fetch>(async url => {
      const query = new URL(String(url)).searchParams.get("q");
      if (query?.includes("테스트2")) throw new Error("offline");
      if (query?.includes("테스트3")) return new Response("<html>blocked</html>");
      return new Response(feed(query?.includes("테스트1") ? item("테스트1 실적") : ""));
    });
    const bodies = vi.fn(async () => []);
    const result = await collectTopFiveArticles(records, "fixture-output", 123, transport, bodies);
    expect(bodies).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledTimes(5);
    expect(Object.keys(result.stocks)).toEqual(["100001", "100002", "100003", "100004", "100005"]);
    for (const [url, options] of transport.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://news.google.com");
      expect(new URL(String(url)).pathname).toBe("/rss/search");
      expect(options?.redirect).toBe("error");
    }
    expect(result.stocks["100001"].articles).toHaveLength(1);
    expect(result.stocks["100002"].status).toBe("collection_failed");
    expect(result.stocks["100003"].status).toBe("collection_failed");
    expect(result.stocks["100004"]).toMatchObject({ status: "collected", articles: [] });
    const row = pipelineRow({ ticker: "100001", company_name: "테스트1", prediction_base_date: "2026-10-08", pred_rank: 1, ensemble_pred_return: .01 });
    row.result.ticker = "100001"; row.result.company_name = "테스트1";
    const [current] = attachRelatedNews([row as never], result, 123);
    expect(current.input_row).toEqual(row.input_row);
    expect(current.news).toHaveLength(1);
    expect(current.news[0]).not.toHaveProperty("sentiment");
    expect(attachRelatedNews([row as never], result, 124)[0]).toMatchObject({ news: [], data_meta: { newsStatus: "not_collected" } });
    const otherDay = { ...row, input_row: { ...row.input_row, prediction_base_date: "2026-10-09" } };
    expect(attachRelatedNews([otherDay as never], result, 123)[0].news).toEqual([]);
  });
});
