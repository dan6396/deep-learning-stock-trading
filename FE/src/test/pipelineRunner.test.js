import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
vi.mock("../../server/runLedger", () => ({ beginRun: vi.fn(async () => ({})), completeRun: vi.fn(async () => ({ finishedAt: new Date().toISOString() })), failRun: vi.fn(async () => ({})) }));
vi.mock("../../server/relatedNews", () => ({ collectTopFiveArticles: vi.fn(async () => ({})) }));
const mock = vi.hoisted(() => ({ spawned: [], validationError: false, oldFile: false }));
vi.mock("node:child_process", () => { const mocks = { spawn: vi.fn((command, args, options) => {
  mock.spawned.push({ command, args, options });
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn();
  queueMicrotask(() => child.emit("close", 0)); return child;
}) }; return { ...mocks, default: mocks }; });
vi.mock("node:fs/promises", () => { const mocks = { access: vi.fn(async () => {}), mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async () => '{"005930":{}}'), stat: vi.fn(async () => ({ mtimeMs: mock.oldFile ? 0 : Date.now(), isFile: () => true })) }; return { ...mocks, default: mocks }; });
vi.mock("../../server/pipelineFreshness", () => ({ pipelineProjectRoot: () => "fixture-root", pipelineOutputDir: () => "fixture-output", writePipelineRunMarker: vi.fn(async () => {}) }));
vi.mock("../../server/pipelineResults", () => ({ inspectPipelineResultAvailability: vi.fn(async () => ({})), getRankPayload: vi.fn(async () => []), getStockAnalysisPayload: vi.fn(async () => null), parseCsv: vi.fn(() => []), getCandidatesPayload: vi.fn(async () => [{}]), refreshDashboardAiFieldsFromPipelineOutput: vi.fn(async () => true),
  validateModelOnlyOutputs: vi.fn(async () => { if (mock.validationError) throw new Error("Invalid model output schema."); return { rows: 199, modelSelectionRows: 10 }; }) }));
