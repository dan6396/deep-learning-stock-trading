import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("node:fs/promises", () => { const api = { writeFile: vi.fn(async () => {}), readFile: vi.fn(async () => { throw Error("missing"); }), mkdir: vi.fn(), rename: vi.fn() }; return { ...api, default: api }; });
import { checkStockSentence, neutralTopicReason, STOCK_SENTENCE_FORMS } from "../../server/stockSentenceAllowlist";
import { stockSentenceContext } from "../../server/stockSentenceContext";
import { selectStockOpinion, stockOpinionSentenceReason } from "../../server/stockOpinion";
import { selectHeadlineSummary } from "../../server/briefingExtensions";
import { selectCompanyNaverNews, excludedNewsTopic } from "../../server/naverNewsCollection";
import { collectTopFiveArticles } from "../../server/relatedNews";
import { removeArticlePassages } from "../../server/articlePrivacy";

const id = "N:030200:1", now = Date.parse("2026-10-28T01:00:00Z");
const base = () => ({ newsValidation: "on", model: { baseDate: "2026-10-27" }, macro: { indicators: [], preOpen: [] }, stocks: [{ code: "030200", name: "KT", rank: 1, rankScore: 1.7, poolSize: 200, topPercent: .5,
  analysisMetrics: { rawRank: 1, adjustedRank: 1, lookbacks: [], features: [], agreement: null }, evidence: [], cautions: [],
  news: { status: "collected", articles: [{ id, title: "KT 공시 서비스 공개", source: "가일보", url: "https://paper.example/a" }] } }] });
const context = data => stockSentenceContext(data, 0, "opinion", ["R:030200", id, ...(data.macro.preOpen ?? []).map(row => `M:${row.id}`)]);
afterEach(() => vi.restoreAllMocks());

describe("review recommendation 1: level is not a change direction", () => {
  const data = base(); data.macro.preOpen = [
    { id: "NASDAQ", name: "나스닥", status: "ok", unit: "pt", value: 18000, change: -100, changePct: -.55, history: [] },
    { id: "USDKRW", name: "원/달러 환율", status: "ok", unit: "원", value: 1400, change: -5, changePct: -.35, history: [] },
    { id: "UST10Y", name: "금리", status: "ok", unit: "%", value: 4.2, change: -.002, changePct: -.04, history: [] },
  ];
  it.each(["나스닥 18000pt 상승 마감했습니다.", "원/달러 환율 1,400원 상승입니다.", "금리 4.2% 상승입니다."])("rejects direction attached to positive level: %s", text => {
    expect(checkStockSentence(text, context(data)).accepted).toBe(false);
    expect(stockOpinionSentenceReason(text, data, 0, new Set(context(data).citations))).not.toBeNull();
  });
  it.each(["나스닥 18000pt입니다.", "원/달러 환율 1,400원입니다.", "금리 4.2%입니다.", "나스닥 전일 대비 0.55% 하락 마감했습니다."])("retains a level or actual change: %s", text => expect(checkStockSentence(text, context(data)).accepted).toBe(true));
});

