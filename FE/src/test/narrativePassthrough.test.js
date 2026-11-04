import { afterEach, describe, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => new Map());
vi.mock("node:fs/promises", () => { const api = {
  readFile: vi.fn(async path => { if (!disk.has(path)) throw Error("missing"); return disk.get(path); }),
  stat: vi.fn(async path => { if (!disk.has(path)) throw Error("missing"); return { isFile: () => true, size: Buffer.byteLength(disk.get(path)), mtimeMs: 1, ino: 1 }; }),
  mkdir: vi.fn(async () => {}), writeFile: vi.fn(async (path, text) => disk.set(path, text)),
  rename: vi.fn(async (from, to) => { disk.set(to, disk.get(from)); disk.delete(from); }),
}; return { ...api, default: api }; });
import { createNarrativeStore, DEFAULT_BRIEFING_MODEL } from "../../server/briefingNarrative";
import { passthroughNarrative, narrativeValidationEnabled } from "../../server/narrativePassthrough";
import { currentHeadlineSummary, readCachedHeadlineSummaries } from "../../server/headlineSummaryCache";
import { briefingStockPieces, resolveIntegratedOpinion } from "../../server/stockIntegratedSummary";
import { narrativeGenerationDiagnostics } from "../../server/narrativeDiagnostics";

const input = () => ({ newsValidation: "on", model: { modelId: "fixture", baseDate: "2026-10-27", poolSize: 200, scoreKind: "rank_zscore", predictionTarget: "next_session_open_to_close", runStartedAt: null },
  macro: { indicators: [], preOpen: [] }, stocks: [{ code: "030200", name: "KT", rank: 1, rankScore: 1.7, poolSize: 200, topPercent: .5,
    evidence: [{ id: "E:030200:1", kind: "model", text: "모델 순위 1위입니다." }], cautions: [], news: { status: "collected", articles: [] } }] });
// Deliberately violates the legacy wording, number, citation and sentence rules.
const sentence = "매수 추천입니다. 영향으로 99999% 상승할 것으로 예상합니다.";
const raw = () => ({ overview: sentence, marketNote: sentence, citations: ["UNKNOWN"],
  stocks: [{ code: "030200", summary: sentence, citations: ["UNKNOWN"] }],
  stockOpinions: [{ code: "030200", text: sentence, citations: ["UNKNOWN"] }],
  newsSummaries: [{ code: "030200", text: sentence, citations: ["UNKNOWN"] }],
  marketOutlook: { stance: "상승 우위", text: sentence, citations: ["UNKNOWN"] },
  stockSummaries: [{ code: "030200", text: sentence }] });
afterEach(() => { disk.clear(); vi.unstubAllEnvs(); });

describe("system instruction only narrative mode", () => {
  it("defaults to validation off and the requested Lite model", () => {
    vi.stubEnv("BRIEFING_NARRATIVE_VALIDATION", "");
    expect(narrativeValidationEnabled({})).toBe(false);
    expect(DEFAULT_BRIEFING_MODEL).toBe("gemini-3.5-flash-lite");
  });
  it("keeps wording, numbers, citations and article passages for every field", () => {
    const data = { ...input(), articleBodies: { UNKNOWN: { text: sentence } } };
    const result = passthroughNarrative(raw(), data, Date.now(), DEFAULT_BRIEFING_MODEL);
    expect(result).toMatchObject({ status: "llm", fallbackReason: null, validation: "off", overview: sentence, marketNote: sentence });
    expect(result.stocks[0]).toMatchObject({ summary: sentence, citations: ["UNKNOWN"], source: "llm" });
    for (const rows of [result.stockOpinions, result.newsSummaries, result.stockSummaries]) expect(rows[0].text).toBe(sentence);
    expect(result.marketOutlook.text).toBe(sentence);
    const diagnostic = narrativeGenerationDiagnostics(raw(), data, result, Date.now());
    expect(diagnostic.policyVersion).toBe("off");
    expect(diagnostic.fields.every(row => row.fieldReason === null && row.sentences.every(item => item.reason === "validation_disabled"))).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain(sentence);
  });
  it("does not attach a different stock's text by array position and handles missing fields", () => {
    const result = passthroughNarrative({ stocks: [{ code: "999999", summary: sentence }] }, input(), Date.now(), DEFAULT_BRIEFING_MODEL);
    expect(result.stocks[0].source).toBe("template");
    expect(result.stocks[0].summary).not.toBe(sentence);
    expect(() => passthroughNarrative(null, input(), Date.now(), DEFAULT_BRIEFING_MODEL)).not.toThrow();
  });
  it("preserves the result through generation, memory/disk cache and stock page composition", async () => {
    vi.stubEnv("BRIEFING_NARRATIVE_VALIDATION", "");
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(raw()) }] } }] }) }));
    const env = { PIPELINE_OUTPUT_DIR: "node_modules/.tmp/passthrough", GEMINI_API_KEY: "fixture", BRIEFING_NEWS_VALIDATION: "on" };
    const data = input(), store = createNarrativeStore({ transport });
    const result = await store.resolve(data, true, env);
    expect(result.overview).toBe(sentence);
    expect(transport.mock.calls[0][0]).toContain("/gemini-3.5-flash-lite:generateContent");
    const request = JSON.parse(transport.mock.calls[0][1].body);
    expect(request.systemInstruction.parts[0].text).toContain("원문 문장을 길게 그대로 옮기지");
    expect(request).not.toHaveProperty("safetySettings");
    for (const cached of [await store.resolve(data, false, env), await createNarrativeStore({ transport }).resolve(data, false, env)]) {
      expect(cached.stocks[0]).toMatchObject({ summary: sentence, citations: ["UNKNOWN"] });
      expect(cached.stockOpinions[0].citations).toEqual(["UNKNOWN"]);
    }
    expect(transport).toHaveBeenCalledOnce();
    expect(currentHeadlineSummary(result.newsSummaries[0], { ...data, newsValidation: "off" }, 0).text).toBe(sentence);
    expect((await readCachedHeadlineSummaries(data, env))[0].text).toBe(sentence);
    const [pieces] = await briefingStockPieces({ ...data, narrative: result }, env);
    expect(pieces.news.text).toBe(sentence);
    expect(resolveIntegratedOpinion(pieces, sentence)).toMatchObject({ source: "llm", composition: "ai", text: sentence });
    expect(resolveIntegratedOpinion(pieces).text).toContain(sentence);
  });
});
