import { beforeEach, describe, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => new Map());
vi.mock("node:fs/promises", () => { const api = { readFile: vi.fn(async path => { if (!disk.has(path)) throw Error("missing"); return disk.get(path); }), mkdir: vi.fn(async () => {}), writeFile: vi.fn(async (path, value) => disk.set(path, value)), rename: vi.fn(async (from, to) => { disk.set(to, disk.get(from)); disk.delete(from); }) }; return { ...api, default: api }; });
import { createNarrativeStore, templateNarrative } from "../../server/briefingNarrative";
import { narrativeGenerationDiagnostics } from "../../server/narrativeDiagnostics";
import { rememberArticleExcerpt } from "../../server/articleExcerpts";
import { selectHeadlineSummary, marketOutlookCitationIds } from "../../server/briefingExtensions";
const id = "N:030200:1", dir = "node_modules/.tmp/metadata-only-generation";
const input = () => ({ newsValidation: "on", model: { modelId: "fixture", baseDate: "2026-10-27", poolSize: 200, scoreKind: "rank_zscore", predictionTarget: "next_session_open_to_close", runStartedAt: null }, macro: { indicators: [], preOpen: [] },
  stocks: [{ code: "030200", name: "KT", rank: 1, rankScore: 1.7, poolSize: 200, topPercent: .5, evidence: [{ id: "E:030200:1", kind: "model", text: "모델 순위 1위입니다." }], cautions: [], news: { status: "collected", articles: [{ id, title: "HEADLINE_SENTINEL KT 서비스 공개", url: "https://paper.example/private", source: "가일보", pubDate: null }] } }] });
const raw = () => ({ overview: "MODEL_SENTINEL 입력 자료입니다. 모델 순서를 유지합니다.", marketNote: "시장 자료입니다.", stocks: [{ code: "030200", summary: "모델 순위 1위입니다.", citations: ["R:030200"] }], citations: ["R:030200"],
  stockOpinions: [{ code: "030200", text: "모델 순위 1위로 안전합니다. 설명입니다.", citations: ["R:030200"] }],
  newsSummaries: [{ code: "030200", text: "계약 규모 120억원을 다룬 기사입니다. 서비스 공개를 다룬 기사입니다. 서비스 공개를 다룬 기사이며 긍정적입니다.", citations: [id] }] });
