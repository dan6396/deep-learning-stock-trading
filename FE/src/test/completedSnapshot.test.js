import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ files: new Map(), blockComposition: null, entered: null, begin: null,
  rankGate: null, rankEntered: null, allowProcess: false, writeOutput: null, onCompleted: null, transport: null }));
vi.mock("../../server/refreshAhead", () => ({ warmCompletedQuotes: vi.fn(async rows => typeof rows === "function" ? rows() : rows), refreshCompletedTopFive: vi.fn() }));
vi.mock("node:fs/promises", () => {
  const item = path => {
    const file = fake.files.get(String(path).replace(/\\/g, "/").split("/").pop());
    if (!file) throw Object.assign(new Error("fixture absent"), { code: "ENOENT" });
    return file;
  };
  const name = path => String(path).replace(/\\/g, "/").split("/").pop();
  const mocks = { readFile: vi.fn(async path => {
    const file = item(path);
    if (name(path) === "step2_all_transformer_rank.csv" && fake.rankGate) { fake.rankEntered?.(); await fake.rankGate; }
    return file.text;
  }), access: vi.fn(async path => { if (!fake.allowProcess) item(path); }),
    stat: vi.fn(async path => ({ isFile: () => true, mtimeMs: item(path).mtime })), mkdir: vi.fn(), writeFile: vi.fn(async (path, text) => {
      fake.files.set(name(path), { text, mtime: Date.now() });
      if (name(path) === ".candidate-analysis-run.json") {
        const marker = JSON.parse(text);
        if (marker.status === "completed") fake.onCompleted?.(marker);
      }
    }), rename: vi.fn(async (from, to) => { fake.files.set(name(to), item(from)); fake.files.delete(name(from)); }) };
  return { ...mocks, default: mocks };
});
vi.mock("../../server/runLedger", () => ({ beginRun: vi.fn(() => fake.begin), completeRun: vi.fn(async () => ({ finishedAt: new Date().toISOString() })), failRun: vi.fn(async () => {}) }));
vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const spawn = vi.fn(() => {
    if (!fake.allowProcess) throw new Error("Python must never start");
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn();
    queueMicrotask(() => { fake.writeOutput?.(); child.emit("close", 0); });
    return child;
  });
  return { spawn, default: { spawn } };
});
vi.mock("../../server/pipelineResults", async importOriginal => ({ ...await importOriginal(), validateModelOnlyOutputs: vi.fn(async () => ({ rows: 1, modelSelectionRows: 1 })) }));
vi.mock("../../server/relatedNews", async importOriginal => ({ ...await importOriginal(), collectTopFiveArticles: vi.fn(async () => ({})) }));
vi.mock("../../server/marketMacro", async importOriginal => ({ ...await importOriginal(), getMarketMacro: vi.fn(async () => ({ asOf: null, indicators: [] })) }));
vi.mock("../../server/briefingComposition", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, getBriefingComposition: vi.fn(async input => {
    if (fake.blockComposition) { fake.entered(); return fake.blockComposition; }
    return actual.buildBriefingComposition(input);
  }) };
});
vi.mock("../../server/briefingNarrative", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, createNarrativeStore: () => {
    const stores = new Map();
    return { resolve: (...args) => {
      if (!fake.transport) return Promise.resolve(actual.templateNarrative(args[0], null));
      const key = args[2].PIPELINE_OUTPUT_DIR;
      if (!stores.has(key)) stores.set(key, actual.createNarrativeStore({ transport: (...request) => fake.transport(...request) }));
      return stores.get(key).resolve(...args);
    } };
  } };
});

import { getBriefing, generateBriefingNarrative, prepareRunBriefing, prepareCompletedResults, COMPLETED_PREPARATION_TIMEOUT_MS, AUTO_NARRATIVE_TIMEOUT_MS } from "../../server/briefing";
import { getRankPayload } from "../../server/pipelineResults";
import { startCandidateAnalysis, runCandidateAnalysis, getCandidateAnalysisStatus } from "../../server/pipelineRunner";
import { getMarketMacro } from "../../server/marketMacro";
import { getBriefingComposition } from "../../server/briefingComposition";
import { completedResults } from "../../server/completedResults";
import { createRoutes } from "../../server/routes";
import { spawn } from "node:child_process";