import { runCandidateAnalysis, startCandidateAnalysis, startStockNewsAnalysis, getCandidateAnalysisSnapshot, getCandidateAnalysisStatus } from "../../server/pipelineRunner";
import { createRoutes } from "../../server/routes";
import { collectTopFiveArticles } from "../../server/relatedNews";
import { writePipelineRunMarker } from "../../server/pipelineFreshness";
import { validateModelOnlyOutputs, refreshDashboardAiFieldsFromPipelineOutput } from "../../server/pipelineResults";
beforeEach(() => { vi.clearAllMocks(); mock.spawned.length = 0; mock.validationError = false; mock.oldFile = false; });
describe("model-only process safety (mock child; never executes Python)", () => {
  it("omits news flag and removes every inherited news/LLM key without mutating parent env", async () => {
    const env = { PIPELINE_ANALYSIS_MODE: "model_only", GEMINI_API_KEY: "fixture-gemini", NAVER_CLIENT_ID: "fixture-id", NAVER_CLIENT_SECRET: "fixture-secret", OPENAI_API_KEY: "fixture-openai", OPEN_AI: "fixture-alias", KIS_MOCK_APP_KEY: "fixture-kis", KIS_MOCK_APP_SECRET: "fixture-kis-secret" };
    const result = await runCandidateAnalysis(env), child = mock.spawned[0];
    expect(child.args).not.toContain("--run-news"); expect(child.args).toContain("--model-manifest");
    for (const name of ["GEMINI_API_KEY", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "OPENAI_API_KEY", "OPEN_AI_KEY", "OPEN_AI"]) expect(child.options.env).not.toHaveProperty(name);
    expect(env.GEMINI_API_KEY).toBe("fixture-gemini"); expect(child.options.env.APP_KEY).toBe("fixture-kis");
    expect(result).toMatchObject({ mode: "model_only", rows: 199, modelSelectionRows: 10, newsRows: 0, candidateKind: "not_produced", dashboardUpdated: false });
    expect(validateModelOnlyOutputs).toHaveBeenCalledOnce(); expect(collectTopFiveArticles).toHaveBeenCalledOnce();
    expect(validateModelOnlyOutputs.mock.invocationCallOrder[0]).toBeLessThan(collectTopFiveArticles.mock.invocationCallOrder[0]); expect(refreshDashboardAiFieldsFromPipelineOutput).not.toHaveBeenCalled();
    expect(writePipelineRunMarker.mock.calls.map(([marker]) => marker.status)).toEqual(["running", "completed"]);
    expect(writePipelineRunMarker.mock.calls[1][0]).toMatchObject({ mode: "model_only", newsRows: 0 });
    expect(validateModelOnlyOutputs.mock.invocationCallOrder[0]).toBeLessThan(writePipelineRunMarker.mock.invocationCallOrder[1]);
  });
  it("defaults to model inference and article collection without a news-analysis flag", async () => {
    await runCandidateAnalysis({});
    expect(mock.spawned[0].args).not.toContain("--run-news");
    expect(collectTopFiveArticles).toHaveBeenCalledOnce();
  });
  it("keeps full mode flag, credentials, step3 validation and dashboard behavior", async () => {
    const result = await runCandidateAnalysis({ PIPELINE_ANALYSIS_MODE: "full", GEMINI_API_KEY: "fixture-full" });
    expect(mock.spawned[0].args).toContain("--run-news"); expect(mock.spawned[0].options.env.GEMINI_API_KEY).toBe("fixture-full");
    expect(result).toMatchObject({ status: "completed", rows: 1, newsRows: 1, dashboardUpdated: true });
    expect(validateModelOnlyOutputs).not.toHaveBeenCalled();
  });
  it("does not complete a failed model validation", async () => {
    mock.validationError = true; await expect(runCandidateAnalysis({ PIPELINE_ANALYSIS_MODE: "model_only" })).rejects.toThrow("Invalid model");
    expect(writePipelineRunMarker.mock.calls.map(([marker]) => marker.status)).toEqual(["running", "failed"]);
    expect(writePipelineRunMarker.mock.calls[1][0].mode).toBe("model_only");
  });
  it("preserves model completion when article cache writing fails", async () => {
    collectTopFiveArticles.mockRejectedValueOnce(new Error("EACCES: fixture article cache write failed"));
    const result = await runCandidateAnalysis({ PIPELINE_ANALYSIS_MODE: "model_only" });
    expect(result).toMatchObject({ status: "completed", rows: 199, articleCollectionStatus: "unavailable", newsRows: 0 });
    expect(writePipelineRunMarker.mock.calls.map(([marker]) => marker.status)).toEqual(["running", "completed"]);
  });
  it("full mode still requires fresh STEP3 output", async () => {
    mock.oldFile = true; await expect(runCandidateAnalysis({ PIPELINE_ANALYSIS_MODE: "full" })).rejects.toThrow("not updated");
    expect(writePipelineRunMarker.mock.calls.at(-1)[0].status).toBe("failed");
  });
  it("rejects unknown modes and individual news launches before spawning", async () => {
    await expect(runCandidateAnalysis({ PIPELINE_ANALYSIS_MODE: "model-only-typo" })).rejects.toThrow("Unsupported");
    expect(() => startCandidateAnalysis({ PIPELINE_ANALYSIS_MODE: "typo" })).toThrow("Unsupported");
    expect(() => startStockNewsAnalysis("005930", { PIPELINE_ANALYSIS_MODE: "model_only" })).toThrow("disabled");
    expect(mock.spawned).toHaveLength(0); expect(writePipelineRunMarker).not.toHaveBeenCalled();
  });
  it("read-only memory snapshot does not invoke marker writes", () => {
    expect(getCandidateAnalysisSnapshot()).toEqual({ status: "idle" }); expect(writePipelineRunMarker).not.toHaveBeenCalled();
  });
  it("executes POST -> status -> model process -> collection even when the server default is full", async () => {
    const stages = [];
    validateModelOnlyOutputs.mockImplementationOnce(async () => {
      stages.push(getCandidateAnalysisStatus().progress.stageIndex);
      return { rows: 199, modelSelectionRows: 10 };
    });
    collectTopFiveArticles.mockImplementationOnce(async () => { stages.push(getCandidateAnalysisStatus().progress.stageIndex); return {}; });
    const handlers = createRoutes({ startCandidateAnalysis, getCandidateAnalysisStatus }, { PIPELINE_ANALYSIS_MODE: "full" });
    let body;
    const response = { statusCode: 0, setHeader: vi.fn(), end: text => { body = JSON.parse(text); } };
    await handlers["/api/candidates/run"]({ method: "POST", url: "/api/candidates/run" }, response);
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ status: "running", mode: "model_only" });
    await vi.waitFor(() => expect(getCandidateAnalysisStatus().status).toBe("completed"));
    expect(mock.spawned).toHaveLength(1);
    expect(mock.spawned[0].args).not.toContain("--run-news");
    expect(collectTopFiveArticles).toHaveBeenCalledOnce();
    expect(getCandidateAnalysisStatus().result).toMatchObject({ mode: "model_only", newsRows: 0 });
    expect(stages).toEqual([3, 4]);
    expect(getCandidateAnalysisStatus().progress.stageIndex).toBe(6);
  });
});
