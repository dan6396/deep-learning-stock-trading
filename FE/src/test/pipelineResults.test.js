import { beforeEach, describe, expect, it, vi } from "vitest";
import { adaptCandidate } from "../entities/candidate";
import { candidateSignals, modelSignal, newsSignal } from "../entities/signals";

const fixtureFiles = vi.hoisted(() => new Map());
vi.mock("node:fs/promises", () => {
  const mocks = {
  readFile: vi.fn(async (path) => {
    const file = path.replace(/\\/g, "/").split("/").pop();
    if (!fixtureFiles.has(file)) throw new Error("fixture file absent");
    return fixtureFiles.get(file);
  }),
  access: vi.fn(async (path) => { if (!fixtureFiles.has(path.replace(/\\/g, "/").split("/").pop())) throw new Error("fixture absent"); }),
  stat: vi.fn(async () => ({ mtimeMs: Date.parse("2026-10-07T09:00:00Z") })),
  writeFile: vi.fn(), mkdir: vi.fn(),
  };
  return { ...mocks, default: mocks };
});
vi.mock("../../server/pipelineFreshness", () => ({
  readPipelineRunMarker: vi.fn(async () => ({ status: "completed" })), isFreshForRun: vi.fn(() => true),
}));
vi.mock("../../server/dashboardCache", () => ({ readLastSnapshot: vi.fn(), writeDashboardSnapshot: vi.fn() }));
import { getCandidatesPayload, getRankPayload, getStockAnalysisPayload } from "../../server/pipelineResults";