const first = { runId: "run-a", kind: "official", mode: "model_only", status: "completed", startedAt: 1791350000000, finishedAt: 1791350002000 };
const header = "ticker,company_name,prediction_target,ensemble_pred_return,pred_rank,pred_pool_size,prediction_base_date,prediction_status,rank_score,score_kind,model_id";
const csv = name => `${header}\n100001,${name},next_session_open_to_close,,1,1,2026-10-08,ok,1.5,rank_zscore,plain_20_120_rank_mean_v1\n`;
const set = (name, text, mtime = first.finishedAt + 2000) => fake.files.set(name, { text, mtime });
const marker = value => set(".candidate-analysis-run.json", JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let counter = 0, env;
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  fake.files.clear(); fake.blockComposition = null; fake.entered = null; fake.begin = null; vi.clearAllMocks();
  fake.rankGate = null; fake.rankEntered = null; fake.allowProcess = false; fake.writeOutput = null; fake.onCompleted = null;
  fake.transport = null;
  env = { PIPELINE_OUTPUT_DIR: `snapshot-integration-${++counter}` };
  marker(first); set("step2_all_transformer_rank.csv", csv("Run A"));
});

async function request(routes, path) {
  let body;
  await routes[path]({ method: "GET", url: path }, { statusCode: 0, setHeader: () => {}, end: text => { body = JSON.parse(text); } });
  return body;
}

function geminiResponse(request) {
  const input = JSON.parse(JSON.parse(request.body).contents[0].parts[0].text).inputData;
  return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({
    overview: "모델 순위와 기사를 확인했습니다. 입력 순서를 유지합니다.", marketNote: "시장 관측 자료를 참고합니다.",
    stocks: input.stocks.map(stock => ({ code: stock.code, summary: "모델 순위를 유지합니다.", citations: [`R:${stock.code}`] })),
    citations: input.stocks.map(stock => `R:${stock.code}`),
  }) }] } }] }) };
}

