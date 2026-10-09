import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/backendStatus", () => ({ getBackendStatus: vi.fn() }));

vi.mock("../../server/kisDashboard", () => ({
  buildFreshKisDashboard: vi.fn(), buildKisDashboard: vi.fn(), buildKisIndices: vi.fn(),
  buildKisStockChart: vi.fn(), buildKisStockQuote: vi.fn(), refreshDashboardSnapshot: vi.fn(),
}));
vi.mock("../../server/pipelineResults", () => ({ getCandidatesPayload: vi.fn(), getRankPayload: vi.fn(), getStockAnalysisPayload: vi.fn() }));
vi.mock("../../server/pipelineRunner", () => ({ getCandidateAnalysisStatus: vi.fn(), getStockNewsAnalysisStatus: vi.fn(), startCandidateAnalysis: vi.fn(), startStockNewsAnalysis: vi.fn() }));

import { apiMiddleware, apiRoutes, createRoutes } from "../../server/routes";
import refreshHandler from "../../api/korean-market/refresh";
import candidateHandler from "../../api/candidates";
import dashboardHandler from "../../api/korean-market/dashboard";
import { getCandidatesPayload } from "../../server/pipelineResults";
import { pipelineRow } from "./dataFixtures";

function response() {
  let body;
  const headers = {};
  const res = { statusCode: 0, setHeader: (key, value) => { headers[key] = value; }, end: text => { body = JSON.parse(text); } };
  return { res, headers, body: () => body };
}
function dependencies() {
  return { buildFreshKisDashboard: vi.fn(), buildKisDashboard: vi.fn(), buildKisIndices: vi.fn(),
    buildKisStockChart: vi.fn(), buildKisStockQuote: vi.fn(), refreshDashboardSnapshot: vi.fn().mockResolvedValue({ generatedAt: "2026-10-07T09:00:00Z", stocks: [{}, {}] }),
    getCandidatesPayload: vi.fn().mockResolvedValue([]), getRankPayload: vi.fn().mockResolvedValue([]), getStockAnalysisPayload: vi.fn().mockResolvedValue(null),
    getCandidateAnalysisStatus: vi.fn().mockReturnValue({ status: "idle" }), getStockNewsAnalysisStatus: vi.fn(),
    startCandidateAnalysis: vi.fn().mockReturnValue({ status: "running" }), startStockNewsAnalysis: vi.fn() };
}
beforeEach(() => vi.clearAllMocks());

