import { beforeEach, describe, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => new Map());
vi.mock("node:fs/promises", () => { const api = { readFile: vi.fn(async path => { if (!disk.has(path)) throw Error("missing"); return disk.get(path); }), mkdir: vi.fn(), writeFile: vi.fn(async (path, value) => disk.set(path, value)), rename: vi.fn(async (from, to) => { disk.set(to, disk.get(from)); disk.delete(from); }) }; return { ...api, default: api }; });
import { stockOpinionMetrics } from "../../server/stockOpinionMetrics";
import { stockOpinionSentenceReason, validateStockOpinion, selectStockOpinion, stockOpinionCitationIds } from "../../server/stockOpinion";
import { groundedNumbers } from "../../server/briefingValidation";
import { createNarrativeStore } from "../../server/briefingNarrative";
import { createStockInsightService } from "../../server/stockInsight";
import { adaptStockAiOpinion } from "../entities/stockOpinion";
import { citationIds, templateNarrative } from "../../server/briefingNarrative";
import { macroComment } from "../../server/macroCommentRules";
const raw = { pred_rank: 1, pred_pool_size: 200, rank_score: 1.7, rank_lb20: 2, rank_lb120: 3, model_agreement: "일치", final_rank: 1,
  feat_pct_f_rsi: 90, feat_pct_f_pct_b: 80, feat_pct_f_high: 70, ensemble_pred_return: 98765.123, final_pred_return: 98765.456, score_lb20: 1.2 };
function input() { return { model: null, macro: { indicators: [{ id: "NASDAQ", name: "나스닥", status: "ok", value: 100, change: 1, changePct: 1, unit: "pt" }], preOpen: [{ id: "NASDAQ", name: "나스닥", status: "ok", value: 100, change: 1, changePct: 1, unit: "pt", fiveDayChange: 5, fiveDayChangePct: 5, history: [], comment: { text: "나스닥 관측입니다." } }] }, stocks: [{ code: "005930", name: "삼성전자", rank: 1, rankScore: 1.7, poolSize: 200, topPercent: .5, analysisMetrics: stockOpinionMetrics(raw, { rawModelRank: 5 }),
  modelEvidence: { dangerous: 98765.789 }, evidence: [{ id: "E:005930:1", kind: "model", text: "전체 200개 중 1위입니다." }], cautions: [{ id: "C:005930:1", kind: "data", text: "일부 자료는 미확인입니다." }], news: { status: "collected", articles: [{ id: "N:005930:1", title: "공시 주제", url: "https://paper.example/article", source: "가일보", pubDate: null }] } }] }; }
