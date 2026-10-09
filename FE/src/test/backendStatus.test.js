import { beforeEach, describe, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => ({ marker: null, error: null }));
vi.mock("node:fs/promises", () => { const mocks = { stat: vi.fn(async () => { if (disk.error) throw disk.error; return { isFile: () => true, mtimeMs: 1791350000000 }; }) }; return { ...mocks, default: mocks }; });
vi.mock("../../server/pipelineFreshness", () => ({ pipelineRunMarkerPath: () => "fixture-marker", readPipelineRunMarker: vi.fn(async () => disk.marker) }));
vi.mock("../../server/pipelineResults", () => ({ inspectPipelineResultAvailability: vi.fn() }));
vi.mock("../../server/pipelineRunner", () => ({ getCandidateAnalysisSnapshot: vi.fn(() => ({ status: "idle" })) }));
import { getBackendStatus } from "../../server/backendStatus";
const empty = { state: "empty", count: 0, source: "cache", asOf: null };
const deps = () => ({ runtime: vi.fn(() => ({ status: "idle" })), availability: vi.fn(async () => ({ candidates: empty, rank: empty })) });
beforeEach(() => { disk.marker = { status: "completed", startedAt: 1791350000000, finishedAt: 1791350001000 }; disk.error = null; });
describe("read-only public backend status", () => {
  it.each([
    [{}, "not_configured"], [{ KIS_MOCK_APP_KEY: "fixture-key" }, "not_configured"],
    [{ KIS_MOCK_APP_SECRET: "fixture-secret" }, "not_configured"],
    [{ KIS_MOCK_APP_KEY: "fixture-key", KIS_MOCK_APP_SECRET: "fixture-secret" }, "configured"],
    [{ KIS_ENV: "real", KIS_MOCK_APP_KEY: "fixture-key", KIS_MOCK_APP_SECRET: "fixture-secret" }, "not_configured"],
    [{ KIS_ENV: "real", KIS_REAL_APP_KEY: "fixture-key", KIS_REAL_APP_SECRET: "fixture-secret" }, "configured"],
    [{ APP_KEY: "fixture-key", APP_SECRET: "fixture-secret" }, "configured"],
    [{ KIS_MOCK_APP_KEY: " ", KIS_MOCK_APP_SECRET: "fixture-secret", APP_KEY: "fallback" }, "not_configured"],
  ])("checks only the selected credential pair without provider verification: %j", async (env, configuration) => {
    const result = await getBackendStatus(env, deps());
    expect(result.market).toEqual({ configuration, verification: "unverified" });
    expect(JSON.stringify(result)).not.toMatch(/fixture-key|fixture-secret|fallback|APP_KEY|APP_SECRET/);
    expect(result).toMatchObject({ source: "unknown", asOf: null, results: { rank: { state: "empty", count: 0 } } });
  });
  it("does not infer collection or LLM success from settings", async () => {
    expect((await getBackendStatus({ GEMINI_API_KEY: "fixture-private", NAVER_CLIENT_ID: "fixture-id" }, deps())).news)
      .toEqual({ configuration: "configured", collectionConfiguration: "not_configured", verification: "unverified" });
  });
  it("keeps a disk failure separate from idle runtime and strips private marker fields", async () => {
    disk.marker = { ...disk.marker, status: "failed", error: "PRIVATE C:/account/key", mode: "model_only" };
    const d = deps(), result = await getBackendStatus({ PIPELINE_ANALYSIS_MODE: "model_only" }, d);
    expect(result).toMatchObject({ analysisMode: "model_only", runtime: { state: "idle" }, marker: { state: "failed", mode: "model_only", source: "cache" } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|account|C:\//); expect(d.runtime).toHaveBeenCalledOnce();
  });
  it.each(["absent", "invalid", "unknown"])("preserves marker %s", async state => {
    if (state === "absent") disk.error = Object.assign(new Error("private path"), { code: "ENOENT" });
    if (state === "unknown") disk.error = new Error("private permission");
    if (state === "invalid") disk.marker = { status: "completed", startedAt: NaN };
    expect((await getBackendStatus({}, deps())).marker.state).toBe(state);
  });
  it("returns safe unknown availability on loader errors without raw errors", async () => {
    const d = deps(); d.availability.mockRejectedValue(new Error("PRIVATE token absolute/path"));
    const result = await getBackendStatus({}, d);
    expect(result.results.rank).toEqual({ state: "unknown", count: null, source: "unknown", asOf: null });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});
