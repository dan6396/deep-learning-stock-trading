export function pipelineRow(input: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
  return {
    input_row: { ticker: "005930", company_name: "테스트 종목", prediction_target: "next_session_open_to_close",
      ensemble_pred_return: 0.01, pred_rank: 5, pred_pool_size: 200, ...input },
    result: { ticker: "005930", company_name: "테스트 종목", key_data_points: [] as string[], summary: "fixture" },
    news: [] as Record<string, unknown>[], data_meta: { source: "cache", asOf: "2026-10-07T09:00:00Z", ...meta },
  };
}

export function jsonResponse(data: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json", ...headers } });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Public /api/backend/status contract body; `candidates` controls only the final-candidate availability. */
export function backendStatusBody(candidates: { state: string; count?: number | null } = { state: "empty", count: 0 }, overrides: { marker?: Record<string, unknown>; runtime?: Record<string, unknown> } = {}) {
  const availability = (state: string, count: number | null) => ({ state, count, source: "cache", asOf: null });
  return {
    version: 1, analysisMode: candidates.state === "not_produced" ? "model_only" : "full", checkedAt: "2026-10-09T09:00:00.000Z", source: "unknown", asOf: null,
    market: { configuration: "configured", verification: "unverified" },
    news: { configuration: "not_configured", collectionConfiguration: "not_configured", verification: "unverified" },
    runtime: { state: "idle", startedAt: null, finishedAt: null, ...overrides.runtime },
    marker: { state: "completed", mode: candidates.state === "not_produced" ? "model_only" : "full", startedAt: null, finishedAt: null, source: "cache", asOf: null, ...overrides.marker },
    results: { candidates: availability(candidates.state, candidates.count ?? null), rank: availability("available", 199) },
  };
}