function opinion() { return { code: "005930", text: "모집단 200개 중 모델 순위 1위이며 순위 점수는 1.7입니다. 20일 모델 순위 2위이고 120일 모델 순위 3위로 두 모델은 일치합니다. 상대강도 지표 백분위 90%이며 비교 종목 안의 상대적 위치입니다. 나스닥은 1% 상승 마감했습니다. 공시를 다룬 기사입니다. 일부 입력 자료는 미확인입니다.", citations: [...stockOpinionCitationIds(input(), 0)] }; }
beforeEach(() => disk.clear());
describe("expanded stock opinion context", () => {
  it("includes SOX in market input and citation IDs but removes fixed forecasts from opinion facts", async () => {
    const data = input(), base = { id: "SOX", name: "필라델피아 반도체 지수", unit: "pt", status: "ok", value: 105, change: 5, changePct: 5, fiveDayChange: 5, fiveDayChangePct: 5,
      history: ["20", "21", "22", "23", "26"].map((day, i) => ({ date: `2026-10-${day}`, value: i === 4 ? 105 : 100 })) };
    data.macro.preOpen = [{ ...base, comment: macroComment(base) }];
    data.model = { modelId: "fixture", baseDate: "2026-10-27", poolSize: 200, scoreKind: "rank_zscore", predictionTarget: "next_session_open_to_close", runStartedAt: null };
    const content = { overview: "입력 자료입니다. 순위를 유지합니다.", marketNote: "입력 자료입니다.", stocks: [{ code: "005930", summary: "모델 순위 1위입니다.", citations: ["R:005930"] }], citations: ["R:005930"] };
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }] }) }));
    await createNarrativeStore({ transport }).resolve(data, true, { PIPELINE_OUTPUT_DIR: "fixture-sox-opinion", GEMINI_API_KEY: "fixture" });
    const sent = JSON.parse(JSON.parse(transport.mock.calls[0][1].body).contents[0].parts[0].text).inputData;
    expect(sent.outlookCitationIds).toContain("M:SOX"); expect(sent.citationIds).toContain("M:SOX");
    expect(sent.stockOpinionMarketFacts[0]).toMatchObject({ id: "SOX", analysisBand: "상승", analysisMetric: 5 });
    expect(sent.stockOpinionMarketFacts[0]).not.toHaveProperty("comment");
    expect(JSON.stringify(sent.stockOpinionMarketFacts)).not.toContain(data.macro.preOpen[0].comment.text);
    expect(sent.macro.preOpen[0].comment.text).toBe(data.macro.preOpen[0].comment.text);
  });
  it("whitelists only ranking/input observations and excludes return-like predictions", () => {
    const metrics = stockOpinionMetrics(raw, { rawModelRank: 5 });
    expect(metrics).toMatchObject({ rawRank: 5, adjustedRank: 1, lookbacks: [{ sessions: 20, rank: 2, topPercent: 1 }, { sessions: 120, rank: 3, topPercent: 1.5 }] });
    expect(metrics.features).toHaveLength(3); expect(JSON.stringify(metrics)).not.toMatch(/pred_return|98765|score_lb/);
  });
  it("adopts six grounded sentences with metric citations and retains three after sentence filtering", () => {
    expect(validateStockOpinion(opinion(), input(), 0)).toBeNull();
    const candidate = { ...opinion(), text: "모델 순위 1위입니다. 공시를 다룬 기사입니다. 입력 근거 1건을 확인했습니다. 주가는 상승할 것입니다." };
    expect(selectStockOpinion(candidate, input(), 0)).toMatchObject({ source: "llm", text: "모델 순위 1위입니다. 공시를 다룬 기사입니다. 입력 근거 1건을 확인했습니다." });
    expect(selectStockOpinion({ ...candidate, text: "모델 순위 1위입니다. 공시 주제입니다. 매수하세요." }, input(), 0)).toBeNull();
  });
  it.each([
    "20일 모델 순위 3위입니다.", "120일 모델 순위 2위입니다.", "원본 모델 순위 1위입니다.", "최종 보정 순위 5위입니다.",
    "20일 모델은 상위 1.5%입니다.", "상대강도 지표 백분위 80%입니다.", "상대강도 지표 하위 10.5%입니다.", "두 모델은 불일치합니다.",
    "RSI 백분위 80%입니다.", "상대강도는 상위 20.5%입니다.", "주가가 높아질 수 있습니다.",
    "시장 배경은 우호적입니다.",
    "나스닥 상승 때문에 모델 순위 1위입니다.", "삼성전자는 상승 우위입니다.", "기관 현물 수급이 유입됐습니다.", "최종 보정 예측은 98765.456%입니다.",
  ])("rejects wrong attribution or banned conclusion: %s", text => expect(stockOpinionSentenceReason(text, input(), 0)).not.toBeNull());
  it.each(["20일 모델 순위 2위입니다.", "120일 모델은 상위 1.5%입니다.", "원본 모델 순위 5위입니다.", "최종 보정 순위 1위입니다.", "상대강도 지표 백분위 90%입니다.", "상대강도 지표 상위 10.5%입니다."])("accepts the metric's own grounded observation: %s", text => expect(stockOpinionSentenceReason(text, input(), 0)).toBeNull());
  it("adds new quantities only to stock-opinion validation and requires the new metric citation", () => {
    const data = input(); expect(groundedNumbers("20일 모델 순위 2위입니다.", data)).toBe(false);
    expect(groundedNumbers("20일 모델 순위 2위입니다.", data, { stockOpinion: true })).toBe(true);
    expect(validateStockOpinion({ ...opinion(), citations: opinion().citations.filter(id => id !== "R:005930:20") }, data, 0)).toBe("invalid_citation");
    expect(adaptStockAiOpinion({ ...opinion(), source: "llm" }, "005930")?.citations).toContain("R:005930:20");
    expect(adaptStockAiOpinion({ ...opinion(), source: "llm", citations: ["R:000660:20"] }, "005930")).toBeUndefined();
  });
  it("does not transfer a market number to another named indicator", () => {
    const data = input(); data.macro.preOpen.push({ id: "UST10Y", name: "금리", status: "ok", unit: "%", value: 4.5, change: .13, changePct: 1, fiveDayChange: .2, fiveDayChangePct: 1, history: [] });
    expect(stockOpinionSentenceReason("나스닥은 0.13%p 하락했습니다.", data, 0)).toBe("ungrounded_number");
    expect(stockOpinionSentenceReason("금리는 0.13%p 상승했습니다.", data, 0)).toBeNull();
  });
  it("sends expanded context in the existing single call without exposing raw predictions", async () => {
    const data = input(), content = { overview: "시장 관측입니다.", marketNote: "자료입니다.", stocks: [{ code: "005930", summary: "모델 순위 1위입니다.", citations: ["R:005930"] }], citations: ["R:005930"], stockOpinions: [opinion()] };
    data.model = { modelId: "fixture", baseDate: "2026-10-27", poolSize: 200, scoreKind: "rank_zscore", predictionTarget: "next_session_open_to_close", runStartedAt: null };
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(content) }] } }] }) }));
    await createNarrativeStore({ transport }).resolve(data, true, { PIPELINE_OUTPUT_DIR: "fixture", GEMINI_API_KEY: "fixture" });
    expect(transport).toHaveBeenCalledOnce(); const body = JSON.parse(transport.mock.calls[0][1].body), prompt = JSON.parse(body.contents[0].parts[0].text).inputData;
    expect(prompt.stocks[0].analysisMetrics.lookbacks).toHaveLength(2); expect(prompt.stockOpinionMarketFacts).toHaveLength(1);
    expect(JSON.stringify(prompt)).not.toMatch(/98765|ensemble_pred_return|final_pred_return|modelEvidence/);
    expect(body.systemInstruction.parts[0].text).toContain("4~6문장");
    expect(body.systemInstruction.parts[0].text).toContain("허용 문형 예시");
    expect(body.systemInstruction.parts[0].text).toContain("해당 기사는 {approvedTopic}를 다룬 기사입니다.");
    expect(body.systemInstruction.parts[0].text).toContain("본문(없으면 발췌, 없으면 제목)");
  });
  it("retains SP500 as data only and excludes it from every model/citation/template path", async () => {
    const data = input(); data.macro.indicators.push({ id: "SP500", name: "S&P 500", status: "ok", value: 9999, change: 99, changePct: 9, unit: "pt" });
    data.model = { modelId: "fixture", baseDate: "2026-10-27", poolSize: 200, scoreKind: "rank_zscore", predictionTarget: "next_session_open_to_close", runStartedAt: null };
    const response = { overview: "모델 순위 자료입니다.", marketNote: "관측 자료입니다.", stocks: [{ code: "005930", summary: "모델 순위 1위입니다.", citations: ["R:005930"] }], citations: ["R:005930"] };
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] }) }));
    await createNarrativeStore({ transport }).resolve(data, true, { PIPELINE_OUTPUT_DIR: "fixture-sp500", GEMINI_API_KEY: "fixture" });
    const request = JSON.parse(transport.mock.calls[0][1].body), prompt = JSON.parse(request.contents[0].parts[0].text).inputData;
    expect(prompt.macro.indicators.map(row => row.id)).not.toContain("SP500");
    expect(prompt.citationIds).not.toContain("M:SP500"); expect([...citationIds(data)]).not.toContain("M:SP500");
    expect(stockOpinionCitationIds(data, 0).has("M:SP500")).toBe(false);
    expect(JSON.stringify(templateNarrative(data, null))).not.toMatch(/S&P|SP500|9999/);
    expect(groundedNumbers("S&P 500은 9,999pt입니다.", data)).toBe(false);
    expect(data.macro.indicators.at(-1).id).toBe("SP500");
  });
  it("does not expose private article contexts or body keys through stock insight", async () => {
    const data = input(), text = "PRIVATE_BODY_SENTINEL".repeat(20);
    data.stocks[0].news.articles[0].bodyText = text;
    const service = createStockInsightService({ rank: async () => [], briefing: async () => ({ ...data, articleBodies: { "N:005930:1": { text } }, narrative: { stockOpinions: [], newsSummaries: [] } }), observations: { get: async () => ({ sensitivities: [{ status: "preparing", complete: false }] }) } });
    const result = await service("005930", { PIPELINE_OUTPUT_DIR: "fixture" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_BODY_SENTINEL"); expect(result.news.articles[0]).not.toHaveProperty("bodyText");
  });
});
