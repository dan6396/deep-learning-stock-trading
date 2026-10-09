import { buildFreshKisDashboard, buildKisDashboard, buildKisIndices, buildKisStockChart, buildKisStockQuote, refreshDashboardSnapshot } from "./kisDashboard";
import { getCandidatesPayload, getRankPayload, getStockAnalysisPayload } from "./pipelineResults";
import { getCandidateAnalysisStatus, getStockNewsAnalysisStatus, startCandidateAnalysis, startStockNewsAnalysis } from "./pipelineRunner";
import { getBackendStatus } from "./backendStatus";
import { getPerformancePayload, startPerformanceCollection, runPerformanceCollection } from "./performance";

declare const process: { env: Record<string, string | undefined> };
export type ApiRequest = {
  method?: string; url?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
};
export type ApiResponse = { end: (body: string) => void; setHeader: (name: string, value: string) => void; statusCode: number };
const providers = { buildFreshKisDashboard, buildKisDashboard, buildKisIndices, buildKisStockChart, buildKisStockQuote,
  refreshDashboardSnapshot, getCandidatesPayload, getRankPayload, getStockAnalysisPayload,
  getCandidateAnalysisStatus, getStockNewsAnalysisStatus, startCandidateAnalysis, startStockNewsAnalysis, getBackendStatus, getPerformancePayload, startPerformanceCollection, runPerformanceCollection };
export type RouteProviders = typeof providers;
export type RouteHandler = (request: ApiRequest, response: ApiResponse) => Promise<void>;

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function query(request: ApiRequest, key: string) {
  return first(request.query?.[key]) ?? new URL(request.url ?? "/", "http://localhost").searchParams.get(key) ?? undefined;
}
function writeJson(response: ApiResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}
function provenance(response: ApiResponse, payload: unknown, fallback: "cache" | "unknown" = "unknown") {
  const metas: { source: string; asOf: unknown }[] = [];
  const visit = (value: unknown, inherited: string) => {
    if (Array.isArray(value)) { value.forEach(row => visit(row, inherited)); return; }
    const object = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const meta = object.data_meta as Record<string, unknown> | undefined;
    const declared = object.isSample === true ? "sample" : meta?.source ?? object.source ?? inherited;
    const source = declared === "live" || declared === "cache" || declared === "sample" ? declared : "unknown";
    metas.push({ source, asOf: meta?.asOf ?? object.asOf ?? object.generatedAt });
    // Only data-bearing children: news.source is a publisher, not provenance.
    for (const key of ["indices", "stocks", "watchlist", "sourceStock"]) {
      if (object[key] !== undefined) visit(object[key], source);
    }
  };
  visit(payload, fallback);
  const source = metas.some(meta => meta.source === "sample") ? "sample" : metas.some(meta => meta.source === "unknown") ? "unknown"
    : metas.some(meta => meta.source === "cache") ? "cache" : metas.length ? "live" : fallback;
  response.setHeader("X-Data-Source", source);
  const asOf = metas.map(meta => meta.asOf).filter((time): time is string => typeof time === "string").sort()[0];
  if (asOf) response.setHeader("X-Data-As-Of", asOf);
}

