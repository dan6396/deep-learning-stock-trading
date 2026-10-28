import { describe, expect, it, vi } from "vitest";
import { createStockInsightService } from "../../server/stockInsight";
import { validateModelRows } from "../../server/pipelineResults";
import { pipelineRow } from "./dataFixtures";
import { adaptStockInsight } from "../entities/stockInsight";
const sensitivity = { status: "preparing", metrics: [], conditional: null, samples: 0, complete: false, periodStart: null, periodEnd: null, source: "test", note: "과거 관측입니다." };
describe("read-only stock insight", () => {
  it("keeps old model outputs readable and never uses a stock summary as a news summary", async () => {
    const row = pipelineRow(); Object.assign(row.input_row, { ticker: "005930", score_kind: "rank_zscore", rank_score: 1.6, pred_rank: 1, pred_pool_size: 200, prediction_status: "ok" });
    const rank = vi.fn(async () => [row]), briefing = vi.fn(async () => ({ stocks: [{ code: "005930", news: { articles: [{ id: "N:005930:1", title: "공시", url: "https://example.com/news", source: "발행처", pubDate: null }] } }], narrative: { status: "llm", stocks: [{ code: "005930", source: "llm", summary: "공시 제목을 확인했습니다.", citations: ["N:005930:1", "R:005930"] }] }, model: { runStartedAt: "2026-10-22T01:00:00Z" } }));
    const observations = { get: vi.fn(async () => ({ sensitivities: [sensitivity] })) };
    const service = createStockInsightService({ rank, briefing, observations });
    const result = await service("005930", {}); expect(result.model.lookbacks).toEqual([]); expect(result.model.features).toEqual([]);
    expect(result.news).toMatchObject({ source: "template", summarySource: "template", bodyCollected: false, summary: "관련 기사 1건의 제목·출처·발행 시각을 확인할 수 있습니다.", citations: ["N:005930:1"] });
    expect(result.sensitivity.status).toBe("preparing"); expect(result.cautions.join(" ")).toContain("하루 등락만으로");
    await expect(service("000000", {})).rejects.toThrow("6자리"); expect(rank).toHaveBeenCalledTimes(1);
  });
  const article = { id: "N:005930:1", title: "삼성전자 공시", url: "https://example.com/news", source: "발행처", pubDate: null };
  function context() { return { model: null, macro: { asOf: null, indicators: [] },
    stocks: [{ code: "005930", name: "삼성전자", rank: 1, rankScore: 1.6, poolSize: 200, topPercent: 0.5, evidence: [], cautions: [], news: { status: "collected", articles: [article] } }],
    narrative: { status: "template", stocks: [{ code: "005930", source: "llm", summary: "사용하면 안 되는 종목 요약입니다.", citations: ["N:005930:1"] }],
      newsSummaries: [{ code: "005930", text: "공시 주제를 다룬 기사입니다. 공시를 발표했다고 보도했습니다.", source: "llm", citations: ["N:005930:1"] }] } }; }
  function service(value) { return createStockInsightService({ rank: async () => [], briefing: async () => value, observations: { get: async () => ({ sensitivities: [sensitivity] }) } }); }
  it("uses currently valid newsSummaries independent of legacy root status", async () => {
    const data = context(), result = await service(data)("005930", {});
    expect(result.news).toMatchObject({ summary: data.narrative.newsSummaries[0].text, source: "llm", summarySource: "llm", citations: [article.id] });
    expect(adaptStockInsight(result, "005930").news.summarySource).toBe("llm");
  });
  it.each(["absent", "template", "invalid", "wrongCitation", "wrongStock", "missingArticles"])("uses a template for %s news summaries", async reason => {
    const data = context(), headline = data.narrative.newsSummaries[0];
    if (reason === "absent") delete data.narrative.newsSummaries;
    if (reason === "template") headline.source = "template";
    if (reason === "invalid") headline.text = "매수하세요. 보유하세요.";
    if (reason === "wrongCitation") headline.citations = ["N:005930:9"];
    if (reason === "wrongStock") headline.code = "000660";
    if (reason === "missingArticles") data.stocks[0].news.articles = [];
    const result = await service(data)("005930", {});
    expect(result.news.summarySource).toBe("template"); expect(result.news.source).toBe("template");
    expect(result.news.summary).not.toContain("사용하면 안 되는 종목 요약");
  });
  it("uses the same safe sentence selection as briefing and preserves older adapter payloads", async () => {
    const data = context(); data.narrative.newsSummaries[0].text += " 주가 상승이 예상됩니다.";
    const result = await service(data)("005930", {});
    expect(result.news.summarySource).toBe("llm"); expect(result.news.summary).not.toContain("예상");
    const legacy = structuredClone(result); delete legacy.news.summarySource;
    expect(adaptStockInsight(legacy, "005930").news.summarySource).toBeUndefined();
    expect(adaptStockInsight(legacy, "005930").news.source).toBe("llm");
    expect(adaptStockInsight({ ...legacy, news: { ...legacy.news, summarySource: "unknown" } }, "005930").news.summarySource).toBeUndefined();
  });
  it("rejects malformed optional model observations while allowing historical files without them", () => {
    const row = { ticker: "005930", score_kind: "rank_zscore", model_id: "plain_20_120_rank_mean_v1", rank_score: "1.6", ensemble_pred_return: "", prediction_target: "next_session_open_to_close", prediction_status: "ok", pred_rank: "1", pred_pool_size: "200", prediction_base_date: "2026-10-22" };
    expect(validateModelRows([row]).poolSize).toBe(200);
    const extra = { rank_lb20: "1", rank_lb120: "22", score_lb20: "1.5", score_lb120: "1.7", model_agreement: "부분 일치", feat_pct_f_close: "99" };
    expect(validateModelRows([{ ...row, ...extra }]).ok).toHaveLength(1);
    for (const bad of [{ rank_lb20: "201" }, { model_agreement: "일치" }, { feat_pct_f_close: "100.01" }, { score_lb120: "NaN" }]) expect(() => validateModelRows([{ ...row, ...extra, ...bad }])).toThrow();
  });
});
