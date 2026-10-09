import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
vi.mock("../../server/runLedger", () => ({ beginRun: vi.fn(async () => ({})), completeRun: vi.fn(async () => ({ finishedAt: new Date().toISOString() })), failRun: vi.fn(async () => ({})) }));
const mock = vi.hoisted(() => ({ spawned: [], validationError: false, oldFile: false }));
vi.mock("node:child_process", () => { const mocks = { spawn: vi.fn((command, args, options) => {
  mock.spawned.push({ command, args, options });
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn();
  queueMicrotask(() => child.emit("close", 0)); return child;
}) }; return { ...mocks, default: mocks }; });
vi.mock("node:fs/promises", () => { const mocks = { access: vi.fn(async () => {}), mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async () => '{"005930":{}}'), stat: vi.fn(async () => ({ mtimeMs: mock.oldFile ? 0 : Date.now(), isFile: () => true })) }; return { ...mocks, default: mocks }; });
vi.mock("../../server/pipelineFreshness", () => ({ pipelineProjectRoot: () => "fixture-root", pipelineOutputDir: () => "fixture-output", writePipelineRunMarker: vi.fn(async () => {}) }));
vi.mock("../../server/pipelineResults", () => ({ getCandidatesPayload: vi.fn(async () => [{}]), refreshDashboardAiFieldsFromPipelineOutput: vi.fn(async () => true),
  validateModelOnlyOutputs: vi.fn(async () => { if (mock.validationError) throw new Error("Invalid model output schema."); return { rows: 199, modelSelectionRows: 10 }; }) }));
import { runCandidateAnalysis, startCandidateAnalysis, startStockNewsAnalysis, getCandidateAnalysisSnapshot } from "../../server/pipelineRunner";
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
    expect(validateModelOnlyOutputs).toHaveBeenCalledOnce(); expect(refreshDashboardAiFieldsFromPipelineOutput).not.toHaveBeenCalled();
    expect(writePipelineRunMarker.mock.calls.map(([marker]) => marker.status)).toEqual(["running", "completed"]);
    expect(writePipelineRunMarker.mock.calls[1][0]).toMatchObject({ mode: "model_only", newsRows: 0 });
    expect(validateModelOnlyOutputs.mock.invocationCallOrder[0]).toBeLessThan(writePipelineRunMarker.mock.invocationCallOrder[1]);
  });
  it("keeps full mode flag, credentials, step3 validation and dashboard behavior", async () => {
    const result = await runCandidateAnalysis({ GEMINI_API_KEY: "fixture-full" });
    expect(mock.spawned[0].args).toContain("--run-news"); expect(mock.spawned[0].options.env.GEMINI_API_KEY).toBe("fixture-full");
    expect(result).toMatchObject({ status: "completed", rows: 1, newsRows: 1, dashboardUpdated: true });
    expect(validateModelOnlyOutputs).not.toHaveBeenCalled();
  });
  it("does not complete a failed model validation", async () => {
    mock.validationError = true; await expect(runCandidateAnalysis({ PIPELINE_ANALYSIS_MODE: "model_only" })).rejects.toThrow("Invalid model");
    expect(writePipelineRunMarker.mock.calls.map(([marker]) => marker.status)).toEqual(["running", "failed"]);
    expect(writePipelineRunMarker.mock.calls[1][0].mode).toBe("model_only");
  });
  it("full mode still requires fresh STEP3 output", async () => {
    mock.oldFile = true; await expect(runCandidateAnalysis({})).rejects.toThrow("not updated");
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
});