beforeEach(() => { disk.clear(); vi.clearAllMocks(); });
describe("generation diagnostics contain metadata only", () => {
  it("sends the validator's exact outlook IDs and display-rounded model quantities", async () => {
    const data = input(); data.stocks[0].topPercent = 1 / 199 * 100; data.stocks[0].rankScore = 1.7030597340999105;
    data.macro.indicators = [{ id: "KOSPI", name: "코스피", value: 2500, change: 1, changePct: .1, unit: "pt", status: "ok" }, { id: "SP500", name: "S&P 500", value: 5000, change: 1, changePct: .1, unit: "pt", status: "ok" }];
    data.macro.preOpen = [{ id: "NASDAQ", name: "나스닥", unit: "pt", status: "ok", value: 18000, change: -100, changePct: -.55, fiveDayChange: -100, fiveDayChangePct: -.55, history: [], comment: { text: "관측 자료입니다." } }];
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(raw()) }] } }] }) }));
    await createNarrativeStore({ transport }).resolve(data, true, { PIPELINE_OUTPUT_DIR: dir + "-prompt", BRIEFING_NEWS_VALIDATION: "on", GEMINI_API_KEY: "fixture" });
    const request = JSON.parse(transport.mock.calls[0][1].body), sent = JSON.parse(request.contents[0].parts[0].text).inputData;
    expect(sent.outlookCitationIds).toEqual(marketOutlookCitationIds(data)); expect(sent.outlookCitationIds).toEqual(["M:NASDAQ"]);
    expect(sent.citationIds).toContain("M:KOSPI"); expect(sent.outlookCitationIds).not.toContain("M:KOSPI"); expect(sent.citationIds).not.toContain("M:SP500");
    expect(sent.stocks[0]).toMatchObject({ rankScore: 1.7031, rankScoreDisplay: "1.7031", topPercent: .5, topPercentDisplay: "0.5%" });
    expect(request.systemInstruction.parts[0].text).toContain("자기 말로 요약");
    expect(request.systemInstruction.parts[0].text).toContain("원문 문장을 길게 그대로 옮기지");
  });
  it("writes an archive per generation and an atomic latest file without private/model/title text", async () => {
    rememberArticleExcerpt(dir, "https://paper.example/private", "PRIVATE_EXCERPT_SENTINEL 계약 규모는 120억원이며 서비스 공개를 발표했다는 검색 결과입니다.");
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(raw()) }] } }] }) }));
    const store = createNarrativeStore({ transport }), env = { PIPELINE_OUTPUT_DIR: dir, BRIEFING_NEWS_VALIDATION: "on", GEMINI_API_KEY: "SYNTHETIC_SECRET_KEY_SENTINEL" };
    const result = await store.resolve(input(), true, env);
    const latest = [...disk.entries()].find(([path]) => path.endsWith("briefing-narrative-diagnostics.json")); expect(latest).toBeDefined();
    const text = latest[1], record = JSON.parse(text), news = record.fields.find(row => row.field === "newsSummaries");
    expect(record).toMatchObject({ generationStatus: "completed", excerptLookup: { requested: 1, found: 1, missing: 0 } });
    expect(news).toMatchObject({ source: "llm", modelSentenceCount: 3, acceptedSentenceCount: 2, available: { title: 1, excerpt: 1, body: 0 }, summaryBasis: "excerpt", usedSourceCounts: { title: 1, excerpt: 1, body: 0 } });
    expect(news.sentences[2]).toMatchObject({ reason: "evaluative_residue", accepted: false });
    expect(record.fields.find(row => row.field === "stockOpinions")).toMatchObject({ source: "template", fieldReason: "min_sentences" });
    expect(record.fields.map(row => row.field)).toEqual(expect.arrayContaining(["overview", "marketNote", "stocks", "marketOutlook"]));
    expect(news.sentences.every(row => row.length > 0 && /^[a-f0-9]{64}$/.test(row.hash))).toBe(true);
    expect(text).not.toMatch(/PRIVATE_EXCERPT|PRIVATE_BODY|HEADLINE_SENTINEL|MODEL_SENTINEL|SECRET_KEY|paper\.example|120억원|서비스|계약|rawFields|sourceOffsets/);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_EXCERPT_SENTINEL");
    expect([...disk.keys()].filter(path => /briefing-narrative-diagnostics[\\/].+\.json$/.test(path))).toHaveLength(1);
    await store.resolve(input(), false, env); expect(transport).toHaveBeenCalledOnce();
    await store.resolve({ ...input(), stocks: input().stocks.map(row => ({ ...row, rankScore: 1.8 })) }, true, env);
    expect([...disk.keys()].filter(path => /briefing-narrative-diagnostics[\\/].+\.json$/.test(path))).toHaveLength(2);
  });
  it("does not run sentence validation for disabled news and does not claim checked source proof", () => {
    const data = { ...input(), newsValidation: "off", articleBodies: { [id]: { text: "PRIVATE_BODY_SENTINEL" } } }, value = raw(), selected = selectHeadlineSummary(value.newsSummaries[0], data, 0);
    const result = { ...templateNarrative(data, null), newsSummaries: [selected] }, record = narrativeGenerationDiagnostics(value, data, result, Date.now());
    const news = record.fields.find(row => row.field === "newsSummaries");
    expect(news).toMatchObject({ validation: "off", fieldReason: null, summaryBasis: "body", usedSourceCounts: null });
    expect(news.sentences.every(row => row.reason === "validation_disabled" && row.accepted)).toBe(true);
    expect(JSON.stringify(record)).not.toMatch(/PRIVATE_BODY|HEADLINE_SENTINEL|MODEL_SENTINEL|120억원|서비스/);
  });
  it("reports verbatim masking instead of losing the original sentence count and lengths", () => {
    const passage = "PRIVATE_BODY_SENTINEL ".repeat(5), data = { ...input(), articleBodies: { [id]: { text: passage } } }, value = raw(); value.newsSummaries[0].text = passage;
    const record = narrativeGenerationDiagnostics(value, data, templateNarrative(data, null), Date.now());
    const news = record.fields.find(row => row.field === "newsSummaries"); expect(news.fieldReason).toBe("private_passage");
    expect(news.modelSentenceCount).toBe(1); expect(news.sentences[0].length).toBe(passage.trim().length);
    expect(JSON.stringify(record)).not.toContain("PRIVATE_BODY_SENTINEL");
  });
});
