import { beforeEach, describe, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => new Map());
const writes = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => { const api = {
  readFile: vi.fn(async path => { if (!disk.has(path)) throw Error("missing fixture"); return disk.get(path); }), mkdir: vi.fn(),
  stat: vi.fn(async path => { const value = disk.get(path); if (!value) throw Error("missing"); return { isFile: () => true, size: Buffer.byteLength(value), mtimeMs: value.length, ino: 1 }; }),
  writeFile: vi.fn(async (path, value) => { writes(); disk.set(path, value); }), rename: vi.fn(async (from, to) => { disk.set(to, disk.get(from)); disk.delete(from); }),
}; return { ...api, default: api }; });
import { join } from "node:path";
import { currentHeadlineSummary, recoverHeadlineSummaries } from "../../server/headlineSummaryCache";
import { createNarrativeStore, templateNarrative, briefingInputHash } from "../../server/briefingNarrative";
import { pipelineOutputDir } from "../../server/pipelineFreshness";
import { createStockInsightService } from "../../server/stockInsight";
import { clearCachedJsonFiles } from "../../server/cachedJsonFile";
import { articleBodyHashes } from "../../server/articlePrivacy";

const env = { PIPELINE_OUTPUT_DIR: "node_modules/.tmp/headline-summary-tests", BRIEFING_NEWS_VALIDATION: "on", GEMINI_API_KEY: "fixture" };
const path = join(pipelineOutputDir(env), "briefing-narrative.json");
function input() { return { newsValidation: "on", model: { modelId: "fixture", scoreKind: "rank_zscore", baseDate: "2026-10-26", poolSize: 200, predictionTarget: "next_session_open_to_close", runStartedAt: null },
  macro: { asOf: null, indicators: [] }, stocks: [{ code: "030200", name: "KT", rank: 1, rankScore: 1.6, poolSize: 200, topPercent: 0.5, evidence: [{ id: "E:030200:1", kind: "model", text: "모델 순위 1위입니다." }], cautions: [],
    news: { status: "collected", articles: [{ id: "N:030200:1", title: "KT 플랫폼 서비스 출시 공시", url: "https://example.com/news?a=1&b=2", source: "발행처", pubDate: "2026-10-26T01:00:00Z" }] } }] }; }
function headline() { return { code: "030200", source: "llm", summaryBasis: "title", text: "플랫폼 서비스 출시를 다룬 기사입니다. 공시를 다룬 기사입니다.", citations: ["N:030200:1"], sentenceCitations: [["N:030200:1"], ["N:030200:1"]] }; }
function cache() { return { version: 0, inputHash: "old-policy", input: input(), narrative: { ...templateNarrative(input(), null), newsSummaries: [headline()] } }; }
beforeEach(() => { disk.clear(); writes.mockClear(); clearCachedJsonFiles(); });

describe("current validation of cached headline summaries", () => {
  it("invalidates body-based news when a cited article body changes or disappears", () => {
    const data = input(), previous = cache(), id = "N:030200:1";
    previous.input.articleBodies = { [id]: { text: "공개된 서비스 안내입니다.".repeat(20) } };
    previous.input.articleBodyHashes = articleBodyHashes(previous.input);
    previous.narrative.newsSummaries[0] = { ...headline(), summaryBasis: "body", sentenceCitations: [[id], [id]] };
    data.articleBodies = { [id]: { text: "정정된 서비스 안내입니다.".repeat(20) } };
    expect(recoverHeadlineSummaries(previous, data)).toEqual([]);
    delete data.articleBodies; expect(recoverHeadlineSummaries(previous, data)).toEqual([]);
  });
  it("recovers only news despite an incompatible envelope version and input hash", () => {
    const old = cache(); expect(recoverHeadlineSummaries(old, input())).toEqual([headline()]);
    expect(old.inputHash).not.toBe(briefingInputHash(input()));
    expect(currentHeadlineSummary(headline(), input(), 0)).toEqual(headline());
  });
  it.each(["id", "title", "url", "source", "pubDate"])("rejects reused article IDs after %s changes", field => {
    const data = input(); data.stocks[0].news.articles[0][field] += "changed";
    expect(recoverHeadlineSummaries(cache(), data)).toEqual([]);
  });
  it("normalizes harmless title whitespace and URL query order only", () => {
    const data = input(); data.stocks[0].news.articles[0].title = " KT  플랫폼 서비스 출시 공시 ";
    data.stocks[0].news.articles[0].url = "https://example.com/news?b=2&a=1#reader";
    expect(recoverHeadlineSummaries(cache(), data)).toEqual([headline()]);
  });
  it("does not trust old source flags or revive rejected text without current validation", () => {
    const old = cache(); old.narrative.newsSummaries[0].text = "매수하세요. 주가 상승이 예상됩니다.";
    expect(recoverHeadlineSummaries(old, input())).toEqual([]);
    old.narrative.newsSummaries[0] = { ...headline(), source: "template" };
    expect(recoverHeadlineSummaries(old, input())).toEqual([]);
    delete old.narrative.newsSummaries;
    expect(recoverHeadlineSummaries(old, input())).toEqual([]);
  });
  it("GET restores the same fields for briefing and stock without writing or calling Gemini", async () => {
    const stored = cache(); stored.narrative.generatedAt = "2026-10-20T01:00:00Z"; stored.narrative.llmModel = "saved-model";
    disk.set(path, JSON.stringify(stored));
    const transport = vi.fn(), store = createNarrativeStore({ transport });
    const data = input(), narrative = await store.resolve(data, false, env);
    expect(narrative.newsSummaries).toEqual([headline()]);
    expect(narrative).toMatchObject({ status: "llm", fallbackReason: "partial_template" });
    expect(narrative).toMatchObject({ generatedAt: "2026-10-20T01:00:00Z", llmModel: "saved-model" });
    expect(writes).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
    const stock = createStockInsightService({ rank: async () => [], briefing: async () => ({ ...data, narrative }), observations: { get: async () => ({ sensitivities: [{ status: "preparing" }] }) } });
    expect((await stock("030200", env)).news).toMatchObject({ summary: headline().text, summarySource: "llm", citations: headline().citations });
    // A separate paid generation is still needed: recovered news is not a valid whole-narrative cache.
    transport.mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ overview: "시장 관측 자료입니다. 모델 순서를 유지합니다.", marketNote: "시장 관측 자료입니다.", stocks: [{ code: "030200", summary: "모델 순위 1위입니다.", citations: ["R:030200"] }], citations: ["R:030200"], newsSummaries: [headline()] }) }] } }] }) });
    await store.resolve(data, true, env);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("stock can recover a matching file when an earlier in-memory briefing has template news", async () => {
    disk.set(path, JSON.stringify(cache())); const data = input();
    const stock = createStockInsightService({ rank: async () => [], briefing: async () => ({ ...data, narrative: templateNarrative(data, null) }), observations: { get: async () => ({ sensitivities: [{ status: "preparing" }] }) } });
    expect((await stock("030200", env)).news.summarySource).toBe("llm");
    data.stocks[0].news.articles[0].title = "別の記事";
    expect((await stock("030200", env)).news.summarySource).toBe("template");
    expect(writes).not.toHaveBeenCalled();
  });
});
