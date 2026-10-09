export type BackendConfiguration = "configured" | "not_configured";
export type BackendRunState = "idle" | "running" | "completed" | "failed" | "unknown";
export type BackendMarkerState = Exclude<BackendRunState, "idle"> | "absent" | "invalid";
export type PipelineAvailabilityState = "available" | "empty" | "missing" | "stale" | "blocked" | "invalid" | "sample" | "unknown" | "not_produced";
export type PipelineAvailability = {
  state: PipelineAvailabilityState;
  count: number | null;
  source: "cache" | "sample" | "unknown";
  asOf: string | null;
};
export type BackendStatus = {
  version: 1;
  analysisMode: "full" | "model_only" | "unknown";
  checkedAt: string;
  source: "unknown";
  asOf: null;
  market: { configuration: BackendConfiguration; verification: "unverified" };
  news: { configuration: BackendConfiguration; collectionConfiguration: BackendConfiguration; verification: "unverified" };
  runtime: { runId?: string | null; kind?: "official" | "adhoc" | null; state: BackendRunState; startedAt: string | null; finishedAt: string | null };
  marker: { runId?: string | null; kind?: "official" | "adhoc" | null; state: BackendMarkerState; mode: "full" | "model_only" | "unknown"; startedAt: string | null; finishedAt: string | null; source: "cache" | "unknown"; asOf: string | null };
  results: { candidates: PipelineAvailability; rank: PipelineAvailability };
};
