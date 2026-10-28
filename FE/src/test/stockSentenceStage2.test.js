import { afterEach, describe, expect, it, vi } from "vitest";
import { secondReviewOpinionAttacks, secondReviewNewsAttacks, firstReviewAttacks, reviewNormalControls } from "./fixtures/stockSentenceReviewAttacks";
import { checkStockSentence, STOCK_SENTENCE_POLICY_VERSION, STOCK_SENTENCE_FORMS } from "../../server/stockSentenceAllowlist";
import { stockSentenceContext } from "../../server/stockSentenceContext";
import { stockOpinionSentenceReason, selectStockOpinion, templateStockOpinion } from "../../server/stockOpinion";
import { headlineSentenceReason, selectHeadlineSummary } from "../../server/briefingExtensions";

const code = "030200", id = "N:030200:1", topic = "신제품 공개 일정";
const data = { newsValidation: "on", model: { baseDate: "2026-10-27" }, macro: { indicators: [], preOpen: [] }, stocks: [{ code, name: "KT", rank: 1, poolSize: 199, topPercent: .5, rankScore: 1.7031,
  evidence: [{ id: "E:030200:1", kind: "model", text: "모델 순위 1위입니다." }], cautions: [],
  analysisMetrics: { rawRank: 1, adjustedRank: 1, lookbacks: [{ sessions: 20, rank: 1, topPercent: .5 }, { sessions: 120, rank: 1, topPercent: .5 }], agreement: "일치", features: [{ key: "f_rsi", percentile: 79, side: "upper", tailPercent: 21 }] },
  news: { status: "collected", articles: [{ id, title: `KT ${topic} 공시 서비스 개편`, source: "가일보", url: "https://paper.example/a" }] } }],
  articleExcerpts: { [id]: { text: "신제품 공개 일정을 발표했습니다." } }, articleBodies: { [id]: { text: "신제품 공개 일정을 발표했습니다." } } };
const citations = ["R:030200", "R:030200:raw", "R:030200:adjusted", "R:030200:20", "R:030200:120", "E:030200:feature:f_rsi", "E:030200:1", id];
const opinionReason = text => stockOpinionSentenceReason(text, data, 0, new Set(citations));
const newsReason = text => headlineSentenceReason(text, data, 0, [id], [id]);
afterEach(() => vi.restoreAllMocks());

describe("preserved code-review bypass evidence", () => {
  it.each(secondReviewOpinionAttacks)("rejects review round 2 opinion: %s", text => {
    // The fixture's ranks, agreement and feature tail all match the input.
    expect(opinionReason(text)).not.toBeNull();
    expect(checkStockSentence(text, stockSentenceContext(data, 0, "opinion", citations)).accepted).toBe(false);
  });
  it.each(secondReviewNewsAttacks)("rejects review round 2 news with genuinely grounded topic: %s", pattern => {
    const text = pattern.replace("{topic}", topic);
    expect(newsReason(text)).not.toBeNull();
    expect(checkStockSentence(text, stockSentenceContext(data, 0, "news", [id])).accepted).toBe(false);
  });
  it.each(firstReviewAttacks)("rejects review round 1 with valid fact/topic prefix too: %s", text => {
    expect(opinionReason(text)).not.toBeNull(); expect(newsReason(text)).not.toBeNull();
    expect(opinionReason(`모델 순위 1위이며 ${text}`)).not.toBeNull();
    expect(newsReason(`${topic}를 다룬 기사이며 ${text}`)).not.toBeNull();
  });
  it.each(reviewNormalControls)("retains the explicitly approved opinion control: %s", text => expect(opinionReason(text)).toBeNull());
  it("accepts the matched factual prefix and complete source event independently of the unsafe tails", () => {
    for (const text of [`${topic}를 다룬 기사입니다.`, `${topic}를 발표했다고 보도했습니다.`]) expect(newsReason(text)).toBeNull();
    expect(opinionReason("모델 순위 1위입니다.")).toBeNull();
    expect(opinionReason("20일·120일 모델은 일치 상태입니다.")).toBeNull();
    expect(opinionReason("상대강도 지표는 상위 21%입니다.")).toBeNull();
  });
});

describe("additional gate selection and metadata-only diagnostics", () => {
  it("rejects the entire unsafe sentence, keeps the surviving citation rows and logs no private text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = "모델 순위 1위입니다. 공시를 다룬 기사입니다. 서비스 개편을 다룬 기사입니다. 모델 순위 1위이며 비공개원문보호표식 안전합니다.";
    const selected = selectStockOpinion({ code, text, citations }, data, 0);
    expect(selected?.text).toBe(text.split(". ").slice(0, 3).join(". ") + ".");
    const news = selectHeadlineSummary({ code, text: "공시를 다룬 기사입니다. 서비스 개편을 다룬 기사입니다. 공시를 다룬 기사이며 비공개원문보호표식 안전합니다.", citations: [id], sentenceCitations: [[id], [id], [id]] }, data, 0);
    expect(news?.sentenceCitations).toEqual([[id], [id]]); expect(news?.summaryBasis).toBe("title");
    const records = warn.mock.calls.filter(([message]) => message === "[briefing] Sentence rejected").map(([, metadata]) => metadata);
    expect(records).toHaveLength(2);
    expect(records.map(row => row.policyVersion)).toEqual([STOCK_SENTENCE_POLICY_VERSION, STOCK_SENTENCE_POLICY_VERSION]);
    expect(records.map(row => row.reason)).toContain("evaluative_residue");
    for (const row of records) expect(Object.keys(row).sort()).toEqual(["policyVersion", "field", "sentence", "reason", "rejected", "total"].sort());
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/비공개원문보호표식|신제품|공시|서비스|발표했습니다/);
  });
  it("falls back when removal violates the existing minimum and keeps deterministic template sentences safe", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(selectStockOpinion({ code, text: "모델 순위 1위입니다. 공시를 다룬 기사입니다. 모델 순위 1위이며 안전합니다.", citations }, data, 0)).toBeNull();
    expect(selectHeadlineSummary({ code, text: "공시를 다룬 기사입니다. 공시를 다룬 기사이며 안전합니다.", citations: [id] }, data, 0)).toBeNull();
    const fallback = templateStockOpinion(data, 0), context = stockSentenceContext(data, 0, "opinion", fallback.citations);
    for (const sentence of fallback.text.split(/(?<=[.!?。])\s+/)) expect(checkStockSentence(sentence, context).accepted).toBe(true);
    expect(STOCK_SENTENCE_FORMS.fixedExplanations).toContain("순위 점수는 수익률이나 확률을 의미하지 않습니다");
  });
});
