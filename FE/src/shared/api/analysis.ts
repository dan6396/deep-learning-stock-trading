import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiClient, type ApiClient } from "./client";
import { adaptAnalysisStatus, createQueries, queryKeys } from "./queries";
import type { RunKind } from "../../types/performance";

const launchVersions = new WeakMap<QueryClient, number>();
export type AnalysisMode = "model_only" | "full";
const resultPrefixes = [["candidates"], ["rank"], ["stock"], ["dashboard"], ["backend-status"], ["performance"]] as const;

export async function invalidateAnalysisResults(client: QueryClient): Promise<void> {
  // Cancel pre-completion reads before invalidation so a slow prior snapshot cannot win.
  await Promise.all(resultPrefixes.map(queryKey => client.cancelQueries({ queryKey })));
  await Promise.all(resultPrefixes.map(queryKey => client.invalidateQueries({ queryKey })));
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
          if (result.data.status === "completed") await invalidateAnalysisResults(client);
        }
      }
      return result;
    },
  };
}

/** M2 can mount this observer; it polls only running jobs and handles reattachment. */
export function useAnalysisRun(transport: ApiClient = apiClient) {
  const client = useQueryClient();
  const query = useQuery(createQueries(transport).analysisRun());
  const seenCompletion = useRef<string | null>(null);
  const status = query.data?.data;
  useEffect(() => {
    if (status?.status === "running") seenCompletion.current = null;
    if (status?.status !== "completed") return;
    const identity = JSON.stringify([status.elapsedMs, status.progress?.updatedAt, status.result]);
    if (seenCompletion.current === identity) return;
    seenCompletion.current = identity;
    void invalidateAnalysisResults(client);
  }, [client, status]);
  return query;
}

/** Prepared for authorized controls; does not launch a job until mutate is called. */
export function useStartAnalysis(transport: ApiClient = apiClient) {
  return useMutation(analysisMutationOptions(useQueryClient(), transport));
}