/** One handler implementation for Vite and file-based API entry points. */
export function createRoutes(deps: RouteProviders = providers, env = process.env): Record<string, RouteHandler> {
  function analysisStatus(payload: ReturnType<RouteProviders["getCandidateAnalysisStatus"]>) {
    const updated = payload.progress?.updatedAt ?? payload.finishedAt ?? payload.startedAt;
    return { ...payload, source: "live", asOf: typeof updated === "number" && updated > 0 && Number.isFinite(new Date(updated).getTime()) ? new Date(updated).toISOString() : null };
  }
  const route = (methods: string[], build: (request: ApiRequest) => unknown | Promise<unknown>, source: "cache" | "unknown" = "unknown"): RouteHandler => async (request, response) => {
    if (!methods.includes(request.method ?? "")) { writeJson(response, 405, { error: "Method not allowed" }); return; }
    try {
      const payload = await build(request);
      provenance(response, payload, source);
      writeJson(response, 200, payload);
    } catch (error) {
      writeJson(response, error instanceof UnauthorizedRequest ? 401 : error instanceof MissingParameter ? 400 : 502, { error: error instanceof Error ? error.message : "API request failed." });
    }
  };
  const symbol = (request: ApiRequest) => required(query(request, "symbol") ?? query(request, "code"), "symbol");
  const ticker = (request: ApiRequest) => required(query(request, "ticker") ?? query(request, "code"), "ticker");
  const routes: Record<string, RouteHandler> = {
    "/api/backend/status": route(["GET"], async () => {
      try { return await deps.getBackendStatus(env); }
      catch { throw new Error("Backend status unavailable."); }
    }),
    "/api/korean-market/dashboard": route(["GET"], request => query(request, "fresh") === "1" ? deps.buildFreshKisDashboard() : deps.buildKisDashboard()),
    "/api/korean-market/indices": route(["GET"], () => deps.buildKisIndices()),
    "/api/korean-market/quote": route(["GET"], request => deps.buildKisStockQuote(symbol(request))),
    "/api/korean-market/stock-chart": route(["GET"], request => deps.buildKisStockChart(symbol(request))),
    "/api/candidates": route(["GET"], () => deps.getCandidatesPayload(), "cache"),
    "/api/rank": route(["GET"], () => deps.getRankPayload(), "cache"),
    "/api/stock-analysis": route(["GET"], request => deps.getStockAnalysisPayload(ticker(request)), "cache"),
    "/api/candidates/run": route(["GET", "POST"], request => {
      if (request.method !== "POST") return analysisStatus(deps.getCandidateAnalysisStatus());
      const mode = query(request, "mode");
      const kind = query(request, "kind");
      if (kind !== undefined && kind !== "official" && kind !== "adhoc") throw new MissingParameter("실행 구분은 official 또는 adhoc이어야 합니다.");
      const selectedEnv = kind === undefined ? env : { ...env, PIPELINE_RUN_KIND: kind };
      if (mode === undefined) return analysisStatus(deps.startCandidateAnalysis(selectedEnv));
      if (mode !== "model_only" && mode !== "full") throw new MissingParameter("분석 모드는 model_only 또는 full이어야 합니다.");
      if (mode === "full" && [env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET, env.GEMINI_API_KEY].some(value => !value?.trim())) {
        throw new MissingParameter("뉴스 포함 분석에는 네이버 뉴스와 Gemini API 설정이 필요합니다.");
      }
      // A request-scoped override: never change the server default or another job.
      return analysisStatus(deps.startCandidateAnalysis({ ...selectedEnv, PIPELINE_ANALYSIS_MODE: mode }));
    }),
    "/api/performance": route(["GET"], request => {
      const code = query(request, "symbol");
      if (code !== undefined && !/^\d{6}$/.test(code)) throw new MissingParameter("유효한 6자리 종목 코드가 필요합니다.");
      return deps.getPerformancePayload(env, code);
    }, "cache"),
    "/api/performance/collect": route(["GET", "POST"], request => {
      if (request.method === "GET" && (!env.CRON_SECRET || first(request.headers?.authorization) !== `Bearer ${env.CRON_SECRET}`)) throw new UnauthorizedRequest("예약 수집 인증이 필요합니다.");
      return request.method === "GET" ? deps.runPerformanceCollection(env) : deps.startPerformanceCollection(env);
    }),
    "/api/stock-analysis/run": route(["GET", "POST"], request => request.method === "POST" ? deps.startStockNewsAnalysis(ticker(request)) : deps.getStockNewsAnalysisStatus(ticker(request))),
  };
  const backendStatus = routes["/api/backend/status"];
  routes["/api/backend/status"] = async (request, response) => { response.setHeader("Cache-Control", "no-store"); await backendStatus(request, response); };
  for (const path of ["/api/performance", "/api/performance/collect"]) {
    const handler = routes[path];
    routes[path] = async (request, response) => { response.setHeader("Cache-Control", "no-store"); await handler(request, response); };
  }
  // Preserve the deployed refresh authentication and compact response contract.
  routes["/api/korean-market/refresh"] = async (request, response) => {
    if (request.method !== "POST" && request.method !== "GET") { writeJson(response, 405, { error: "Method not allowed" }); return; }
    const authorized = request.method === "GET"
      ? Boolean(env.CRON_SECRET) && first(request.headers?.authorization) === `Bearer ${env.CRON_SECRET}`
      : !env.SNAPSHOT_REFRESH_KEY || (query(request, "key") ?? first(request.headers?.["x-refresh-key"])) === env.SNAPSHOT_REFRESH_KEY;
    if (!authorized) { writeJson(response, 401, { error: "Unauthorized" }); return; }
    try {
      const data = await deps.refreshDashboardSnapshot();
      writeJson(response, 200, { generatedAt: data.generatedAt, stocks: data.stocks.length });
    } catch (error) { writeJson(response, 502, { error: error instanceof Error ? error.message : "Snapshot refresh failed." }); }
  };
  return routes;
}

class MissingParameter extends Error {}
class UnauthorizedRequest extends Error {}
function required(value: string | undefined, name: string) {
  if (!value) throw new MissingParameter(`${name} query parameter is required.`);
  return value;
}
export const apiRoutes = createRoutes();

/** Exact pathname matching prevents /run and parent routes from colliding. */
export function apiMiddleware(request: ApiRequest, response: ApiResponse, next: () => void): void {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const handler = apiRoutes[path];
  if (handler) void handler(request, response); else next();
}