const headers = "ticker,company_name,prediction_target,ensemble_pred_return,pred_rank,pred_pool_size,supply_data_enough,supply_status";
beforeEach(() => fixtureFiles.clear());
describe("pipeline file provenance through API", () => {
  it.each(["api_key_missing", "api_budget_reached", "news_fetch_failed", "disabled", "pending", "unknown", undefined])("does not count %s as a successful zero-news collection", async status => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status, news: [], final_score: 0.02 } }));
    const [row] = await getCandidatesPayload(), candidate = adaptCandidate(row, true).data;
    expect(row.data_meta.newsCollected).toBe(false);
    expect(candidateSignals(candidate)).toMatchObject({ news: { state: "unavailable" }, agreement: { evaluable: 1, unavailable: 2, ratio: 1 } });
  });
  it.each(["no_usable_article", "analyzed"])("counts actual empty collection %s as neutral", async status => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status, news: [], final_score: 0.02 } }));
    const [row] = await getCandidatesPayload();
    expect(row.data_meta.newsCollected).toBe(true);
    expect(candidateSignals(adaptCandidate(row, true).data)).toMatchObject({ news: { state: "neutral" }, agreement: { evaluable: 2, unavailable: 1, ratio: 0.5 } });
  });
  it("does not treat statusless legacy Gemini [] as a confirmed successful zero", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    fixtureFiles.set("news_gemini_result.json", JSON.stringify({ "005930": { news: [], news_count: 0, evaluation: { sentiment: "Bullish", news_sentiment_tally: "긍정 0건 · 중립 0건 · 부정 0건" } } }));
    const [row] = await getCandidatesPayload();
    expect(row.data_meta.newsCollected).toBe(false);
    expect(row.data_meta.newsStatus).toBe("unknown");
    expect(newsSignal(adaptCandidate(row).data).state).toBe("unavailable");
  });
  it.each(["unclear", ""])("preserves unknown event sentiment %s instead of a neutral LLM vote", async sentiment => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status: "analyzed", news: [{ title: "Fixture", sentiment }] } }));
    const [row] = await getCandidatesPayload();
    expect(row.news[0].sentiment).not.toBe("NEUTRAL");
    const candidate = adaptCandidate(row).data;
    expect(candidate.news[0].sentiment).toBeNull();
    expect(newsSignal(candidate).state).toBe("unavailable");
  });
  it("preserves CSV missing numeric values and uncollected empty news", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,,5,200,false,not_checked\n`);
    const rows = await getCandidatesPayload(), adapted = adaptCandidate(rows[0], true);
    expect(adapted).toMatchObject({ source: "cache", asOf: "2026-10-07T09:00:00.000Z", data: { predictedReturn: null, newsCollected: false } });
    expect(modelSignal(adapted.data).state).toBe("unavailable");
    expect(newsSignal(adapted.data).state).toBe("unavailable");
  });
  it("does not use an older nonempty file after an authoritative empty CSV", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n`);
    fixtureFiles.set("step2_final_top10.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    expect(await getCandidatesPayload()).toEqual([]);
  });
  it("preserves absent event final_score, news_delta and accepted_events in all output representations", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,,5,200,false,not_checked\n`);
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status: "failed", news: [] } }));
    const [row] = await getCandidatesPayload(), candidate = adaptCandidate(row, true).data;
    expect(row.input_row.final_pred_return).toBeNull();
    expect(row.input_row.news_adjustment).toBeNull();
    expect(row.data_meta?.rawFinalPrediction).toBeNull();
    expect(candidate.finalPredictedReturn).toBeNull();
    expect(candidate.predictedReturn).toBeNull();
    expect(row.result.summary).toContain("원본 예측수익률 미확인");
    expect(row.result.summary).not.toContain("예상수익률 0.00%");
    expect(row.result.summary).toContain("사건 수는 미확인");
    expect(row.result.key_data_points).toContain("최종 예상수익률: 미확인");
    expect(row.result.key_data_points).toContain("뉴스 보정: 미확인");
    expect(row.result.key_data_points).toContain("본문 분석 0건 · 직접 관련 사건 미확인");
    expect(newsSignal(candidate).state).toBe("unavailable");
  });
  it("does not substitute ensemble prediction for a missing event final score and preserves measured zero", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status: "analyzed", news: [], news_delta: 0, accepted_events: 0 } }));
    const [row] = await getCandidatesPayload();
    expect(row.input_row.final_pred_return).toBeNull();
    expect(row.input_row.news_adjustment).toBe(0);
    expect(row.result.key_data_points).toContain("뉴스 보정: 0.00%p");
    expect(row.result.key_data_points).toContain("본문 분석 0건 · 직접 관련 사건 0건");
  });
  it("preserves event final rank separately from original model rank and keeps missing final rank null", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,50,200,true,ok\n`);
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status: "analyzed", final_rank: 2, final_score: .03, news: [] } }));
    const [known] = await getCandidatesPayload();
    expect(known.input_row.pred_rank).toBe(2); expect(known.data_meta.rawFinalRank).toBe(2);
    expect(adaptCandidate(known, true).data).toMatchObject({ rank: 50, finalRank: 2 });
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status: "analyzed", final_score: .03, news: [] } }));
    const [missing] = await getCandidatesPayload();
    expect(missing.data_meta.rawFinalRank).toBeNull(); expect(adaptCandidate(missing).data.finalRank).toBeNull();
  });
  it("retains LLM explicit tally without articles and distinguishes genuine zero", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    fixtureFiles.set("news_gemini_result.json", JSON.stringify({ "005930": { evaluation: { sentiment: "Bullish", news_sentiment_tally: "긍정 3건 · 중립 1건 · 부정 0건" } } }));
    const [row] = await getCandidatesPayload();
    expect(newsSignal(adaptCandidate(row).data).state).toBe("positive");
    fixtureFiles.delete("news_gemini_result.json");
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status: "no_usable_article", news: [], final_score: 0.02 } }));
    const [zero] = await getCandidatesPayload();
    expect(newsSignal(adaptCandidate(zero).data).state).toBe("neutral");
  });
  it("does not invent neutral LLM article labels from absent sentiments", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    fixtureFiles.set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { status: "analyzed", news: [{ title: "Fixture article without LLM sentiment" }] } }));
    const [row] = await getCandidatesPayload();
    expect(newsSignal(adaptCandidate(row).data).state).toBe("unavailable");
  });
  it("keeps full ranking separate from final candidates and resolves a requested code", async () => {
    fixtureFiles.set("step3_final_top5.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n`);
    fixtureFiles.set("step2_all_transformer_rank.csv", `${headers}\n005930,Fixture,next_session_open_to_close,0.02,5,200,true,ok\n000660,Another,next_session_open_to_close,0.01,10,200,true,ok\n`);
    expect(await getCandidatesPayload()).toHaveLength(1);
    expect(await getRankPayload()).toHaveLength(2);
    expect((await getStockAnalysisPayload("000660"))?.input_row.ticker).toBe("000660");
  });
});