describe("shared legacy route contracts", () => {
  it("validates and forwards explicit official classification without changing defaults", async () => {
    const deps = dependencies(), env = { PIPELINE_ANALYSIS_MODE: "model_only" }, handler = createRoutes(deps, env)["/api/candidates/run"];
    const ok = response(); await handler({ method: "POST", url: "/api/candidates/run?mode=model_only&kind=official" }, ok.res);
    expect(ok.res.statusCode).toBe(200);
    expect(deps.startCandidateAnalysis).toHaveBeenCalledWith({ ...env, PIPELINE_RUN_KIND: "official" });
    const invalid = response(); await handler({ method: "POST", url: "/api/candidates/run?kind=invalid" }, invalid.res);
    expect(invalid.res.statusCode).toBe(400);
    expect(env.PIPELINE_RUN_KIND).toBeUndefined();
  });
  it("does not allow unauthenticated scheduled collection GET", async () => {
    const deps = { ...dependencies(), startPerformanceCollection: vi.fn().mockReturnValue({ status: "running" }), runPerformanceCollection: vi.fn().mockResolvedValue({ status: "completed" }) };
    const handler = createRoutes(deps, { CRON_SECRET: "fixture-cron" })["/api/performance/collect"];
    const denied = response(); await handler({ method: "GET" }, denied.res);
    expect(denied.res.statusCode).toBe(401); expect(deps.startPerformanceCollection).not.toHaveBeenCalled();
    const accepted = response(); await handler({ method: "GET", headers: { authorization: "Bearer fixture-cron" } }, accepted.res);
    expect(accepted.res.statusCode).toBe(200); expect(deps.runPerformanceCollection).toHaveBeenCalledOnce();
    expect(accepted.body().status).toBe("completed"); expect(accepted.headers["Cache-Control"]).toBe("no-store");
    const local = response(); await handler({ method: "POST" }, local.res);
    expect(local.body().status).toBe("running"); expect(deps.startPerformanceCollection).toHaveBeenCalledOnce();
  });
  it("reports the runtime status source and the actual numeric progress timestamp", async () => {
    const deps = dependencies();
    deps.getCandidateAnalysisStatus.mockReturnValue({ status: "completed", progress: { updatedAt: 1791546454355 } });
    const result = response(); await createRoutes(deps, {})["/api/candidates/run"]({ method: "GET" }, result.res);
    expect(result.headers).toMatchObject({ "X-Data-Source": "live", "X-Data-As-Of": "2026-10-09T11:47:34.355Z" });
    expect(result.body()).toMatchObject({ source: "live", asOf: "2026-10-09T11:47:34.355Z" });
  });
  it("applies the requested mode only to this job and preserves the server default", async () => {
    const deps = dependencies(), env = { PIPELINE_ANALYSIS_MODE: "model_only", NAVER_CLIENT_ID: "fixture", NAVER_CLIENT_SECRET: "fixture", GEMINI_API_KEY: "fixture" };
    const handler = createRoutes(deps, env)["/api/candidates/run"];
    for (const mode of ["full", "model_only"]) {
      const result = response();
      await handler({ method: "POST", url: `/api/candidates/run?mode=${mode}` }, result.res);
      expect(result.res.statusCode).toBe(200);
      expect(deps.startCandidateAnalysis).toHaveBeenLastCalledWith({ ...env, PIPELINE_ANALYSIS_MODE: mode });
    }
    expect(env.PIPELINE_ANALYSIS_MODE).toBe("model_only");
    await handler({ method: "POST" }, response().res);
    expect(deps.startCandidateAnalysis).toHaveBeenLastCalledWith(env);
  });
  it("rejects invalid modes and missing news credentials before starting a job", async () => {
    const deps = dependencies(), handler = createRoutes(deps, {})["/api/candidates/run"];
    for (const mode of ["invalid", "", "full"]) {
      const result = response(); await handler({ method: "POST", url: `/api/candidates/run?mode=${mode}` }, result.res);
      expect(result.res.statusCode).toBe(400);
    }
    expect(deps.startCandidateAnalysis).not.toHaveBeenCalled();
    await handler({ method: "GET", url: "/api/candidates/run?mode=full" }, response().res);
    expect(deps.getCandidateAnalysisStatus).toHaveBeenCalledOnce();
  });
  it("file API exports the exact handler used by Vite", () => {
    expect(refreshHandler).toBe(apiRoutes["/api/korean-market/refresh"]);
    expect(candidateHandler).toBe(apiRoutes["/api/candidates"]);
    expect(dashboardHandler).toBe(apiRoutes["/api/korean-market/dashboard"]);
  });
  it("preserves POST query/header key authentication and compact response", async () => {
    const deps = dependencies(), handler = createRoutes(deps, { SNAPSHOT_REFRESH_KEY: "fixture-refresh-only" })["/api/korean-market/refresh"];
    for (const request of [
      { method: "POST", query: { key: "fixture-refresh-only" } },
      { method: "POST", url: "/api/korean-market/refresh?key=fixture-refresh-only" },
      { method: "POST", headers: { "x-refresh-key": ["fixture-refresh-only"] } },
    ]) {
      const result = response(); await handler(request, result.res);
      expect(result.res.statusCode).toBe(200);
      expect(result.body()).toEqual({ generatedAt: "2026-10-07T09:00:00Z", stocks: 2 });
    }
    const unauthorized = response(); await handler({ method: "POST" }, unauthorized.res);
    expect(unauthorized.res.statusCode).toBe(401);
    expect(deps.refreshDashboardSnapshot).toHaveBeenCalledTimes(3);
  });
  it("allows keyless local POST, restricts cron GET, and keeps method errors", async () => {
    const deps = dependencies(), handler = createRoutes(deps, { CRON_SECRET: "fixture-cron-only" })["/api/korean-market/refresh"];
    for (const [request, status] of [
      [{ method: "POST" }, 200], [{ method: "GET" }, 401],
      [{ method: "GET", headers: { authorization: "Bearer fixture-cron-only" } }, 200],
      [{ method: "GET", query: { key: "fixture-cron-only" } }, 401], [{ method: "PUT" }, 405],
    ]) {
      const result = response(); await handler(request, result.res); expect(result.res.statusCode).toBe(status);
    }
    const noCron = response(); await createRoutes(deps, {})["/api/korean-market/refresh"]({ method: "GET" }, noCron.res);
    expect(noCron.res.statusCode).toBe(401);
  });
  it("keeps array/null body shapes and publishes stored-pipeline metadata", async () => {
    const deps = dependencies(), routes = createRoutes(deps, {});
    for (const path of ["/api/candidates", "/api/rank"]) {
      const result = response(); await routes[path]({ method: "GET" }, result.res);
      expect(result.body()).toEqual([]); expect(result.headers["X-Data-Source"]).toBe("cache");
    }
    vi.mocked(deps.getCandidatesPayload).mockResolvedValue([pipelineRow()]);
    const result = response(); await routes["/api/candidates"]({ method: "GET" }, result.res);
    expect(Array.isArray(result.body())).toBe(true);
    expect(result.headers).toMatchObject({ "X-Data-Source": "cache", "X-Data-As-Of": "2026-10-07T09:00:00Z" });
    const nullStock = response(); await routes["/api/stock-analysis"]({ method: "GET", query: { code: ["005930"] } }, nullStock.res);
    expect(nullStock.body()).toBeNull();
  });
  it("keeps cached dashboard and per-index provenance without HTTP200 promotion", async () => {
    const deps = dependencies(), routes = createRoutes(deps, {});
    vi.mocked(deps.buildKisDashboard).mockResolvedValue({ source: "cache", generatedAt: "2026-10-07T09:00:00Z", indices: [{ symbol: "KOSPI", source: "sample", miniSeriesSource: "interpolated" }] });
    const result = response(); await routes["/api/korean-market/dashboard"]({ method: "GET" }, result.res);
    expect(result.headers["X-Data-Source"]).toBe("sample");
    expect(result.body()).toMatchObject({ indices: [{ source: "sample", miniSeriesSource: "interpolated" }] });
    await routes["/api/korean-market/dashboard"]({ method: "GET", query: { fresh: "1" } }, response().res);
    expect(deps.buildFreshKisDashboard).toHaveBeenCalledOnce();
  });
  it("dispatches exact paths and keeps query/method/error contracts", async () => {
    const deps = dependencies(), routes = createRoutes(deps, {});
    const missing = response(); await routes["/api/korean-market/quote"]({ method: "GET" }, missing.res);
    expect(missing.res.statusCode).toBe(400);
    const wrongMethod = response(); await routes["/api/candidates"]({ method: "POST" }, wrongMethod.res);
    expect(wrongMethod.res.statusCode).toBe(405);
    const next = vi.fn(); apiMiddleware({ method: "GET", url: "/api/candidates/extra" }, response().res, next); expect(next).toHaveBeenCalledOnce();
    vi.mocked(getCandidatesPayload).mockResolvedValue([]);
    const result = response(); apiMiddleware({ method: "GET", url: "/api/candidates?unused=1" }, result.res, next);
    await vi.waitFor(() => expect(result.res.statusCode).toBe(200));
    expect(result.body()).toEqual([]);
    vi.mocked(deps.buildKisStockQuote).mockRejectedValue(new Error("fixture upstream failed"));
    const failure = response(); await routes["/api/korean-market/quote"]({ method: "GET", query: { code: "005930" } }, failure.res);
    expect(failure.res.statusCode).toBe(502);
  });
  it("aggregates unknown child provenance conservatively without promoting parent cache", async () => {
    const deps = dependencies(), routes = createRoutes(deps, {});
    deps.buildKisDashboard.mockResolvedValue({ source: "cache", indices: [{ source: "live" }, { source: "unknown" }], stocks: [] });
    const result = response(); await routes["/api/korean-market/dashboard"]({ method: "GET" }, result.res);
    expect(result.headers["X-Data-Source"]).toBe("unknown");
    deps.buildKisDashboard.mockResolvedValue({ source: "cache", indices: [{ source: "live" }], stocks: [] });
    const cached = response(); await routes["/api/korean-market/dashboard"]({ method: "GET" }, cached.res);
    expect(cached.headers["X-Data-Source"]).toBe("cache");
  });
});
