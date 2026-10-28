import { afterEach, describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/news-source-grounding.json";
import replay from "./fixtures/narrative-0154-replay.json";
import { firstReviewAttacks, secondReviewNewsAttacks } from "./fixtures/stockSentenceReviewAttacks";
import { headlineSentenceReason, selectHeadlineSummary, templateExtensions } from "../../server/briefingExtensions";
import { checkNewsSentence } from "../../server/newsSentenceGrounding";
import { stockSentenceContext } from "../../server/stockSentenceContext";

const id = "N:030200:1", other = "N:030200:2";
const input = (title = "KT 서비스 공개 계약 공시", excerpt = "", body = "") => ({ newsValidation: "on", model: null, macro: { indicators: [], preOpen: [] },
  stocks: [{ code: "030200", name: "KT", rank: 1, rankScore: 1, poolSize: 200, topPercent: .5, evidence: [], cautions: [],
    news: { status: "collected", articles: [{ id, title, source: "가일보", url: "https://paper.example/a" }, { id: other, title: "KT 계약 규모 999억원", source: "나일보", url: "https://paper.example/b" }] } }],
  articleExcerpts: excerpt ? { [id]: { text: excerpt } } : {}, articleBodies: body ? { [id]: { text: body } } : {} });
afterEach(() => vi.restoreAllMocks());

describe("source-grounded attributed news, independent of opinion noun registry", () => {
  it.each(fixtures.rows)("adopts two facts from synthetic excerpt/body with real public title: $code $articleId", row => {
    const data = input(row.title); Object.assign(data.stocks[0], { code: row.code, name: row.name });
    data.stocks[0].news.articles = [{ id: row.articleId, title: row.title, source: "가일보", url: "https://paper.example/a" }];
    data.articleExcerpts = { [row.articleId]: { text: row.syntheticExcerpt } }; data.articleBodies = { [row.articleId]: { text: row.syntheticBody } };
    const candidate = { code: row.code, text: row.sentences.join(" "), citations: [row.articleId], sentenceCitations: [[row.articleId], [row.articleId]] };
    for (const text of row.sentences) expect(headlineSentenceReason(text, data, 0, [row.articleId])).toBeNull();
    expect(selectHeadlineSummary(candidate, data, 0)).toMatchObject({ text: candidate.text, source: "llm", summaryBasis: "body" });
  });
  it.each([
    ["삼성전자 양자칩 시제품 공개", "양자칩 시제품 공개"],
    ["현대차 수소버스 공급 협약", "수소버스 공급 협약"],
    ["KB금융 재해복구센터 준공", "재해복구센터 준공"],
  ])("uses source words outside the opinion dictionary: %s", (title, topic) => {
    const data = input(title); data.stocks[0].name = title.split(" ")[0];
    expect(headlineSentenceReason(`${topic}를 다룬 기사입니다.`, data, 0, [id])).toBeNull();
    expect(headlineSentenceReason(`${topic}와 해저터널을 다룬 기사입니다.`, data, 0, [id])).toBe("source_not_grounded");
  });
  it.each(["급등", "급락", "반등", "랠리", "목표주가", "호재", "악재", "긍정적", "부정적", "좋은 소식", "나쁜 소식", "매수", "매도", "보유", "비중", "추천", "권유", "기대수익", "확률", "주가가 오를 것", "가격이 내릴 것", "외국인 순매수"])("rejects a prohibited claim even when literally in its source: %s", term => {
    const text = `${term}를 다룬 기사입니다.`, data = input(`KT ${term}`);
    expect(headlineSentenceReason(text, data, 0, [id])).not.toBeNull();
  });
  it.each(["중단", "번복", "무산", "취소", "철회", "보류", "연기"])("preserves %s and cannot skip it", term => {
    const data = input(`KT 배당 ${term} 결정`);
    expect(headlineSentenceReason("배당 결정을 다룬 기사입니다.", data, 0, [id])).not.toBeNull();
    expect(headlineSentenceReason("배당을 다룬 기사입니다.", data, 0, [id])).toBe("negation_omitted");
    expect(headlineSentenceReason(`배당 ${term} 결정을 다룬 기사입니다.`, data, 0, [id])).toBeNull();
  });
  it("retains negation after a matching span, including separated clauses", () => {
    const data = input("KT 서비스 공개 결정이 취소됐다");
    expect(headlineSentenceReason("서비스 공개 결정을 다룬 기사입니다.", data, 0, [id])).toBe("negation_omitted");
    expect(headlineSentenceReason("기사에 따르면 서비스 공개 결정이 취소됐습니다.", data, 0, [id])).toBeNull();
    expect(headlineSentenceReason("서비스 공개를 다룬 기사입니다.", input("KT 서비스 공개가 아니다"), 0, [id])).toBe("negation_omitted");
  });
  it("requires attribution, whole same-clause facts, matching numbers and an allowed stock", () => {
    const data = input("KT 서비스 공개", "계약 규모는 120억원이다. 계약 기간은 3년이다. 삼성전자 계약 체결");
    expect(headlineSentenceReason("계약 규모는 120억원입니다.", data, 0, [id])).toBe("missing_attribution");
    expect(headlineSentenceReason("기사에 따르면 계약 규모는 120억원입니다.", data, 0, [id])).toBeNull();
    for (const value of ["999억원", "0.012조원", "120원"]) expect(headlineSentenceReason(`계약 규모 ${value}을 다룬 기사입니다.`, data, 0, [id])).toBe("ungrounded_number");
    expect(headlineSentenceReason("계약 규모 120억원을 다룬 기사입니다.", data, 0, [other])).toBe("ungrounded_number");
    expect(headlineSentenceReason("계약 규모 3년을 다룬 기사입니다.", data, 0, [id])).toBe("source_not_grounded");
    expect(headlineSentenceReason("삼성전자 계약 체결을 다룬 기사입니다.", data, 0, [id])).toBe("forbidden_content");
    expect(headlineSentenceReason("서비스 공개 계약 기간을 다룬 기사입니다.", data, 0, [id])).toBe("source_not_grounded");
  });
  it.each([...firstReviewAttacks, ...secondReviewNewsAttacks.map(text => text.replace("{topic}", "서비스 공개"))])("rejects preserved news review bypass: %s", text => {
    expect(headlineSentenceReason(text, input(`KT 서비스 공개. ${text}`), 0, [id])).not.toBeNull();
  });
  it("excludes repeated and fixed sentences from the minimum and removes duplicate sentences", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const select = text => selectHeadlineSummary({ code: "030200", text, citations: [id] }, input(), 0);
    expect(select("서비스 공개를 다룬 기사입니다. 서비스 공개를 다룬 기사입니다.")).toBeNull();
    expect(select("서비스 공개를 다룬 기사입니다. 기사 본문 확보 여부는 기사마다 다릅니다.")).toBeNull();
    expect(select("서비스 공개를 다룬 기사입니다. 서비스 공개를 다룬 기사입니다. 계약 공시를 다룬 기사입니다.")?.text).toBe("서비스 공개를 다룬 기사입니다. 계약 공시를 다룬 기사입니다.");
    expect(templateExtensions(input()).newsSummaries[0]).not.toHaveProperty("summaryBasis");
  });
  it("records actual source proof, not just available context, and uses no opinion lexicon", () => {
    const data = input("KT 서비스 공개", "계약 규모 120억원", "운영 일정 11월 5일");
    for (const [text, expected] of [["서비스 공개를 다룬 기사입니다.", "title"], ["계약 규모 120억원을 다룬 기사입니다.", "excerpt"], ["운영 일정 11월 5일을 다룬 기사입니다.", "body"]]) {
      const check = checkNewsSentence(text, stockSentenceContext(data, 0, "news", [id]));
      expect(check.accepted).toBe(true); expect(check.spans[0].sourceOffsets.every(span => span.sourceKind === expected)).toBe(true);
    }
  });
  it("rejudges the immutable 01:54 fixture without runtime files or provider requests", () => {
    const result = replay.rawFields.newsSummaries.map((row, index) => ({ code: row.code,
      acceptedSentences: row.text.split(/(?<=[.!?。])\s+/).filter(text => headlineSentenceReason(text, { ...replay.input, newsValidation: "on" }, index, row.citations) === null).length,
      field: selectHeadlineSummary(row, { ...replay.input, newsValidation: "on" }, index)?.source ?? "template" }));
    expect(result).toHaveLength(5); expect(result.every(row => row.field === "template")).toBe(true);
    console.info("[0154 source-grounded policy replay]", result);
  });
});
