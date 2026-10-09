import { queryOptions } from "@tanstack/react-query";
import { adaptCandidate } from "../../entities/candidate";
import { adaptChart, adaptDashboard, adaptIndex, adaptQuote } from "../../entities/market";
import { aggregateSource } from "../../entities/source";
import { record, stockCode } from "../../entities/value";
import type { TimeRange } from "../../types/stockChart";
import type { BackendStatus, PipelineAvailability } from "../../types/backendStatus";
import { apiClient, type ApiClient } from "./client";
import type { PerformancePayload } from "../../types/performance";

export const queryKeys = {
  backendStatus: () => ["backend-status"] as const,
  dashboard: () => ["dashboard"] as const,
  indices: () => ["indices"] as const,
  candidates: (runId: string | null = null) => ["candidates", runId] as const,
  rank: (runId: string | null = null) => ["rank", runId] as const,
  stock: (code: string) => ["stock", requireCode(code)] as const,
  quote: (code: string) => ["quote", requireCode(code)] as const,
  chart: (code: string, range: TimeRange) => ["chart", requireCode(code), range] as const,
  analysisRun: () => ["analysis-run"] as const,
};
export function requireCode(code: string): string {
  const normalized = stockCode(code);
  if (!normalized) throw new Error("유효한 종목 코드가 필요합니다.");
  return normalized;
}

async function candidateList(client: ApiClient, path: string, final: boolean, signal: AbortSignal) {
  const response = await client.request(path, { signal, fallbackSource: "cache" });
  if (!Array.isArray(response.data)) throw new Error("후보 응답이 배열이 아닙니다.");
  // An authoritative [] replaces an earlier list. Never fill it from cache or samples.
  const rows = response.data.map(row => adaptCandidate(row, final));
  const source = aggregateSource([response.source, ...rows.map(row => row.source)]);
  return { data: rows.map(row => row.data), source, asOf: response.asOf ?? rows.map(row => row.asOf).filter((time): time is string => time !== null).sort()[0] ?? null };
}

export function createQueries(client: ApiClient = apiClient) {
  return {
    performance: (code?: string) => queryOptions({ queryKey: ["performance", code ?? "all"], staleTime: 30000, retry: false, queryFn: async ({ signal }) => {
      const response = await client.request(`/api/performance${code ? `?symbol=${requireCode(code)}` : ""}`, { signal, fallbackSource: "cache" });
      const root = record(response.data);
      if (root.version !== 1 || !Array.isArray(root.runs) || !Array.isArray(root.summaries) || !Array.isArray(root.reasons)) throw new Error("성과 기록 응답을 확인하지 못했습니다.");
      return root as unknown as PerformancePayload;
    }, refetchInterval: query => query.state.data?.collector.status === "running" ? 5000 : false }),
    backendStatus: () => queryOptions({ queryKey: queryKeys.backendStatus(), staleTime: 30000, retry: false, queryFn: async ({ signal }) => {
      const response = await client.request("/api/backend/status", { signal });
      return adaptBackendStatus(response.data);
    }, refetchInterval: query => query.state.data?.runtime.state === "running" ? 5000 : false }),
    dashboard: () => queryOptions({ queryKey: queryKeys.dashboard(), staleTime: 30000, queryFn: async ({ signal }) => {
      const response = await client.request("/api/korean-market/dashboard", { signal, timeoutMs: 75000 });
      return adaptDashboard(response.data, response);
    } }),
    indices: () => queryOptions({ queryKey: queryKeys.indices(), staleTime: 15000, queryFn: async ({ signal }) => {
      const response = await client.request("/api/korean-market/indices", { signal });
      if (!Array.isArray(response.data)) throw new Error("지수 응답이 배열이 아닙니다.");
      const data = response.data.map(index => adaptIndex(index, response));
      return { ...response, data, source: aggregateSource([response.source, ...data.map(index => index.source)]) };
    } }),
    candidates: (runId: string | null = null) => queryOptions({ queryKey: queryKeys.candidates(runId), queryFn: ({ signal }) => candidateList(client, "/api/candidates", true, signal) }),
    rank: (runId: string | null = null) => queryOptions({ queryKey: queryKeys.rank(runId), queryFn: ({ signal }) => candidateList(client, "/api/rank", false, signal) }),
    stock: (code: string) => {
      const normalized = requireCode(code);
      return queryOptions({ queryKey: queryKeys.stock(normalized), queryFn: async ({ signal }) => {
        const response = await client.request(`/api/stock-analysis?ticker=${normalized}`, { signal, fallbackSource: "cache" });
        if (response.data === null) return { ...response, data: null };
        const adapted = adaptCandidate(response.data);
        if (adapted.data.code !== normalized) throw new Error("분석 응답의 종목 코드가 요청과 다릅니다.");
        if (adapted.source === "sample" || response.source === "sample") throw new Error("종목 분석 응답이 실제 분석 대신 예시를 반환했습니다.");
        return { ...adapted, source: aggregateSource([adapted.source, response.source]), asOf: adapted.asOf ?? response.asOf };
      } });
    },
    quote: (code: string) => {
      const normalized = requireCode(code);
      return queryOptions({ queryKey: queryKeys.quote(normalized), queryFn: async ({ signal }) => {
        const response = await client.request(`/api/korean-market/quote?symbol=${normalized}`, { signal });
        if (response.data === null) return { ...response, data: null };
        const adapted = adaptQuote(response.data, normalized, response);
        return { ...adapted, source: aggregateSource([adapted.source, response.source]) };
      } });
    },
    chart: (code: string, range: TimeRange) => {
      const normalized = requireCode(code);
      return queryOptions({ queryKey: queryKeys.chart(normalized, range), queryFn: async ({ signal }) => {
        const response = await client.request(`/api/korean-market/stock-chart?symbol=${normalized}`, { signal, timeoutMs: 75000 });
        const adapted = adaptChart(response.data, normalized, range, response);
        return { ...adapted, source: aggregateSource([adapted.source, response.source]) };
      } });
    },
    analysisRun: () => queryOptions({ queryKey: queryKeys.analysisRun(), queryFn: async ({ signal }) => {
      const response = await client.request("/api/candidates/run", { signal });
      return { ...response, data: adaptAnalysisStatus(response.data) };
    }, refetchInterval: query => query.state.data?.data.status === "running" ? 5000 : false }),
  };
}

