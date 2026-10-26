import { buildFreshKisDashboard, buildKisDashboard, buildKisIndices, buildKisStockChart, buildKisStockQuote, fetchKisTargetSession, refreshDashboardSnapshot } from "./kisDashboard";
import { getCandidatesPayload, getRankPayload, getStockAnalysisPayload } from "./pipelineResults";
import { getCandidateAnalysisStatus, startCandidateAnalysis } from "./pipelineRunner";
import { getBackendStatus } from "./backendStatus";
import { nextKrxSession } from "./krxCalendar";
import { getPerformancePayload, startPerformanceCollection, runPerformanceCollection } from "./performance";
import { getBriefing, generateBriefingNarrative } from "./briefing";
import { getStockInsight } from "./stockInsight";
import { authorizeWrite, bearerRole, clientIp, createWriteLimiter, HttpError, isLocalDevelopmentRequest, localWriteAllowed, tokenMatches } from "./writeSecurity";

declare const process: { env: Record<string, string | undefined> };
export type ApiRequest = {
  method?: string; url?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string; encrypted?: boolean };
};
export type ApiResponse = { end: (body: string) => void; setHeader: (name: string, value: string) => void; statusCode: number; headersSent?: boolean };
const providers = { buildFreshKisDashboard, buildKisDashboard, buildKisIndices, buildKisStockChart, buildKisStockQuote, fetchKisTargetSession,
  refreshDashboardSnapshot, getCandidatesPayload, getRankPayload, getStockAnalysisPayload, getStockInsight, getBriefing, generateBriefingNarrative,
  getCandidateAnalysisStatus, startCandidateAnalysis, getBackendStatus, getPerformancePayload, startPerformanceCollection, runPerformanceCollection };
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
export function createRoutes(deps: RouteProviders = providers, env = process.env, options: { development?: boolean } = {}): Record<string, RouteHandler> {
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
      writeJson(response, error instanceof HttpError ? error.status : error instanceof UnauthorizedRequest ? 401 : error instanceof MissingParameter ? 400 : 502, { ...(error instanceof HttpError ? error.details : {}), error: error instanceof Error ? error.message : "API request failed." });
    }
  };
  const symbol = (request: ApiRequest) => required(query(request, "symbol") ?? query(request, "code"), "symbol");
  const ticker = (request: ApiRequest) => required(query(request, "ticker") ?? query(request, "code"), "ticker");
  const routes: Record<string, RouteHandler> = {
    "/api/backend/status": route(["GET"], async () => {
      try { return { ...await deps.getBackendStatus(env), localWriteAllowed: localWriteAllowed(env, options.development) }; }
      catch { throw new Error("Backend status unavailable."); }
    }),
    "/api/korean-market/dashboard": route(["GET"], request => query(request, "fresh") === "1" ? deps.buildFreshKisDashboard() : deps.buildKisDashboard()),
    "/api/korean-market/indices": route(["GET"], () => deps.buildKisIndices()),
    "/api/korean-market/quote": route(["GET"], request => deps.buildKisStockQuote(symbol(request))),
    "/api/korean-market/stock-chart": route(["GET"], request => deps.buildKisStockChart(symbol(request))),
    // Next KRX session after an analysis base date, from the KIS holiday calendar (cached on disk once per day).
    "/api/korean-market/next-session": route(["GET"], async request => {
      const baseDate = required(query(request, "baseDate"), "baseDate");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || new Date(`${baseDate}T00:00:00Z`).toISOString().slice(0, 10) !== baseDate) throw new MissingParameter("baseDate must be YYYY-MM-DD.");
      // KIS needs a real-trading key; otherwise fall back to the built-in KRX closure table.
      let kisSession: string | null = null;
      try { kisSession = await deps.fetchKisTargetSession(baseDate, env); } catch { kisSession = null; }
      const nextSession = kisSession ?? nextKrxSession(baseDate);
      return { baseDate, nextSession, calendar: kisSession ? "kis" : nextSession ? "krx-table" : null, source: kisSession ? "live" : nextSession ? "cache" : "unknown", asOf: new Date().toISOString() };
    }),
    "/api/candidates": route(["GET"], () => deps.getCandidatesPayload(), "cache"),
    "/api/rank": route(["GET"], () => deps.getRankPayload(env), "cache"),
    "/api/briefing": route(["GET"], () => deps.getBriefing(env), "cache"),
    "/api/briefing/narrative": route(["POST"], request => { authorizeWrite(request, env, options.development); return deps.generateBriefingNarrative(env); }, "cache"),
    "/api/stock-analysis": route(["GET"], request => deps.getStockAnalysisPayload(ticker(request), env), "cache"),
    "/api/stock-insight": route(["GET"], request => {
      const code = ticker(request);
      if (!/^\d{6}$/.test(code) || code === "000000") throw new MissingParameter("유효한 6자리 종목 코드가 필요합니다.");
      return deps.getStockInsight(code, env);
    }, "cache"),
    "/api/candidates/run": route(["GET", "POST"], request => {
      if (request.method !== "POST") return analysisStatus(deps.getCandidateAnalysisStatus());
      const role = authorizeWrite(request, env, options.development);
      const mode = query(request, "mode");
      const kind = query(request, "kind");
      if (kind !== undefined && kind !== "official" && kind !== "adhoc") throw new MissingParameter("실행 구분은 official 또는 adhoc이어야 합니다.");
      if (kind === "official" && role !== "cron") throw new HttpError(403, "공식 실행은 장 마감 후 예약 작업만 허용합니다. 수시 실행으로 다시 요청해 주세요.");
      const selectedEnv = { ...env, PIPELINE_RUN_KIND: role === "cron" && kind === "official" ? "official" : "adhoc" };
      if (mode !== undefined && mode !== "model_only") throw new MissingParameter("브리핑은 모델 예측과 관련 기사 수집만 지원합니다.");
      // A request-scoped override: never change the server default or another job.
      return analysisStatus(deps.startCandidateAnalysis({ ...selectedEnv, PIPELINE_ANALYSIS_MODE: "model_only" }));
    }),
    "/api/performance": route(["GET"], request => {
      const code = query(request, "symbol");
      if (code !== undefined && !/^\d{6}$/.test(code)) throw new MissingParameter("유효한 6자리 종목 코드가 필요합니다.");
      return deps.getPerformancePayload(env, code);
    }, "cache"),
    "/api/performance/collect": route(["GET", "POST"], request => {
      if (request.method === "GET") {
        if (!tokenMatches(first(request.headers?.authorization), env.CRON_SECRET?.trim() ? `Bearer ${env.CRON_SECRET.trim()}` : undefined)) throw new UnauthorizedRequest("예약 수집 인증이 필요합니다.");
      } else authorizeWrite(request, env, options.development);
      return request.method === "GET" ? deps.runPerformanceCollection(env) : deps.startPerformanceCollection(env);
    }),
  };
  const backendStatus = routes["/api/backend/status"];
  routes["/api/backend/status"] = async (request, response) => { response.setHeader("Cache-Control", "no-store"); await backendStatus(request, response); };
  for (const path of ["/api/performance", "/api/performance/collect", "/api/briefing", "/api/briefing/narrative"]) {
    const handler = routes[path];
    routes[path] = async (request, response) => { response.setHeader("Cache-Control", "no-store"); await handler(request, response); };
  }
  const refreshKeyMatches = (request: ApiRequest) => tokenMatches(query(request, "key") ?? first(request.headers?.["x-refresh-key"]), env.SNAPSHOT_REFRESH_KEY);
  const localRefresh = (request: ApiRequest) => Boolean(options.development && !env.SNAPSHOT_REFRESH_KEY?.trim() && isLocalDevelopmentRequest(request));
  // Preserve the compact response and key transport, with fail-closed production auth.
  routes["/api/korean-market/refresh"] = async (request, response) => {
    if (request.method !== "POST" && request.method !== "GET") { writeJson(response, 405, { error: "Method not allowed" }); return; }
    const authorized = request.method === "GET"
      ? tokenMatches(first(request.headers?.authorization), env.CRON_SECRET?.trim() ? `Bearer ${env.CRON_SECRET.trim()}` : undefined)
      : refreshKeyMatches(request) || localRefresh(request);
    if (!authorized) { writeJson(response, 401, { error: "Unauthorized" }); return; }
    try {
      const data = await deps.refreshDashboardSnapshot(env);
      writeJson(response, 200, { generatedAt: data.generatedAt, stocks: data.stocks.length });
    } catch (error) { writeJson(response, 502, { error: error instanceof Error ? error.message : "Snapshot refresh failed." }); }
  };
  const limitWrite = createWriteLimiter();
  const limitRole = createWriteLimiter(Date.now, 30);
  routes["/api/*"] = async (_request, response) => { writeJson(response, 404, { error: "API not found" }); };
  for (const [path, handler] of Object.entries(routes)) {
    routes[path] = async (request, response) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET")) {
        // Authenticate before choosing a bucket: anonymous traffic cannot starve cron.
        let role: string | null = bearerRole(request, env);
        if (!role && path === "/api/korean-market/refresh" && refreshKeyMatches(request)) role = "refresh";
        if (!role && options.development) {
          if (path === "/api/korean-market/refresh" && localRefresh(request)) role = "local";
          else { try { role = authorizeWrite(request, env, true); } catch { /* Unauthenticated IP bucket. */ } }
        }
        const retry = role ? limitRole(role) : limitWrite(clientIp(request, env.TRUST_PROXY));
        if (retry) { response.setHeader("Retry-After", String(retry)); writeJson(response, 429, { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }); return; }
      }
      await handler(request, response);
    };
  }
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
  middlewareForRoutes(apiRoutes)(request, response, next);
}

export function middlewareForRoutes(routes: Record<string, RouteHandler>) {
  return (request: ApiRequest, response: ApiResponse, next: () => void): void => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const handler = routes[path] ?? (path.startsWith("/api/") ? routes["/api/*"] : undefined);
    const failed = () => {
      console.error("[api] Unhandled route failure.");
      if (!response.headersSent) writeJson(response, 500, { error: "Internal server error" });
      else response.end("");
    };
    if (handler) {
      try { void handler(request, response).catch(failed); } catch { failed(); }
    } else next();
  };
}