describe("review recommendation 2 and 5: financial terms and collection status", () => {
  it.each(["금융감독원 공시", "금융감독위원회 공시", "선수금 계약", "우선수익권 계약", "배우자 주식 공시"])("keeps legitimate finance text: %s", topic => expect(excludedNewsTopic(`KT ${topic}`)).toBe(false));
  it.each(["KT wiz 선수 계약", "KT 감독 선임", "KT 선수단 영입", "KT 배우 출연 계약", "KT 아이돌 콘서트"])("still excludes explicit sports/entertainment: %s", text => expect(excludedNewsTopic(text)).toBe(true));
  it("reports counts/reason codes only and retains legitimate finance search rows", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const titles = ["KT 금융감독원 공시", "KT 선수금 계약", "KT 우선수익권 계약", "KT 배우자 주식 공시", "KT 감독 선임", "KT 배우 출연"];
    const items = titles.map((title, index) => ({ title, description: "비공개발췌표식", originalUrl: `https://paper.example/${index}`, naverUrl: "https://n.news.naver.com/article/1", sourceHost: "paper.example", pubDate: new Date(now).toISOString() }));
    expect(selectCompanyNaverNews(items, "KT", now)).toHaveLength(4);
    expect(info.mock.calls[0][1].reasonCounts).toEqual({ sports_topic: 1, entertainment_topic: 1 });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/금융감독원|배우자|비공개발췌표식|paper\.example/);
  });
  it("does not turn filtered zero and failed RSS into a successful zero", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetcher = vi.fn(async url => { if (new URL(url).hostname !== "openapi.naver.com") throw Error("RSS failed"); return new Response(JSON.stringify({ items: [{ title: "KT wiz 선수 계약", description: "KT 선수 계약", originallink: "https://sports.example/a", link: "https://sports.news.naver.com/a", pubDate: new Date(now).toUTCString() }] })); });
    const result = await collectTopFiveArticles([{ ticker: "030200", company_name: "KT", pred_rank: "1", prediction_base_date: "2026-10-27" }], "recommendation-zero", 123, fetcher, undefined,
      { now: () => now, env: { NAVER_CLIENT_ID: "fixture-client", NAVER_CLIENT_SECRET: "fixture-secret" } });
    expect(result.stocks["030200"]).toMatchObject({ status: "collection_failed", articles: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("review recommendations 3 and 4: local topics and meaningful minimum", () => {
  it.each([["배당 결정", "배당 중단 결정 번복"], ["계약 체결", "계약 취소 체결 철회"], ["서비스 공개", "서비스 미정 공개 예정"], ["신제품 출시", "신제품 미출시 출시 부인"]])("rejects skipped substantive words: %s", (topic, title) => {
    const data = base(); data.stocks[0].news.articles[0].title = title;
    expect(neutralTopicReason(topic, context(data)).reason).toBe("topic_not_local");
  });
  it("allows registered glue but not arbitrary words in the gap", () => {
    const data = base(); data.stocks[0].news.articles[0].title = "배당 관련 결정";
    expect(neutralTopicReason("배당 결정", context(data)).reason).toBeNull();
  });
  it("cannot fill the minimum with disclaimers or repeated topics", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(selectStockOpinion({ code: "030200", text: "모델 순위 1위입니다. 주가 예측이 아닙니다. 방향 판단은 하지 않습니다.", citations: ["R:030200"] }, base(), 0)).toBeNull();
    expect(selectHeadlineSummary({ code: "030200", text: "서비스 공개를 다룬 기사입니다. 서비스 공개를 다룬 기사를 보도했습니다.", citations: [id] }, base(), 0)).toBeNull();
    expect(selectHeadlineSummary({ code: "030200", text: "서비스 공개를 다룬 기사입니다. 공개를 다룬 기사입니다.", citations: [id] }, base(), 0)).toBeNull();
    const selected = selectHeadlineSummary({ code: "030200", text: "서비스 공개를 다룬 기사입니다. 서비스 공개를 다룬 기사를 보도했습니다. 공시를 다룬 기사입니다.", citations: [id] }, base(), 0);
    expect(selected?.text).toBe("서비스 공개를 다룬 기사입니다. 공시를 다룬 기사입니다.");
    expect(selected?.sentenceCitations).toEqual([[id], [id]]);
  });
  it.each([
    ["005930", "삼성전자", "삼성전자 GalaxyS26 서비스 공개", "GalaxyS26 서비스 공개"],
    ["005380", "현대차", "현대차 '블루링크' 서비스 개편", "블루링크 서비스 개편"],
    ["105560", "KB금융", "KB금융 여의도센터 신규 서비스 공개", "여의도센터 신규 서비스 공개"],
  ])("generalizes proper-name slots to a different company/title: %s", (code, name, title, topic) => {
    const data = base(); Object.assign(data.stocks[0], { code, name }); data.stocks[0].news.articles[0].title = title;
    expect(checkStockSentence(`${topic}를 다룬 기사입니다.`, stockSentenceContext(data, 0, "news", [id])).accepted).toBe(true);
  });
  it.each(["우량성", "탁월성", "성장세", "긍정센터", "신뢰A1"])("never promotes source words with evaluative meaning: %s", term => {
    const data = base(); data.stocks[0].news.articles[0].title = `KT '${term}' 공개`;
    expect(neutralTopicReason(`${term} 공개`, context(data)).reason).toBe("topic_not_neutral");
  });
  it("removes article-specific seed nouns and limits each proper slot to one use per sentence", () => {
    for (const token of ["토큰팩토리", "연습경기", "관중석", "센텀시티점"]) expect(STOCK_SENTENCE_FORMS.topicNouns).not.toContain(token);
    const data = base(); data.stocks[0].news.articles[0].title = "KT GalaxyS26 서비스 공개";
    data.articleExcerpts = { [id]: { text: "GalaxyS26 공시 발표" } };
    expect(checkStockSentence("GalaxyS26 서비스 공개를 다룬 기사이며 GalaxyS26 공시 발표를 다룬 기사입니다.", context(data)).accepted).toBe(false);
  });
});

describe("review recommendations 6 and 7: privacy threshold and actual provenance", () => {
  it("allows short quotes and blocks only sentences with at least 40 copied characters", () => {
    const short = "가".repeat(39), long = "나".repeat(40);
    expect(removeArticlePassages({ text: short }, { ...base(), articleExcerpts: { [id]: { text: short } } })).toEqual({ text: short });
    expect(removeArticlePassages({ text: long }, { ...base(), articleExcerpts: { [id]: { text: long } } })).toEqual({ text: "" });
  });
  it.each([true, false])("uses source spans, with explicit sentence citations=%s", explicit => {
    const candidate = { code: "030200", text: "공시를 다룬 기사입니다. 서비스 공개를 다룬 기사입니다.", citations: [id], ...(explicit ? { sentenceCitations: [[id], [id]] } : {}) };
    const title = { ...base(), articleExcerpts: { [id]: { text: "신제품 출시 계약 체결" } }, articleBodies: { [id]: { text: "신제품 출시 계약 체결" } } };
    expect(selectHeadlineSummary(candidate, title, 0)?.summaryBasis).toBe("title");
    for (const kind of ["articleExcerpts", "articleBodies"]) {
      const data = base(); data.stocks[0].news.articles[0].title = "KT 기업 공시"; data[kind] = { [id]: { text: "공시 서비스 공개" } };
      expect(selectHeadlineSummary(candidate, data, 0)?.summaryBasis).toBe(kind === "articleExcerpts" ? "excerpt" : "body");
    }
  });
  it("uses the completed event's real body proof even when nouns already occur in its title", () => {
    const data = base(); data.stocks[0].news.articles[0].title = "KT 공시 발표 서비스 개편";
    data.articleBodies = { [id]: { text: "공시를 발표했습니다." } };
    expect(selectHeadlineSummary({ code: "030200", text: "공시를 발표했다고 보도했습니다. 서비스 개편을 다룬 기사입니다.", citations: [id] }, data, 0)?.summaryBasis).toBe("body");
  });
});
