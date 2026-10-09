import { describe, expect, it } from "vitest";
import { adaptCandidate } from "./candidate";
import { candidateSignals, evidenceAgreement, modelSignal, newsSignal, SIGNAL_RULE_VERSION, supplySignal } from "./signals";
import { pipelineRow } from "../test/dataFixtures";

const candidate = () => adaptCandidate(pipelineRow()).data;
describe("versioned pure signal rules", () => {
  it("checks final membership after validating raw prediction", () => {
    const c = candidate();
    expect(modelSignal({ ...c, isFinalCandidate: true, predictedReturn: -0.1 }).state).toBe("positive");
    expect(modelSignal({ ...c, isFinalCandidate: true, predictedReturn: null }).state).toBe("unavailable");
  });
  it("uses the exact 5% boundary and separates nonpositive predictions", () => {
    const c = candidate();
    expect(modelSignal({ ...c, rank: 10, poolSize: 200 }).state).toBe("positive");
    expect(modelSignal({ ...c, rank: 11, poolSize: 200 }).state).toBe("neutral");
    for (const predictedReturn of [0, -0.001]) expect(modelSignal({ ...c, rank: null, predictedReturn }).state).toBe("negative");
    for (const rank of [0, 201, 1.5, null]) expect(modelSignal({ ...c, rank }).state).toBe("unavailable");
    expect(modelSignal({ ...c, predictionTarget: null }).state).toBe("unavailable");
  });
  it("uses complete LLM article labels; ignores headlines and combined model sentiment", () => {
    const row = pipelineRow({}, { newsCollected: true, newsMethod: "llm" });
    row.news = [{ title: "하락 악재", sentiment: "POSITIVE" }, { title: "상승 호재", sentiment: "NEGATIVE" }];
    expect(newsSignal(adaptCandidate(row).data).state).toBe("neutral");
    row.news.push({ title: "한 기사", sentiment: "POSITIVE" });
    expect(newsSignal(adaptCandidate(row).data).state).toBe("positive");
    row.news.push({ title: "분석 안 됨" });
    expect(newsSignal(adaptCandidate(row).data).state).toBe("unavailable");
    expect(newsSignal({ ...candidate(), newsCollected: true, newsMethod: "keyword" }).state).toBe("unavailable");
  });
  it("rejects inconsistent news counts", () => {
    const row = pipelineRow({}, { newsMethod: "llm", newsTally: { positive: 2, neutral: 0, negative: 0 } });
    row.news = [{ sentiment: "POSITIVE" }];
    expect(newsSignal(adaptCandidate(row).data).state).toBe("unavailable");
  });
  it.each([null, "", "unknown", "pending", "disabled", "api_key_missing", "api_budget_reached", "news_fetch_failed", "completed", "other_future_status"])("fails closed for news status %s even with supplied tally", newsStatus => {
    expect(newsSignal({ ...candidate(), newsStatus, newsCollected: true, newsMethod: "llm", newsTally: { positive: 1, neutral: 0, negative: 0 } }).state).toBe("unavailable");
  });
  const validSupply = { foreignNetBuy: 100, institutionNetBuy: 20, combinedNetBuy: 120,
    foreignPositiveDays: 3, institutionPositiveDays: 2, combinedPositiveDays: 3, window: 5, dataDays: 5, enough: true, status: "ok" };
  it("requires the combined-day input and every sufficiency input", () => {
    const c = { ...candidate(), supply: validSupply };
    expect(supplySignal(c).state).toBe("positive");
    expect(supplySignal({ ...c, supply: { ...validSupply, foreignNetBuy: -100, institutionNetBuy: -20, combinedPositiveDays: 2 } }).state).toBe("negative");
    expect(supplySignal({ ...c, supply: { ...validSupply, combinedPositiveDays: 2 } }).state).toBe("neutral");
    for (const field of ["foreignNetBuy", "institutionNetBuy", "foreignPositiveDays", "institutionPositiveDays", "combinedPositiveDays", "window", "dataDays"] as const) {
      expect(supplySignal({ ...c, supply: { ...validSupply, [field]: null } }).state).toBe("unavailable");
    }
    for (const supply of [{ ...validSupply, enough: false }, { ...validSupply, status: "failed" }, { ...validSupply, dataDays: 4 }, { ...validSupply, combinedPositiveDays: 6 }]) {
      expect(supplySignal({ ...c, supply }).state).toBe("unavailable");
    }
  });
  it("excludes unavailable signals from agreement and returns null for no denominator", () => {
    const signals = candidateSignals(candidate());
    expect(signals.agreement).toMatchObject({ positive: 1, evaluable: 1, unavailable: 2, ratio: 1, ruleVersion: SIGNAL_RULE_VERSION });
    expect(evidenceAgreement([signals.news, signals.supply]).ratio).toBeNull();
    expect(evidenceAgreement([]).ratio).toBeNull();
  });
});