describe("automatic narrative before atomic publication (mock Gemini and Python)", () => {
  it("keeps both APIs and status on the previous run until one shared automatic attempt finishes", async () => {
    const saved = await getBriefing(env), gate = deferred(), entered = deferred();
    env.GEMINI_API_KEY = "fixture-gemini-key";
    fake.transport = vi.fn(async (_url, options) => { entered.resolve(); await gate.promise; return geminiResponse(options); });
    fake.allowProcess = true;
    fake.writeOutput = () => set("step2_all_transformer_rank.csv", csv("New run"), Date.now());
    const run = startCandidateAnalysis(env);
    await entered.promise;
    expect(getCandidateAnalysisStatus()).toMatchObject({ status: "running", progress: { stage: "AI 요약 생성", stageIndex: 7, stageCount: 8 } });
    expect(JSON.parse(fake.files.get(".candidate-analysis-run.json").text).status).toBe("running");
    const routes = createRoutes(undefined, env);
    expect(await request(routes, "/api/briefing")).toEqual({ ...saved, previousRun: { reason: "running" } });
    expect((await request(routes, "/api/rank"))[0]).toMatchObject({ result: { company_name: "Run A" }, data_meta: { previousRun: { reason: "running" } } });
    expect(startCandidateAnalysis(env)).toMatchObject({ runId: run.runId, status: "running" });
    expect(() => startCandidateAnalysis({ ...env, PIPELINE_RUN_KIND: "official" })).toThrow("다른 종류");
    const attached = runCandidateAnalysis(env);
    gate.resolve();
    await attached;
    await vi.waitFor(() => expect(getCandidateAnalysisStatus().status).toBe("completed"));
    const snapshot = completedResults.get(env);
    expect(snapshot).toMatchObject({ marker: { runId: run.runId }, briefing: { stocks: [{ name: "New run" }], narrative: { status: "llm" } } });
    expect(snapshot.briefing.model.finishedAt).toBe(new Date(snapshot.marker.finishedAt).toISOString());
    expect(snapshot.briefing.model.elapsedMs).toBe(snapshot.marker.finishedAt - snapshot.marker.startedAt);
    expect(fake.transport).toHaveBeenCalledOnce(); expect(spawn).toHaveBeenCalledOnce();
    expect((await getBriefing(env)).narrative.status).toBe("llm");
  });

  it.each(["failure", "timeout", "invalid", "missing_key", "disabled"])("publishes template and completes on %s", async mode => {
    await getBriefing(env);
    const entered = deferred(), late = deferred();
    env.GEMINI_API_KEY = mode === "missing_key" ? "" : "fixture-gemini-key";
    if (mode === "disabled") env.BRIEFING_AUTO_NARRATIVE = "0";
    fake.transport = vi.fn(async (_url, options) => {
      entered.resolve();
      if (mode === "failure") throw new Error("fixture provider failure");
      if (mode === "timeout") { await late.promise; return geminiResponse(options); }
      if (mode === "invalid") return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] }) };
      return geminiResponse(options);
    });
    fake.allowProcess = true;
    fake.writeOutput = () => set("step2_all_transformer_rank.csv", csv("New run"), Date.now());
    if (mode === "timeout") vi.useFakeTimers();
    const pending = runCandidateAnalysis(env);
    if (mode === "timeout") { await vi.advanceTimersByTimeAsync(0); await entered.promise; await vi.advanceTimersByTimeAsync(AUTO_NARRATIVE_TIMEOUT_MS); }
    const result = await pending;
    expect(result.status).toBe("completed");
    const expected = { failure: "generation_failed", timeout: "generation_timeout", invalid: "invalid_schema", missing_key: "missing_api_key", disabled: "auto_disabled" }[mode];
    expect(completedResults.get(env)).toMatchObject({ marker: { status: "completed", runId: result.runId }, briefing: { narrative: { status: "template", fallbackReason: expected }, stocks: [{ name: "New run" }] } });
    expect(fake.transport).toHaveBeenCalledTimes(["missing_key", "disabled"].includes(mode) ? 0 : 1);
    expect((await getBriefing(env)).narrative).toMatchObject({ status: "template", fallbackReason: expected });
    if (mode === "timeout") {
      expect(fake.transport.mock.calls[0][1].signal.aborted).toBe(true);
      const cached = fake.files.get("briefing-narrative.json").text, snapshot = completedResults.get(env);
      late.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(fake.files.get("briefing-narrative.json").text).toBe(cached);
      expect(JSON.parse(cached).narrative).toMatchObject({ status: "template", fallbackReason: "generation_timeout" });
      expect(completedResults.get(env)).toEqual(snapshot);
      expect((await getBriefing(env)).narrative).toMatchObject({ status: "template", fallbackReason: "generation_timeout" });
    }
    if (["failure", "timeout", "invalid"].includes(mode)) {
      fake.transport.mockClear();
      expect((await generateBriefingNarrative(env)).narrative).toMatchObject({ status: "template", fallbackReason: "cooldown" });
      expect(fake.transport).not.toHaveBeenCalled();
    }
  });

  it("reuses a matching input hash without Gemini even when macro cache is stale", async () => {
    fake.transport = vi.fn(async (_url, options) => geminiResponse(options));
    env.GEMINI_API_KEY = "fixture-gemini-key";
    const staged = { ...first, runId: "same-run", kind: "adhoc" };
    marker({ ...staged, status: "running", finishedAt: undefined });
    const initial = await prepareRunBriefing(staged, env);
    expect(initial.briefing.narrative.status).toBe("llm");
    fake.transport.mockClear();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 660_000);
    getMarketMacro.mockResolvedValueOnce({ asOf: new Date().toISOString(), indicators: [] });
    expect((await prepareRunBriefing(staged, env)).briefing.narrative).toMatchObject({ status: "llm", macroStale: true });
    expect(fake.transport).not.toHaveBeenCalled();
  });

  it("completes a subsequent run during failure cooldown without another Gemini call", async () => {
    fake.transport = vi.fn(async () => { throw new Error("fixture provider failure"); });
    env.GEMINI_API_KEY = "fixture-gemini-key"; fake.allowProcess = true;
    fake.writeOutput = () => set("step2_all_transformer_rank.csv", csv("First failure"), Date.now());
    await runCandidateAnalysis(env);
    fake.writeOutput = () => set("step2_all_transformer_rank.csv", csv("Cooldown run"), Date.now());
    expect((await runCandidateAnalysis(env)).status).toBe("completed");
    expect(completedResults.get(env).briefing).toMatchObject({ stocks: [{ name: "Cooldown run" }], narrative: { status: "template", fallbackReason: "cooldown" } });
    expect(fake.transport).toHaveBeenCalledOnce();
    expect((await getBriefing(env)).narrative).toMatchObject({ status: "template", fallbackReason: "cooldown" });
  });
});

