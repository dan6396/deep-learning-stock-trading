import { describe, expect, it } from "vitest";
import { adaptCandidate } from "./candidate";
import { finiteNumber, stockCode } from "./value";
import { pipelineRow } from "../test/dataFixtures";
import { modelSignal, newsSignal, supplySignal } from "./signals";

describe("nullable original candidate", () => {
  it.each([undefined, null, "", " ", NaN, Infinity, -Infinity, "NaN", true, [], "0x10"])("does not turn %s into zero", value => {
    expect(finiteNumber(value)).toBeNull();
    const candidate = adaptCandidate(pipelineRow({ ensemble_pred_return: value, foreign_net_buy_sum: value })).data;
    expect(candidate.predictedReturn).toBeNull();
    expect(candidate.supply.foreignNetBuy).toBeNull();
    expect(modelSignal({ ...candidate, isFinalCandidate: true }).state).toBe("unavailable");
  });
  it("preserves measured zero, numeric strings and missing final prediction metadata", () => {
    const candidate = adaptCandidate(pipelineRow({ ensemble_pred_return: "0", final_pred_return: 0.01 }, { rawFinalPrediction: null })).data;
    expect(candidate.predictedReturn).toBe(0);
    expect(candidate.finalPredictedReturn).toBeNull();
    expect(finiteNumber("-1.2e-2")).toBe(-0.012);
    expect(candidate.nextTradingDay).toBeNull();
  });
  it("retains source metadata and rejects mismatched codes", () => {
    const row = pipelineRow({}, { source: "sample" });
    expect(adaptCandidate(row).source).toBe("sample");
    expect(adaptCandidate(row).asOf).toBe("2026-10-07T09:00:00Z");
    row.input_row.ticker = "000660";
    expect(() => adaptCandidate(row)).toThrow("코드");
    expect(stockCode("garbage005930")).toBeNull();
    expect(stockCode("000000")).toBeNull();
  });
  it("distinguishes uncollected CSV empty news, collected zero, failed and skipped", () => {
    expect(newsSignal(adaptCandidate(pipelineRow()).data).state).toBe("unavailable");
    expect(newsSignal(adaptCandidate(pipelineRow({}, { newsCollected: true, newsStatus: "no_usable_article" })).data).state).toBe("neutral");
    for (const newsStatus of ["failed", "skipped", "not_run", "api_key_missing", "api_budget_reached", "pending", "disabled", "unknown"]) {
      expect(newsSignal(adaptCandidate(pipelineRow({}, { newsCollected: true, newsStatus })).data).state).toBe("unavailable");
    }
  });
  it("uses an explicit LLM tally without an article array", () => {
    const row = pipelineRow({}, { newsMethod: "llm", newsTally: "긍정 3건 · 중립 1건 · 부정 2건" });
    expect(newsSignal(adaptCandidate(row).data).state).toBe("positive");
    const legacy = pipelineRow();
    legacy.result.key_data_points = ["긍정 3건 · 중립 1건 · 부정 2건"];
    delete (legacy.data_meta as Record<string, unknown>).newsMethod;
    expect(newsSignal(adaptCandidate(legacy).data).state).toBe("positive");
  });
  it("reads supply_data_enough and never invents combined positive days", () => {
    const candidate = adaptCandidate(pipelineRow({ foreign_net_buy_sum: 100, inst_net_buy_sum: -20,
      foreign_positive_days: 4, inst_positive_days: 3, supply_window: 5, supply_data_days: 5,
      supply_data_enough: true, supply_status: "ok" })).data;
    expect(candidate.supply.enough).toBe(true);
    expect(candidate.supply.combinedNetBuy).toBe(80);
    expect(candidate.supply.combinedPositiveDays).toBeNull();
    expect(supplySignal(candidate)).toMatchObject({ state: "unavailable", reason: expect.stringContaining("합산 순매수 일수") });
  });
  it("keeps an explicit null metadata tally instead of older input/prose counts", () => {
    const row = pipelineRow({ news_sentiment_tally: "긍정 3건 · 중립 0건 · 부정 0건" }, { newsTally: null, newsMethod: "llm", newsStatus: "analyzed" });
    row.result.key_data_points = ["긍정 5건 · 중립 0건 · 부정 0건"];
    const candidate = adaptCandidate(row).data;
    expect(candidate.newsTally).toBeNull();
    expect(newsSignal(candidate).state).toBe("unavailable");
  });
});
