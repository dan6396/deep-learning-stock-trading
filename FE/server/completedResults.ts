import { pipelineOutputDir, type PipelineRunMarker } from "./pipelineFreshness";
import { showBriefingSupply } from "./supplyVisibility";
import type { PipelineOutputRow } from "../src/types/trading";
import type { BriefingPayload } from "./briefing";

/** Isolate output roots and visibility policies; never retain credentials in keys. */
export function completedResultsKey(env: Record<string, string | undefined>): string {
  return JSON.stringify([pipelineOutputDir(env), showBriefingSupply(env)]);
}

export type PreviousRun = { reason: "running" | "failed" };

export function sameCompletedRun(left: PipelineRunMarker | null, right: PipelineRunMarker | null): boolean {
  return Boolean(left && right && left.status === "completed" && right.status === "completed"
    && left.startedAt === right.startedAt && left.finishedAt === right.finishedAt && left.runId === right.runId
    && left.kind === right.kind && left.mode === right.mode);
}

type CompletedResult = { marker: PipelineRunMarker; rank: PipelineOutputRow[]; briefing: BriefingPayload };
export function createCompletedResultsStore() {
  const snapshots = new Map<string, CompletedResult>();
  return {
    get(env: Record<string, string | undefined>): CompletedResult | undefined {
      const value = snapshots.get(completedResultsKey(env));
      return value ? structuredClone(value) : undefined;
    },
    publish(value: CompletedResult, env: Record<string, string | undefined>): boolean {
      if (value.marker.status !== "completed" || value.marker.mode !== "model_only" || !value.rank.length
        || value.briefing.status !== "ready" || value.briefing.model?.runStartedAt !== new Date(value.marker.startedAt).toISOString()) return false;
      // The builder validates the whole ranking and assembles briefing from these exact rows.
      snapshots.set(completedResultsKey(env), structuredClone(value));
      return true;
    },
  };
}
export const completedResults = createCompletedResultsStore();

type ResultRunState = { status: "running" | "completed" | "failed"; startedAt: number; runId: string };
const resultRuns = new Map<string, ResultRunState>();
export function setResultRunState(env: Record<string, string | undefined>, state: ResultRunState): void {
  resultRuns.set(pipelineOutputDir(env), state);
}
export function failResultRun(runId: string): void {
  for (const [key, state] of resultRuns) if (state.runId === runId) resultRuns.set(key, { ...state, status: "failed" });
}
export function previousRunReason(marker: PipelineRunMarker | null, env: Record<string, string | undefined>): PreviousRun | undefined {
  const active = resultRuns.get(pipelineOutputDir(env));
  if (active && (active.status === "running" || active.status === "failed") && (!marker || active.startedAt >= marker.startedAt)) {
    return { reason: active.status };
  }
  return marker?.status === "running" || marker?.status === "failed" ? { reason: marker.status } : undefined;
}
