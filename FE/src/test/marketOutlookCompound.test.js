import replay from "./fixtures/narrative-0154-replay.json";
import { templateNarrative } from "../../server/briefingNarrative";
import { describe, expect, it } from "vitest";
import { futuresSupplyClaimsGrounded, groundedNumbers, supplyClauses } from "../../server/briefingValidation";
import { validateMarketOutlook, selectMarketOutlook, applyNarrativeExtensions } from "../../server/briefingExtensions";

const sentence = "또한 코스피200 선물 외국인 순매수는 2026-10-27 기준 670계약으로 4거래일 연속 순매수이자 5일 합계 4,218계약 순매수를 기록해 우호적인 수급을 나타냈습니다.";
function input() { return { model: null, stocks: [], macro: { asOf: null, indicators: [], preOpen: [{ id: "KOSPI200_FOREIGN_FUTURES", name: "코스피200 선물 외국인 순매수", status: "ok", unit: "계약", value: 670, change: null, changePct: null, fiveDayChange: null, fiveDayChangePct: null,
  fiveDaySum: 4218, consecutiveDays: 4, asOf: "2026-10-27", history: ["21", "22", "23", "26", "27"].map((day, i) => ({ date: `2026-10-${day}`, value: [-100, 1000, 1300, 1348, 670][i] })), comment: { text: "외국인 선물 관측입니다." } }] } }; }
const opinion = text => ({ stance: "상승 우위", text, citations: ["M:KOSPI200_FOREIGN_FUTURES"] });
describe("composed foreign futures observations", () => {
  it("keeps metric subjects through dated latest/streak/aggregate clauses", () => {
    const data = input(), flow = data.macro.preOpen[0];
    expect(supplyClauses(sentence)).toHaveLength(3);
    expect(futuresSupplyClaimsGrounded(sentence, flow)).toBe(true);
    expect(groundedNumbers(sentence, data, { outlook: true })).toBe(true);
    expect(validateMarketOutlook(opinion(sentence + " 장 초반은 상승 우위입니다."), data)).toBeNull();
  });
  it.each([
    "외국인 선물은 670계약 5일 합계 순매수입니다.",
    "외국인 선물은 4,218계약 직전일 순매수입니다.",
    "외국인 선물은 4거래일 합계 670계약 순매수입니다.",
    sentence.replace("670계약", "671계약"), sentence.replace("4거래일", "3거래일"), sentence.replace("4,218계약", "3,452계약"),
    sentence.replace("670계약", "-670계약"), sentence.replace("연속 순매수", "연속 순매도"),
    "외국인 현물은 직전일 670계약 순매수입니다.", "기관은 직전일 670계약 순매수입니다.",
  ])("rejects wrong metric attribution or subjects: %s", text => {
    expect(validateMarketOutlook(opinion(text + " 장 초반은 상승 우위입니다."), input())).not.toBeNull();
  });
  it("removes an unsafe sentence only if two safe sentences including the stance survive", () => {
    const data = input(), safe = "외국인 선물은 직전일 670계약 순매수입니다. 장 초반은 상승 우위입니다.";
    expect(selectMarketOutlook(opinion(safe + " 외국인 현물도 순매수입니다."), data)).toMatchObject({ source: "llm", text: safe });
    expect(selectMarketOutlook(opinion("외국인 현물도 순매수입니다. 장 초반은 상승 우위입니다."), data)).toBeNull();
    expect(selectMarketOutlook(opinion("외국인 선물은 직전일 670계약 순매수입니다. 관측 자료입니다. 매수해야 상승 우위입니다."), data)).toBeNull();
    expect(selectMarketOutlook(opinion("외국인 선물은 직전일 670계약 순매수입니다. 하락 우위입니다."), data)).toBeNull();
    expect(selectMarketOutlook({ ...opinion(safe), citations: ["M:missing"] }, data)).toBeNull();
  });
  it("allows qualitative market direction without inventing numerical probability or stock advice", () => {
    const data = input(), safe = "외국인 선물은 직전일 670계약 순매수로 우호적인 수급을 나타냈습니다. 코스피 장 초반은 상승 우위로 출발할 가능성이 있습니다.";
    expect(validateMarketOutlook(opinion(safe), data)).toBeNull();
    for (const text of [safe + " 상승 확률은 70%입니다.", safe + " 종목을 매수하세요."]) expect(validateMarketOutlook(opinion(text), data)).not.toBeNull();
  });
});

describe("offline replay of the pinned raw market outlook", () => {
  it("adopts the complete currently grounded raw opinion without dropping facts", () => {
    const cache = structuredClone(replay), raw = cache.rawFields.marketOutlook;
    expect(validateMarketOutlook(raw, cache.input)).toBeNull();
    const selected = selectMarketOutlook(raw, cache.input);
    expect(selected).toMatchObject({ source: "llm", stance: raw.stance, text: raw.text });
    const base = templateNarrative(cache.input, null);
    const repaired = applyNarrativeExtensions(base, { ...base, marketOutlook: raw }, cache.input);
    expect(repaired.marketOutlook.source).toBe("llm");
    console.info("[market-outlook offline replay]", JSON.stringify({ source: repaired.marketOutlook.source, stance: repaired.marketOutlook.stance,
      originalTextMatch: repaired.marketOutlook.text === raw.text, sentences: raw.text.split(/(?<=[.!?。])\s+/).length }));
  });
});