describe("atomic completed results through the real APIs", () => {
  it("publishes a completed run without any briefing or rank GET", async () => {
    await getBriefing(env); // Run 1 is the previously viewed snapshot.
    fake.allowProcess = true;
    fake.writeOutput = () => set("step2_all_transformer_rank.csv", csv("Run 2"), Date.now());
    const result = await runCandidateAnalysis(env); // Only the mocked child executes.
    expect(result.status).toBe("completed");
    await vi.waitFor(() => expect(completedResults.get(env).marker.runId).toBe(result.runId));
    expect(completedResults.get(env).briefing.stocks[0].name).toBe("Run 2");
    expect(completedResults.get(env).rank[0].result.company_name).toBe("Run 2");
    expect(getMarketMacro).toHaveBeenCalledTimes(2); expect(getBriefingComposition).toHaveBeenCalledTimes(2);
  });

  it("publishes run-2 before releasing the lock and retains it when run-3 starts", async () => {
    await getBriefing(env);
    const composition = { basis: "equal_weight_reference", note: "fixture full composition",
      sectors: [{ name: "반도체", codes: ["100001"] }], sectorSource: "kis",
      performance: { asOf: "2026-10-08", measuredDays: 1, averageReturnPct: 1, positiveDays: 1, recent: [{ date: "2026-10-08", returnPct: 1 }] },
      diversification: { status: "ready", commonRisks: [] }, commonCautions: [] };
    getBriefingComposition.mockResolvedValueOnce(composition);
    fake.allowProcess = true;
    fake.writeOutput = () => set("step2_all_transformer_rank.csv", csv("Run 2"), Date.now());
    const second = await runCandidateAnalysis(env);
    expect(completedResults.get(env).marker.runId).toBe(second.runId);
    expect(completedResults.get(env).briefing.composition).toEqual(composition);
    const thirdGate = deferred(); fake.begin = thirdGate.promise;
    const third = startCandidateAnalysis(env);
    expect(third.status).toBe("running"); expect(third.runId).not.toBe(second.runId);
    const routes = createRoutes(undefined, env);
    const rank = request(routes, "/api/rank"), briefing = request(routes, "/api/briefing");
    expect((await rank)[0]).toMatchObject({ result: { company_name: "Run 2" }, data_meta: { previousRun: { reason: "running" } } });
    expect(await briefing).toMatchObject({ stocks: [{ name: "Run 2" }], previousRun: { reason: "running" }, composition });
    expect(completedResults.get(env).marker.runId).toBe(second.runId);
    expect(spawn).toHaveBeenCalledOnce(); // Run 3 has not reached the mocked child.
    thirdGate.reject(new Error("fixture run-3 failure"));
    await vi.waitFor(() => expect(getCandidateAnalysisStatus().status).toBe("failed"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((await getRankPayload(env))[0]).toMatchObject({ result: { company_name: "Run 2" }, data_meta: { previousRun: { reason: "failed" } } });
    expect(await getBriefing(env)).toMatchObject({ stocks: [{ name: "Run 2" }], previousRun: { reason: "failed" } });
  });

  it("captures unqueried disk run-2 before run-3 even when run-1 is already saved", async () => {
    await getBriefing(env);
    const second = { ...first, runId: "run-2", startedAt: first.startedAt + 1000 };
    marker(second); set("step2_all_transformer_rank.csv", csv("Run 2"));
    const capture = deferred(), entered = deferred(), thirdGate = deferred();
    fake.rankGate = capture.promise; fake.rankEntered = entered.resolve; fake.begin = thirdGate.promise;
    expect(startCandidateAnalysis(env).status).toBe("running");
    await entered.promise;
    let rankReturned = false;
    const rank = getRankPayload(env).then(value => { rankReturned = true; return value; });
    const briefing = getBriefing(env);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(rankReturned).toBe(false);
    capture.resolve();
    expect((await rank)[0].result.company_name).toBe("Run 2");
    expect(await briefing).toMatchObject({ stocks: [{ name: "Run 2" }], previousRun: { reason: "running" } });
    expect(completedResults.get(env).marker.runId).toBe("run-2");
    thirdGate.reject(new Error("fixture run-3 failure"));
    await vi.waitFor(() => expect(getCandidateAnalysisStatus().status).toBe("failed"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("answers both APIs from the previous pair when capture fails", async () => {
    const saved = await getBriefing(env), savedRank = await getRankPayload(env);
    marker({ ...first, runId: "run-2", startedAt: first.startedAt + 1000 }); set("step2_all_transformer_rank.csv", csv("Run 2"));
    const capture = deferred(), entered = deferred(); fake.rankGate = capture.promise; fake.rankEntered = entered.resolve;
    const preparing = prepareCompletedResults(env); await entered.promise;
    const rank = getRankPayload(env), briefing = getBriefing(env);
    capture.reject(new Error("fixture failed disk read"));
    await preparing;
    expect(await rank).toEqual(savedRank); expect(await briefing).toEqual(saved);
    // Later requests also retry through the bounded barrier, rather than unbounded ordinary GET assembly.
    expect(await getRankPayload(env)).toEqual(savedRank); expect(await getBriefing(env)).toEqual(saved);
    expect(completedResults.get(env).marker.runId).toBe("run-a");
  });

  it.each([true, false])("answers on capture timeout and prevents late publication (previous snapshot=%s)", async warm => {
    const saved = warm ? await getBriefing(env) : null;
    marker({ ...first, runId: "run-2", startedAt: first.startedAt + 1000 }); set("step2_all_transformer_rank.csv", csv("Run 2"));
    const capture = deferred(), entered = deferred(); fake.rankGate = capture.promise; fake.rankEntered = entered.resolve;
    vi.useFakeTimers();
    const preparing = prepareCompletedResults(env); await entered.promise;
    const rank = getRankPayload(env), briefing = getBriefing(env);
    await vi.advanceTimersByTimeAsync(COMPLETED_PREPARATION_TIMEOUT_MS);
    await preparing;
    expect((await rank).map(row => row.result.company_name)).toEqual(warm ? ["Run A"] : []);
    expect(await briefing).toEqual(saved ?? expect.objectContaining({ status: "no_run", model: null, stocks: [] }));
    const nextRank = getRankPayload(env), nextBriefing = getBriefing(env);
    await vi.advanceTimersByTimeAsync(COMPLETED_PREPARATION_TIMEOUT_MS);
    expect((await nextRank).map(row => row.result.company_name)).toEqual(warm ? ["Run A"] : []);
    expect((await nextBriefing).status).toBe(warm ? "ready" : "no_run");
    capture.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(completedResults.get(env)?.marker.runId).toBe(warm ? "run-a" : undefined);
    fake.rankGate = null;
    await prepareCompletedResults(env);
    expect(completedResults.get(env).marker.runId).toBe("run-2");
  });

  it("returns running flags immediately after start, before any running marker write, and reuses the warm pair", async () => {
    const saved = await getBriefing(env), originalRank = await getRankPayload(env);
    const gate = deferred(); fake.begin = gate.promise;
    const routes = createRoutes(undefined, env);
    expect(startCandidateAnalysis(env).status).toBe("running");
    // This disk fixture deliberately stays completed throughout preparation.
    expect(JSON.parse(fake.files.get(".candidate-analysis-run.json").text).status).toBe("completed");
    const rank = await getRankPayload(env);
    expect(rank).toEqual(originalRank.map(row => ({ ...row, data_meta: { ...row.data_meta, previousRun: { reason: "running" } } })));
    expect(await request(routes, "/api/rank")).toEqual(rank);
    expect(await request(routes, "/api/briefing")).toEqual({ ...saved, previousRun: { reason: "running" } });
    expect(getMarketMacro).toHaveBeenCalledOnce(); expect(getBriefingComposition).toHaveBeenCalledOnce();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(getCandidateAnalysisStatus().status).toBe("failed");
    expect((await getBriefing(env)).previousRun.reason).toBe("failed");
    expect((await getRankPayload(env))[0].data_meta.previousRun.reason).toBe("failed");
    vi.useRealTimers();
    gate.reject(new Error("fixture preparation stopped"));
    await vi.waitFor(() => expect(getCandidateAnalysisStatus().status).toBe("failed"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("waits for cold disk capture when API reads arrive immediately after start", async () => {
    const gate = deferred(); fake.begin = gate.promise;
    const routes = createRoutes(undefined, env);
    expect(completedResults.get(env)).toBeUndefined();
    expect(startCandidateAnalysis(env).status).toBe("running");
    const [rank, briefing] = await Promise.all([request(routes, "/api/rank"), request(routes, "/api/briefing")]);
    expect(rank[0]).toMatchObject({ result: { company_name: "Run A" }, data_meta: { previousRun: { reason: "running" } } });
    expect(briefing).toMatchObject({ status: "ready", previousRun: { reason: "running" }, kind: "official", stocks: [{ name: "Run A" }] });
    expect(getMarketMacro).not.toHaveBeenCalled(); expect(getBriefingComposition).not.toHaveBeenCalled();
    gate.reject(new Error("fixture preparation stopped"));
    await vi.waitFor(() => expect(getCandidateAnalysisStatus().status).toBe("failed"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["stale", "empty", "invalid"])("does not replace either member of the pair with %s rank data", async invalid => {
    const saved = await getBriefing(env), rank = await getRankPayload(env);
    const second = { ...first, runId: "run-b", kind: "adhoc", startedAt: first.startedAt + 10_000, finishedAt: first.finishedAt + 10_000 };
    marker(second);
    set("step2_all_transformer_rank.csv", invalid === "empty" ? `${header}\n` : invalid === "invalid" ? csv("Run B").replace(",1,1,2026", ",2,1,2026") : csv("Run B"), invalid === "stale" ? first.startedAt : second.finishedAt);
    expect(await getBriefing(env)).toEqual(saved);
    expect(await getRankPayload(env)).toEqual(rank);
    marker({ ...second, status: "failed" });
    expect(await getBriefing(env)).toEqual({ ...saved, previousRun: { reason: "failed" } });
    expect((await getRankPayload(env))[0]).toMatchObject({ result: { company_name: "Run A" }, data_meta: { previousRun: { reason: "failed" } } });
    expect(completedResults.get(env).marker.runId).toBe("run-a");
  });

  it("keeps rank A and briefing A when composition B finishes after marker C starts", async () => {
    const saved = await getBriefing(env);
    const second = { ...first, runId: "run-b", kind: "adhoc", startedAt: first.startedAt + 1000 };
    marker(second); set("step2_all_transformer_rank.csv", csv("Run B"));
    const gate = deferred(), entered = deferred(); fake.blockComposition = gate.promise; fake.entered = entered.resolve;
    const pending = getBriefing(env);
    await entered.promise;
    expect(completedResults.get(env).rank[0].result.company_name).toBe("Run A");
    expect(completedResults.get(env).briefing).toEqual(saved);
    marker({ ...second, runId: "run-c", status: "running", startedAt: first.startedAt + 2000 });
    const rank = await getRankPayload(env);
    expect(rank[0]).toMatchObject({ result: { company_name: "Run A" }, data_meta: { previousRun: { reason: "running" } } });
    gate.resolve({ ...saved.composition, note: "Run B must not be published" });
    expect(await pending).toEqual({ ...saved, previousRun: { reason: "running" } });
    expect(completedResults.get(env).marker.runId).toBe("run-a");
  });

  it("promotes rank B and briefing B together only after assembly finishes", async () => {
    await getBriefing(env);
    const second = { ...first, runId: "run-b", kind: "adhoc", startedAt: first.startedAt + 1000 };
    marker(second); set("step2_all_transformer_rank.csv", csv("Run B"));
    const gate = deferred(), entered = deferred(); fake.blockComposition = gate.promise; fake.entered = entered.resolve;
    const pending = getBriefing(env); await entered.promise;
    expect(completedResults.get(env).marker.runId).toBe("run-a");
    gate.resolve({ sectors: null, performance: null, commonCautions: [], basis: "equal_weight_reference", note: "Run B" });
    expect((await pending).stocks[0].name).toBe("Run B");
    expect((await getRankPayload(env))[0].result.company_name).toBe("Run B");
    expect(completedResults.get(env).marker.runId).toBe("run-b");
  });

  it("cold preparation makes no market/composition provider call and warm preparation reuses it", async () => {
    await prepareCompletedResults(env);
    expect(completedResults.get(env).briefing.status).toBe("ready");
    expect(getMarketMacro).not.toHaveBeenCalled(); expect(getBriefingComposition).not.toHaveBeenCalled();
    fake.files.clear(); await prepareCompletedResults(env);
    expect(completedResults.get(env).marker.runId).toBe("run-a");
  });

  it("handles rejected GET dependencies without exposing a mixed or failed response", async () => {
    await getBriefing(env);
    marker({ ...first, runId: "run-b", startedAt: first.startedAt + 1000 }); set("step2_all_transformer_rank.csv", csv("Run B"));
    getMarketMacro.mockRejectedValueOnce(new Error("fixture macro failure"));
    getBriefingComposition.mockRejectedValueOnce(new Error("fixture composition failure"));
    expect((await getBriefing(env)).stocks[0].name).toBe("Run B");
    expect((await getRankPayload(env))[0].result.company_name).toBe("Run B");
  });
});
