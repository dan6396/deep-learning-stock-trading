import { beforeEach, describe, expect, it, vi } from "vitest";
// Real getBackendStatus through the real route; only disk/runtime inputs are faked. No network is reachable.
const disk = vi.hoisted(() => ({ marker: null }));
vi.mock("node:fs/promises", () => { const mocks = { stat: vi.fn(async () => ({ isFile: () => true, mtimeMs: 1791350000000 })) }; return { ...mocks, default: mocks }; });
vi.mock("../../server/pipelineFreshness", () => ({ pipelineRunMarkerPath: () => "/abs/private/outputs/.marker", readPipelineRunMarker: vi.fn(async () => disk.marker) }));
vi.mock("../../server/pipelineResults", () => ({ inspectPipelineResultAvailability: vi.fn(), getCandidatesPayload: vi.fn(), getRankPayload: vi.fn(), getStockAnalysisPayload: vi.fn() }));
vi.mock("../../server/pipelineRunner", () => ({ getCandidateAnalysisSnapshot: vi.fn(() => ({ status: "idle" })), getCandidateAnalysisStatus: vi.fn(), getStockNewsAnalysisStatus: vi.fn(), startCandidateAnalysis: vi.fn(), startStockNewsAnalysis: vi.fn() }));
vi.mock("../../server/kisDashboard", () => ({ buildFreshKisDashboard: vi.fn(), buildKisDashboard: vi.fn(), buildKisIndices: vi.fn(), buildKisStockChart: vi.fn(), buildKisStockQuote: vi.fn(), refreshDashboardSnapshot: vi.fn() }));
import { createRoutes } from "../../server/routes";
import { getBackendStatus } from "../../server/backendStatus";
import { inspectPipelineResultAvailability } from "../../server/pipelineResults";

const sentinels = { KIS_MOCK_APP_KEY: "SENTINEL-KIS-KEY", KIS_MOCK_APP_SECRET: "SENTINEL-KIS-SECRET", KIS_REAL_APP_KEY: "SENTINEL-REAL-KEY", KIS_REAL_APP_SECRET: "SENTINEL-REAL-SECRET",
  APP_KEY: "SENTINEL-APP-KEY", APP_SECRET: "SENTINEL-APP-SECRET", GEMINI_API_KEY: "SENTINEL-GEMINI", NAVER_CLIENT_ID: "SENTINEL-NAVER-ID", NAVER_CLIENT_SECRET: "SENTINEL-NAVER-SECRET",
  OPENAI_API_KEY: "SENTINEL-OPENAI", SNAPSHOT_REFRESH_KEY: "SENTINEL-REFRESH", CRON_SECRET: "SENTINEL-CRON", PIPELINE_OUTPUT_DIR: "C:/Users/SENTINEL-PATH/outputs", PIPELINE_PROJECT_ROOT: "/home/SENTINEL-ROOT",
  PYTHON_EXECUTABLE: "C:/SENTINEL-PYTHON/python.exe" };
const noRows = { state: "empty", count: 0, source: "cache", asOf: null };
function call(env, method = "GET") {
  const headers = {}, result = { status: 0, text: "" };
  const res = { get statusCode() { return result.status; }, set statusCode(value) { result.status = value; }, setHeader: (key, value) => { headers[key] = value; }, end: text => { result.text = text; } };
  const providers = { getBackendStatus };
  return createRoutes(providers, env)["/api/backend/status"]({ method, url: "/api/backend/status" }, res).then(() => ({ ...result, headers }));
}
let fetcher;
beforeEach(() => {
  vi.clearAllMocks(); disk.marker = { status: "completed", mode: "model_only", startedAt: 1791350000000, finishedAt: 1791350001000 };
  vi.mocked(inspectPipelineResultAvailability).mockResolvedValue({ candidates: { state: "not_produced", count: null, source: "unknown", asOf: null }, rank: { state: "available", count: 199, source: "cache", asOf: "2026-10-09T00:00:00.000Z" } });
  fetcher = vi.fn(async () => { throw new Error("network must not be reached"); }); vi.stubGlobal("fetch", fetcher);
});

