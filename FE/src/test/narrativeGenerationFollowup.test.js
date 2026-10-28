import { describe, expect, it, vi } from "vitest";
import { createArticlePassageGuard, removeArticlePassages } from "../../server/articlePrivacy";
import { selectHeadlineSummary, marketOutlookCitationIds, validateMarketOutlook } from "../../server/briefingExtensions";
import { groundedNumbers, rejectedNumericTokens } from "../../server/briefingValidation";
import { narrativeGenerationDiagnostics } from "../../server/narrativeDiagnostics";
import { templateNarrative } from "../../server/briefingNarrative";
const id = "N:030200:1", passage = "원문에서 길게 이어지는 문장을 요약 없이 옮긴 경우 해당 문장만 제거해야 한다는 합성 검증 자료입니다";
const input = () => ({ newsValidation: "on", model: { modelId: "fixture", baseDate: "2026-10-27", poolSize: 199 }, macro: { indicators: [{ id: "KOSPI", name: "코스피", status: "ok", value: 2500, change: 1, changePct: .1, unit: "pt" }], preOpen: [{ id: "NASDAQ", name: "나스닥", status: "ok", value: 18000, change: -100, changePct: -.55, unit: "pt", history: [], comment: { text: "관측 자료입니다." } }, { id: "UST10Y", name: "미국 국채 10년 금리", status: "unavailable", value: null, change: null, changePct: null, unit: "%", history: [] }] },
  stocks: [{ code: "030200", name: "KT", rank: 1, rankScore: 1.7030597340999105, poolSize: 199, topPercent: .5025125628140703, evidence: [{ id: "E:030200:1", kind: "model", text: "모델 순위 1위입니다." }], cautions: [], news: { status: "collected", articles: [{ id, title: "KT 공시 서비스 공개", source: "가일보", url: "https://paper.example/a" }] } }], articleExcerpts: { [id]: { text: passage } } });
describe("13:11 generation follow-up regressions", () => {
  it("removes one copied sentence, keeps the other facts and corresponding citation rows", () => {
    const data = input(), text = `${passage}. 공시를 다룬 기사입니다. 서비스 공개를 다룬 기사입니다.`, row = { code: "030200", text, citations: [id], sentenceCitations: [[id], [id], [id]] };
    const cleaned = removeArticlePassages({ newsSummaries: [row] }, data).newsSummaries[0];
    expect(cleaned.text).toBe("공시를 다룬 기사입니다. 서비스 공개를 다룬 기사입니다."); expect(cleaned.sentenceCitations).toEqual([[id], [id]]);
    expect(selectHeadlineSummary(cleaned, data, 0)?.source).toBe("llm");
    expect(selectHeadlineSummary(row, data, 0)).toMatchObject({ text: cleaned.text, source: "llm", sentenceCitations: [[id], [id]] });
    expect(selectHeadlineSummary(row, { ...data, newsValidation: "off" }, 0)).toMatchObject({ text, source: "llm", validation: "off" });
    const stats = createArticlePassageGuard(data).stats(text); expect(stats).toEqual({ matchCount: 1, matchLengths: [passage.length], matchedCharacters: passage.length, removedSentences: 1 });
    expect(JSON.stringify(stats)).not.toContain("원문");
  });
  it("retains copies below 40 characters and falls back only when masking leaves too few news sentences", () => {
    const data = input(), short = passage.slice(0, 39), text = `${passage}. 공시를 다룬 기사입니다.`;
    expect(removeArticlePassages({ text: short }, data)).toEqual({ text: short });
    expect(removeArticlePassages({ newsSummaries: [{ text }] }, data).newsSummaries[0].text).toBe("");
    expect(selectHeadlineSummary({ code: "030200", text, citations: [id] }, { ...data, newsValidation: "off" }, 0)).toMatchObject({ text, source: "llm" });
  });
  it("uses the exact outlook whitelist, rejecting otherwise valid global macro IDs", () => {
    const data = input(), row = { stance: "상승 우위", text: "나스닥 관측을 바탕으로 코스피 장 초반은 상승 우위로 판단합니다.", citations: ["M:NASDAQ"] };
    expect(marketOutlookCitationIds(data)).toEqual(["M:NASDAQ"]); expect(validateMarketOutlook(row, data)).toBeNull();
    for (const id of ["M:KOSPI", "M:SP500", "M:UST10Y", "M:KOSPI200_NIGHT", "NASDAQ"]) expect(validateMarketOutlook({ ...row, citations: [id] }, data)).toBe("invalid_citation");
    const record = narrativeGenerationDiagnostics({ marketOutlook: { ...row, citations: ["M:KOSPI", "NASDAQ", "PRIVATE_TEXT_SENTINEL"] } }, data, templateNarrative(data, null), Date.now());
    expect(record.fields.find(row => row.field === "marketOutlook").citationDiagnostics).toMatchObject({ allowed: ["M:NASDAQ"], submittedKnownIds: ["M:KOSPI"], invalidKnownIds: ["M:KOSPI"] });
    expect(JSON.stringify(record)).not.toMatch(/PRIVATE_TEXT_SENTINEL|코스피|나스닥/);
  });
  it.each(["순위 점수는 1.7031입니다.", "순위 점수는 1.70입니다.", "상위 0.5%입니다.", "모집단 199개 중 모델 순위 1위입니다."])("registers the already supported numeric formats: %s", text => {
    expect(groundedNumbers(text, input())).toBe(true); expect(rejectedNumericTokens(text, input())).toEqual([]);
  });
  it("records only rejected numeric tokens, not the sentence or grounded rank", () => {
    const data = input(), sentence = "모델 순위 1위이며 PRIVATE_MODEL_SENTINEL 점수 9.99와 백분위 77.7%입니다.";
    expect(rejectedNumericTokens(sentence, data)).toEqual(["9.99", "77.7%"]);
    const raw = { stocks: [{ code: "030200", summary: sentence, citations: ["R:030200"] }] };
    const record = narrativeGenerationDiagnostics(raw, data, templateNarrative(data, null), Date.now());
    expect(record.fields.find(row => row.field === "stocks").sentences[0].rejectedNumericTokens).toEqual(["9.99", "77.7%"]);
    expect(JSON.stringify(record)).not.toMatch(/PRIVATE_MODEL_SENTINEL|백분위|점수/);
  });
});
