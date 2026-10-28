import { beforeEach, describe, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => new Map());
vi.mock("node:fs/promises", () => { const api = { readFile: vi.fn(async path => { if (!disk.has(path)) throw Error("missing"); return disk.get(path); }), mkdir: vi.fn(async () => {}), writeFile: vi.fn(async (path, value) => disk.set(path, value)), rename: vi.fn(async (from, to) => { disk.set(to, disk.get(from)); disk.delete(from); }) }; return { ...api, default: api }; });
import { selectHeadlineSummary } from "../../server/briefingExtensions";
import { createNarrativeStore, briefingInputHash } from "../../server/briefingNarrative";
import { createStockInsightService } from "../../server/stockInsight";
import { currentHeadlineSummary } from "../../server/headlineSummaryCache";
import { adaptBriefingNarrative } from "../entities/briefing";
import { adaptStockInsight } from "../entities/stockInsight";
import { removeArticlePassages } from "../../server/articlePrivacy";
import { configuredNewsValidation } from "../../server/newsValidation";
const code = "030200", id = `N:${code}:1`, text = "주가 급등 호재입니다. 매수를 추천합니다. 수익 확률은 99%입니다.";
const input = () => ({ model: { modelId: "fixture", baseDate: "2026-10-27", poolSize: 200, scoreKind: "rank_zscore", predictionTarget: "next_session_open_to_close", runStartedAt: null }, macro: { indicators: [], preOpen: [] }, stocks: [{ code, name: "KT", rank: 1, rankScore: 1.7, poolSize: 200, topPercent: .5, evidence: [{ id: `E:${code}:1`, text: "모델 순위 1위입니다.", kind: "model" }], cautions: [], news: { status: "collected", articles: [{ id, title: "KT 서비스 공개", url: "https://paper.example/a", source: "가일보", pubDate: null }] } }] });
const row = () => ({ code, text, citations: [id, "N:000000:99", "broken", 123, id] });
const value = () => ({ overview: "입력 자료입니다. 모델 순서를 유지합니다.", marketNote: "시장 자료입니다.", stocks: [{ code, summary: "모델 순위 1위입니다.", citations: [`R:${code}`] }], citations: [`R:${code}`], newsSummaries: [row()],
  stockOpinions: [{ code, text, citations: [`R:${code}`] }], marketOutlook: { stance: "상승 우위", text: "주가 급등입니다. 매수를 추천합니다.", citations: [] } });
const env = { PIPELINE_OUTPUT_DIR: "node_modules/.tmp/off-mode", GEMINI_API_KEY: "fixture-only-secret-key" };
beforeEach(() => { disk.clear(); vi.clearAllMocks(); });
describe("explicit news validation off mode", () => {
  it("retains original text by default and enables the old checks only for on", () => {
    expect(configuredNewsValidation({})).toBe("off"); expect(configuredNewsValidation({ BRIEFING_NEWS_VALIDATION: "off" })).toBe("off"); expect(configuredNewsValidation({ BRIEFING_NEWS_VALIDATION: "on" })).toBe("on");
    expect(selectHeadlineSummary(row(), input(), 0)).toEqual({ code, text, citations: [id], source: "llm", validation: "off", summaryBasis: "title" });
    expect(selectHeadlineSummary(row(), { ...input(), newsValidation: "on" }, 0)).toBeNull();
    expect(selectHeadlineSummary({ ...row(), citations: "broken" }, { ...input(), newsValidation: "off" }, 0)?.citations).toEqual([]);
    for (const bad of ["", " ", null, {}, 123, "x".repeat(1801)]) expect(selectHeadlineSummary({ ...row(), text: bad }, { ...input(), newsValidation: "off" }, 0)).toBeNull();
  });
  it("preserves summary text even when it repeats a source while never exposing raw fields", () => {
    for (const [field, passage] of [["articleBodies", "PRIVATE_BODY_SENTINEL ".repeat(8)], ["articleExcerpts", "PRIVATE_EXCERPT_SENTINEL ".repeat(4)]]) {
      const data = { ...input(), [field]: { [id]: { text: passage } } };
      const result = selectHeadlineSummary({ ...row(), text: passage, bodyText: "RAW_FIELD_SENTINEL", excerptText: "RAW_FIELD_SENTINEL" }, data, 0);
      expect(result).toMatchObject({ text: passage, source: "llm", summaryBasis: field === "articleBodies" ? "body" : "excerpt" });
      expect(result).not.toHaveProperty("bodyText"); expect(result).not.toHaveProperty("excerptText");
      expect(removeArticlePassages({ newsSummaries: [row()], overview: passage }, data)).toMatchObject({ newsSummaries: [row()], overview: "" });
    }
  });
  it("changes fingerprints and never recovers a headline generated in another mode", () => {
    const data = { ...input(), newsValidation: "on" }, off = { ...data, newsValidation: "off" }, selected = selectHeadlineSummary(row(), off, 0);
    expect(briefingInputHash(data)).not.toBe(briefingInputHash(off));
    expect(currentHeadlineSummary(selected, data, 0)).toBeNull();
    expect(currentHeadlineSummary({ ...selected, validation: undefined }, off, 0)).toBeNull();
  });
  it("passes off through generated narrative, stock API and adapters; other validators stay active", async () => {
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value()) }] } }] }) }));
    const options = { ...env }, store = createNarrativeStore({ transport });
    const result = await store.resolve(input(), true, options);
    expect(result.newsSummaries[0]).toMatchObject({ text, validation: "off", source: "llm", citations: [id] });
    expect(result.stockOpinions[0].source).toBe("template"); expect(result.marketOutlook.source).toBe("template");
    const service = createStockInsightService({ rank: async () => [], briefing: async () => ({ ...input(), narrative: result }), observations: { get: async () => ({ sensitivities: [{ status: "preparing", complete: false }] }) } });
    const stock = await service(code, options); expect(stock.news).toMatchObject({ summary: text, validation: "off", summarySource: "llm" });
    expect(stock.news.limitation).toBe("기사 제목을 바탕으로 작성한 AI 요약입니다.");
    expect(adaptBriefingNarrative(result).newsSummaries[0].validation).toBe("off"); expect(adaptStockInsight(stock, code).news.validation).toBe("off");
    const on = await store.resolve(input(), false, { ...env, BRIEFING_NEWS_VALIDATION: "on" }); expect(on.newsSummaries[0].source).toBe("template"); expect(transport).toHaveBeenCalledOnce();
    const offAgain = await createNarrativeStore({ transport }).resolve(input(), false, options); expect(offAgain.newsSummaries[0].validation).toBe("off");
    expect(JSON.stringify([...disk.values()])).not.toContain(env.GEMINI_API_KEY);
  });
});