describe("GET /api/backend/status is read-only and leak-free", () => {
  it("never echoes keys, secrets, paths or raw configuration and never reaches a provider", async () => {
    const result = await call({ ...sentinels, PIPELINE_ANALYSIS_MODE: "model_only" });
    expect(result.status).toBe(200); expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(result.headers["Content-Type"]).toContain("application/json");
    expect(result.text).not.toMatch(/SENTINEL|\/abs\/private|C:\/|\/home|\.marker|python/i);
    const body = JSON.parse(result.text);
    expect(body).toMatchObject({ version: 1, analysisMode: "model_only", source: "unknown", asOf: null,
      market: { configuration: "configured", verification: "unverified" },
      news: { configuration: "configured", collectionConfiguration: "configured", verification: "unverified" },
      results: { candidates: { state: "not_produced", count: null }, rank: { state: "available", count: 199 } } });
    expect(Object.keys(body).sort()).toEqual(["analysisMode", "asOf", "checkedAt", "marker", "market", "news", "results", "runtime", "source", "version"]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports configuration absence as not configured, never as verified", async () => {
    const body = JSON.parse((await call({})).text);
    expect(body).toMatchObject({ market: { configuration: "not_configured", verification: "unverified" }, news: { configuration: "not_configured", collectionConfiguration: "not_configured" }, analysisMode: "full" });
  });
  it.each([["model_only", "model_only"], ["full", "full"], [undefined, "full"], ["", "full"], ["MODEL_ONLY", "unknown"], ["model-only", "unknown"], ["typo", "unknown"]])("reports analysis mode %j as %s", async (mode, expected) => {
    const body = JSON.parse((await call(mode === undefined ? {} : { PIPELINE_ANALYSIS_MODE: mode })).text);
    expect(body.analysisMode).toBe(expected);
  });
  it("keeps the in-memory runtime separate from a failed disk marker", async () => {
    disk.marker = { status: "failed", mode: "model_only", startedAt: 1791350000000, finishedAt: 1791350001000, error: "SENTINEL raw failure /abs/private" };
    const result = await call({ PIPELINE_ANALYSIS_MODE: "model_only" }), body = JSON.parse(result.text);
    expect(body).toMatchObject({ runtime: { state: "idle" }, marker: { state: "failed", mode: "model_only" } });
    expect(result.text).not.toMatch(/SENTINEL|raw failure|\/abs/);
  });
  it("hides a provider failure behind a fixed message without a raw error or path", async () => {
    vi.mocked(inspectPipelineResultAvailability).mockRejectedValue(new Error("SENTINEL-RAW C:/Users/private/outputs"));
    const result = await call(sentinels), body = JSON.parse(result.text);
    expect(result.status).toBe(200); expect(result.text).not.toMatch(/SENTINEL|C:\/|private/);
    expect(body.results).toEqual({ candidates: { state: "unknown", count: null, source: "unknown", asOf: null }, rank: { state: "unknown", count: null, source: "unknown", asOf: null } });
  });
  it("hides a status builder crash behind a fixed error", async () => {
    const crashing = { getBackendStatus: vi.fn(async () => { throw new Error("SENTINEL-RAW /abs/private"); }) };
    const res = { statusCode: 0, text: "", setHeader() {}, end(text) { this.text = text; } };
    await createRoutes(crashing, sentinels)["/api/backend/status"]({ method: "GET" }, res);
    expect(res.statusCode).toBe(502); expect(JSON.parse(res.text)).toEqual({ error: "Backend status unavailable." });
  });
  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects %s without touching disk or runtime", async method => {
    const result = await call(sentinels, method);
    expect(result.status).toBe(405); expect(inspectPipelineResultAvailability).not.toHaveBeenCalled(); expect(result.text).not.toMatch(/SENTINEL/);
  });
});