export type AnalysisStatus = { runId?: string; kind?: "official" | "adhoc"; mode?: "model_only" | "full"; status: "idle" | "running" | "completed" | "failed"; elapsedMs: number | null; progress: Record<string, unknown> | null; error: string | null; result: Record<string, unknown> | null };
export function adaptAnalysisStatus(value: unknown): AnalysisStatus {
  const object = record(value), status = object.status;
  if (status !== "idle" && status !== "running" && status !== "completed" && status !== "failed") throw new Error("분석 실행 상태가 올바르지 않습니다.");
  return { status, ...(typeof object.runId === "string" ? { runId: object.runId } : {}), ...(object.kind === "official" || object.kind === "adhoc" ? { kind: object.kind } : {}), ...(object.mode === "model_only" || object.mode === "full" ? { mode: object.mode } : {}), elapsedMs: typeof object.elapsedMs === "number" && Number.isFinite(object.elapsedMs) ? object.elapsedMs : null,
    progress: object.progress && typeof object.progress === "object" ? record(object.progress) : null,
    error: typeof object.error === "string" ? object.error : null,
    result: object.result && typeof object.result === "object" ? record(object.result) : null };
}
export const queries = createQueries();

/** Pick the public contract only; configuration is never a verified market quote. */
export function adaptBackendStatus(value: unknown): BackendStatus {
  const root = record(value), market = record(root.market), news = record(root.news), runtime = record(root.runtime), marker = record(root.marker), results = record(root.results);
  const enumValue = <T extends string>(value: unknown, choices: readonly T[]): T => {
    if (typeof value !== "string" || !choices.includes(value as T)) throw new Error("연결 상태 응답을 확인하지 못했습니다.");
    return value as T;
  };
  const date = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
  const configuration = (value: unknown) => enumValue(value, ["configured", "not_configured"] as const);
  const mode = (value: unknown) => enumValue(value, ["full", "model_only", "unknown"] as const);
  const availability = (value: unknown): PipelineAvailability => {
    const row = record(value), state = enumValue(row.state, ["available", "empty", "missing", "stale", "blocked", "invalid", "sample", "unknown", "not_produced"] as const);
    const count = typeof row.count === "number" && Number.isInteger(row.count) && row.count >= 0 ? row.count : null;
    if ((state === "empty" && count !== 0) || (state === "available" && (count === null || count <= 0)) || (!["available", "empty"].includes(state) && row.count !== null)) throw new Error("분석 결과 가용성을 확인하지 못했습니다.");
    return { state, count, source: enumValue(row.source, ["cache", "sample", "unknown"] as const), asOf: date(row.asOf) };
  };
  if (root.version !== 1 || root.source !== "unknown" || root.asOf !== null || !date(root.checkedAt) || market.verification !== "unverified" || news.verification !== "unverified") throw new Error("연결 상태 응답을 확인하지 못했습니다.");
  return { version: 1, analysisMode: mode(root.analysisMode), checkedAt: date(root.checkedAt)!, source: "unknown", asOf: null,
    market: { configuration: configuration(market.configuration), verification: "unverified" },
    news: { configuration: configuration(news.configuration), collectionConfiguration: configuration(news.collectionConfiguration), verification: "unverified" },
    runtime: { runId: typeof runtime.runId === "string" ? runtime.runId : null, kind: runtime.kind === "official" || runtime.kind === "adhoc" ? runtime.kind : null, state: enumValue(runtime.state, ["idle", "running", "completed", "failed", "unknown"] as const), startedAt: date(runtime.startedAt), finishedAt: date(runtime.finishedAt) },
    marker: { runId: typeof marker.runId === "string" ? marker.runId : null, kind: marker.kind === "official" || marker.kind === "adhoc" ? marker.kind : null, state: enumValue(marker.state, ["running", "completed", "failed", "unknown", "absent", "invalid"] as const), mode: mode(marker.mode), startedAt: date(marker.startedAt), finishedAt: date(marker.finishedAt), source: enumValue(marker.source, ["cache", "unknown"] as const), asOf: date(marker.asOf) },
    results: { candidates: availability(results.candidates), rank: availability(results.rank) } };
}
