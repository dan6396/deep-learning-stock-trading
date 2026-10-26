import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiClient, type ApiClient } from "./client";
import { adaptAnalysisStatus, createQueries, queryKeys, type AnalysisStatus } from "./queries";
import type { RunKind } from "../../types/performance";
import type { BriefingPayload } from "../../entities/briefing";
import type { CandidateData } from "../../entities/candidate";
import type { DataResult } from "../../entities/source";
import type { BackendStatus } from "../../types/backendStatus";

const launchVersions = new WeakMap<QueryClient, number>();
export type AnalysisMode = "model_only" | "full";
const resultPrefixes = [["candidates"], ["rank"], ["stock"], ["dashboard"], ["backend-status"], ["performance"], ["briefing"]] as const;

export function isAnalysisRunning(client: QueryClient): boolean {
  return client.getQueryData<{ data: { status: string } }>(queryKeys.analysisRun())?.data.status === "running"
    || client.getQueryData<{ runtime: { state: string } }>(queryKeys.backendStatus())?.runtime.state === "running";
}

export async function invalidateAnalysisResults(client: QueryClient): Promise<void> {
  await refreshResultQueries(client, resultPrefixes);
}
async function refreshResultQueries(client: QueryClient, prefixes: readonly (readonly string[])[]): Promise<void> {
  // Cancel pre-completion reads before invalidation so a slow prior snapshot cannot win.
  await Promise.all(prefixes.map(queryKey => client.cancelQueries({ queryKey })));
  await Promise.all(prefixes.map(queryKey => client.invalidateQueries({ queryKey })));
}

function isTerminal(status?: AnalysisStatus): status is AnalysisStatus {
  return status?.status === "completed" || status?.status === "failed";
}
const pendingResultRefreshes = new WeakMap<QueryClient, Promise<void>>();
const resultStateKeys = ["briefing", "rank", "backend-status"];

/** Compare the displayed snapshot to the terminal run, without an observation history. */
function staleResultPrefixes(client: QueryClient): string[] {
  const status = client.getQueryData<DataResult<AnalysisStatus>>(queryKeys.analysisRun())?.data;
  if (!isTerminal(status)) return [];
  const backend = client.getQueryData<BackendStatus>(queryKeys.backendStatus());
  const briefing = client.getQueryData<BriefingPayload>(queryKeys.briefing());
  // Inactive invalidated queries will fetch on their next mount; do not schedule twice.
  const ranks = client.getQueriesData<DataResult<CandidateData[]>>({ queryKey: ["rank"] })
    .filter(([key, value]) => value !== undefined && Array.isArray(value.data) && !client.getQueryState(key)?.isInvalidated).map(([, value]) => value!);
  const reason = (value: { previousRun?: { reason: string } }) => value.previousRun?.reason;
  const needed: string[] = [], running = backend?.runtime.state === "running";
  if (running && !client.getQueryState(queryKeys.backendStatus())?.isInvalidated) needed.push("backend-status");
  if (briefing && !client.getQueryState(queryKeys.briefing())?.isInvalidated) {
    const matches = status.startedAt !== undefined && Date.parse(briefing.model?.runStartedAt ?? "") === status.startedAt;
    const stale = status.status === "failed" ? briefing.status === "ready" && reason(briefing) !== "failed"
      : Boolean(briefing.previousRun) || ((status.startedAt !== undefined || running) && !matches);
    if (stale) needed.push("briefing");
  }
  if (ranks.some(rank => {
    if (status.status === "failed") return rank.data.some(row => reason(row) !== "failed");
    const olderOrUnknown = status.startedAt !== undefined && (rank.asOf === null || Date.parse(rank.asOf) < status.startedAt);
    return rank.data.some(row => row.previousRun) || olderOrUnknown || (running && status.startedAt === undefined);
  })) needed.push("rank");
  return needed;
}
export function analysisResultsNeedRefresh(client: QueryClient): boolean { return staleResultPrefixes(client).length > 0; }
function resultsFetching(client: QueryClient): boolean {
  return client.getQueryCache().findAll().some(query => resultStateKeys.includes(String(query.queryKey[0])) && query.state.fetchStatus !== "idle");
}

/** At most one in-flight pass; settled work leaves no per-run records behind. */
export function reconcileAnalysisResults(client: QueryClient): Promise<void> {
  const pending = pendingResultRefreshes.get(client);
  if (pending) return pending;
  if (!analysisResultsNeedRefresh(client)) return Promise.resolve();
  // Let existing reads settle, then compare their response in the success listener.
  if (resultsFetching(client)) return Promise.resolve();
  // Defer execution until the shared promise is installed, before cache notifications.
  const refresh = Promise.resolve().then(() => {
    const stale = staleResultPrefixes(client);
    if (!resultsFetching(client) && stale.length) return refreshResultQueries(client,
      resultPrefixes.filter(([key]) => !resultStateKeys.includes(key) || stale.includes(key)));
  }).finally(() => pendingResultRefreshes.delete(client));
  pendingResultRefreshes.set(client, refresh);
  return refresh;
}

export function analysisMutationOptions(client: QueryClient, transport: ApiClient = apiClient) {
  return {
    mutationKey: ["start-analysis"] as const,
    mutationFn: async (selection?: AnalysisMode | { mode: AnalysisMode; kind: RunKind }) => {
      const mode = typeof selection === "string" ? selection : selection?.mode;
      const kind = typeof selection === "object" ? selection.kind : undefined;
      const version = (launchVersions.get(client) ?? 0) + 1;
      launchVersions.set(client, version);
      await client.cancelQueries({ queryKey: queryKeys.analysisRun() });
      const response = await transport.request(`/api/candidates/run${mode ? `?mode=${mode}${kind ? `&kind=${kind}` : ""}` : ""}`, { method: "POST", timeoutMs: 15000 });
      const result = { ...response, data: adaptAnalysisStatus(response.data) };
      if (launchVersions.get(client) === version) {
        // Also cancel a status read started while the mutation was in flight.
        await client.cancelQueries({ queryKey: queryKeys.analysisRun() });
        if (launchVersions.get(client) === version) {
          client.setQueryData(queryKeys.analysisRun(), result);
          if (result.data.status === "running") {
            // A pre-launch idle snapshot must not keep runtime polling asleep.
            await client.cancelQueries({ queryKey: queryKeys.backendStatus() });
            await Promise.all([client.invalidateQueries({ queryKey: queryKeys.backendStatus() }), client.invalidateQueries({ queryKey: queryKeys.briefing() })]);
          }
          await reconcileAnalysisResults(client);
        }
      }
      return result;
    },
  };
}

/** Reconcile current cache state on mount and whenever relevant responses arrive. */
export function useAnalysisRun(transport: ApiClient = apiClient) {
  const client = useQueryClient();
  const query = useQuery(createQueries(transport).analysisRun());
  useEffect(() => {
    const reconcile = () => { void reconcileAnalysisResults(client); };
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "success"
        && [queryKeys.analysisRun()[0], ...resultStateKeys].includes(String(event.query.queryKey[0]))) reconcile();
    });
    reconcile();
    return unsubscribe;
  }, [client]);
  return query;
}

/** Prepared for authorized controls; does not launch a job until mutate is called. */
export function useStartAnalysis(transport: ApiClient = apiClient) {
  return useMutation(analysisMutationOptions(useQueryClient(), transport));
}
