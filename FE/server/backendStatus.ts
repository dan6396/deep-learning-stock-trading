import { stat } from "node:fs/promises";
import { pipelineRunMarkerPath, readPipelineRunMarker } from "./pipelineFreshness";
import { inspectPipelineResultAvailability } from "./pipelineResults";
import { getCandidateAnalysisSnapshot } from "./pipelineRunner";
import type { BackendStatus, PipelineAvailability } from "../src/types/backendStatus";

declare const process: { env: Record<string, string | undefined> };
function time(value: unknown): string | null {
  return typeof value === "number" && value > 0 && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
}
function present(value: string | undefined) { return typeof value === "string" && value.trim().length > 0; }
async function diskMarker(env: Record<string, string | undefined>): Promise<BackendStatus["marker"]> {
  const empty = { mode: "unknown" as const, startedAt: null, finishedAt: null, source: "unknown" as const, asOf: null };
  try {
    const file = await stat(pipelineRunMarkerPath(env));
    if (!file.isFile()) return { ...empty, state: "invalid" };
    const marker = await readPipelineRunMarker(env), asOf = time(file.mtimeMs);
    if (!marker || !time(marker.startedAt) || (marker.finishedAt !== undefined && (!time(marker.finishedAt) || marker.finishedAt < marker.startedAt))) {
      return { ...empty, state: "invalid", source: "cache", asOf };
    }
    return { runId: typeof marker.runId === "string" ? marker.runId : null, kind: marker.kind === "official" || marker.kind === "adhoc" ? marker.kind : null,
      state: marker.status, mode: marker.mode === "model_only" ? "model_only" : marker.mode === undefined || marker.mode === "full" ? "full" : "unknown", startedAt: time(marker.startedAt), finishedAt: time(marker.finishedAt), source: "cache", asOf };
  } catch (error) { return { ...empty, state: (error as { code?: string }).code === "ENOENT" ? "absent" : "unknown" }; }
}
const defaults = { runtime: getCandidateAnalysisSnapshot, availability: inspectPipelineResultAvailability };

/** Local configuration presence and disk evidence only. No provider calls or writes. */
export async function getBackendStatus(env = process.env, deps = defaults): Promise<BackendStatus> {
  const real = env.KIS_ENV === "real";
  const key = real ? env.KIS_REAL_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY : env.KIS_MOCK_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY;
  const secret = real ? env.KIS_REAL_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET : env.KIS_MOCK_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET;
  const unknown: PipelineAvailability = { state: "unknown", count: null, source: "unknown", asOf: null };
  const marker = await diskMarker(env);
  let results: BackendStatus["results"] = { candidates: unknown, rank: unknown };
  try { results = await deps.availability(); } catch { /* Never return raw errors or filesystem paths. */ }
  let runtime: BackendStatus["runtime"] = { state: "unknown", startedAt: null, finishedAt: null };
  try { const snapshot = deps.runtime(); runtime = { runId: snapshot.runId ?? null, kind: snapshot.kind ?? null, state: snapshot.status, startedAt: time(snapshot.startedAt), finishedAt: time(snapshot.finishedAt) }; } catch { /* Read-only status unavailable. */ }
  return { version: 1, analysisMode: env.PIPELINE_ANALYSIS_MODE === "model_only" ? "model_only" : !env.PIPELINE_ANALYSIS_MODE || env.PIPELINE_ANALYSIS_MODE === "full" ? "full" : "unknown", checkedAt: new Date().toISOString(), source: "unknown", asOf: null,
    market: { configuration: present(key) && present(secret) ? "configured" : "not_configured", verification: "unverified" },
    news: { configuration: present(env.GEMINI_API_KEY) ? "configured" : "not_configured",
      collectionConfiguration: present(env.NAVER_CLIENT_ID) && present(env.NAVER_CLIENT_SECRET) ? "configured" : "not_configured", verification: "unverified" },
    runtime, marker, results };
}
