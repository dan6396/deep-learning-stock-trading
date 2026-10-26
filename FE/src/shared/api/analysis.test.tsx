import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { analysisMutationOptions, analysisResultsNeedRefresh, reconcileAnalysisResults, useAnalysisRun } from "./analysis";
import { createApiClient, type ApiClient } from "./client";
import { adaptAnalysisStatus, adaptBackendStatus, queryKeys } from "./queries";
import { adaptBriefing } from "../../entities/briefing";
import { adaptCandidate } from "../../entities/candidate";
import { backendStatusBody, deferred, jsonResponse, pipelineRow } from "../../test/dataFixtures";

const clients: QueryClient[] = [], stops: (() => void)[] = [];
afterEach(() => { cleanup(); stops.splice(0).forEach(stop => stop()); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });
const start = Date.parse("2026-10-26T04:00:00Z");
const run = (status: string, runId = "run-1", startedAt = start) => ({ status, runId, startedAt, finishedAt: startedAt + 38000, elapsedMs: 38000 });
const payload = (value: Record<string, unknown>) => ({ data: adaptAnalysisStatus(value), source: "live" as const, asOf: null });
function briefingFor(status: ReturnType<typeof run>) {
  const prior = status.status !== "completed", startedAt = prior ? status.startedAt - 60000 : status.startedAt;
  return adaptBriefing({ version: 1, status: "ready", stocks: [],
    ...(status.status === "running" || status.status === "failed" ? { previousRun: { reason: status.status } } : {}),
    model: { modelId: "fixture", baseDate: "2026-10-23", poolSize: 199, runStartedAt: new Date(startedAt).toISOString() } });
}
function rankFor(status: ReturnType<typeof run>) {
  const row = adaptCandidate(pipelineRow({}, status.status === "running" || status.status === "failed" ? { previousRun: { reason: status.status } } : {}));
  return { data: [row.data], source: "cache" as const, asOf: new Date(status.status === "completed" ? status.startedAt + 1000 : status.startedAt - 60000).toISOString() };
}
function backendFor(status: ReturnType<typeof run>) {
  return adaptBackendStatus(backendStatusBody(undefined, { runtime: { state: status.status, runId: status.runId } }));
}
function Probe({ transport, name }: { transport: ApiClient; name: string }) {
  const analysis = useAnalysisRun(transport);
  return <output data-testid={name}>{analysis.data?.data.status ?? "pending"}</output>;
}
function setup(initial = run("running"), cached = true, staleResults = false) {
  let response = initial, briefingRead: (() => Promise<ReturnType<typeof briefingFor>>) | undefined;
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } } }); clients.push(client);
  if (cached) client.setQueryData(queryKeys.analysisRun(), payload(initial));
  const seed = staleResults ? run("running", initial.runId, initial.startedAt) : initial;
  client.setQueryData(queryKeys.briefing(), briefingFor(seed));
  client.setQueryData(queryKeys.rank(), rankFor(seed));
  client.setQueryData(queryKeys.backendStatus(), backendFor(seed));
  const briefingFetch = vi.fn(async () => briefingRead ? briefingRead() : briefingFor(response));
  const rankFetch = vi.fn(async () => rankFor(response));
  stops.push(new QueryObserver(client, { queryKey: queryKeys.briefing(), queryFn: briefingFetch }).subscribe(() => {}));
  stops.push(new QueryObserver(client, { queryKey: queryKeys.rank(), queryFn: rankFetch }).subscribe(() => {}));
  stops.push(new QueryObserver(client, { queryKey: queryKeys.backendStatus(), queryFn: async () => backendFor(response) }).subscribe(() => {}));
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(response)), transport = createApiClient("", fetcher);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const tree = (count: number, generation: number) => <QueryClientProvider client={client}>{Array.from({ length: count }, (_, index) =>
    <Probe key={`${generation}-${index}`} name={`observer-${index}`} transport={transport} />)}</QueryClientProvider>;
  const view = render(tree(4, 0));
  return {
    client, transport, fetcher, briefingFetch, rankFetch,
    remount: (count = 4, generation = 0) => view.rerender(tree(count, generation)),
    async observe(value: typeof initial) {
      response = value;
      await act(async () => { await client.refetchQueries({ queryKey: queryKeys.analysisRun() }); await reconcileAnalysisResults(client); });
    },
    respond: (value: typeof initial) => { response = value; },
    holdBriefing: (read: () => Promise<ReturnType<typeof briefingFor>>) => { briefingRead = read; },
    invalidationsFor: (resource: string) => invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === resource).length,
    expectRefreshes(count: number) {
      for (const resource of ["rank", "briefing"]) expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === resource)).toHaveLength(count);
      expect(rankFetch).toHaveBeenCalledTimes(count); expect(briefingFetch).toHaveBeenCalledTimes(count);
    },
  };
}

describe("analysis result reconciliation", () => {
  it.each(["completed", "failed"])("refreshes stale running results when the first status GET is %s", async status => {
    const test = setup(run(status), false, true);
    await waitFor(() => test.expectRefreshes(1));
    expect(analysisResultsNeedRefresh(test.client)).toBe(false);
    expect(test.client.getQueryData(queryKeys.briefing())).toMatchObject(status === "failed" ? { previousRun: { reason: "failed" } } : { model: { runStartedAt: new Date(start).toISOString() } });
  });
  it("refreshes when only backend runtime still says running on the first terminal GET", async () => {
    const test = setup(run("completed"), false, true);
    act(() => {
      test.client.setQueryData(queryKeys.briefing(), briefingFor(run("idle")));
      test.client.setQueryData(queryKeys.rank(), rankFor(run("idle")));
    });
    await waitFor(() => test.expectRefreshes(1));
  });
  it.each(["completed", "failed"])("clears a briefing-only running flag on the first %s GET even with matching timestamps", async status => {
    const terminal = run(status), test = setup(terminal, false);
    act(() => test.client.setQueryData(queryKeys.briefing(), { ...briefingFor(terminal), previousRun: { reason: "running" } }));
    await waitFor(() => expect(test.briefingFetch).toHaveBeenCalledTimes(1));
    expect(test.rankFetch).not.toHaveBeenCalled();
    expect(analysisResultsNeedRefresh(test.client)).toBe(false);
  });
  it.each(["completed", "failed"])("clears a rank-only running flag on the first %s GET", async status => {
    const terminal = run(status), test = setup(terminal, false);
    act(() => test.client.setQueryData(queryKeys.rank(), { ...rankFor(terminal), data: rankFor(run("running")).data }));
    await waitFor(() => expect(test.rankFetch).toHaveBeenCalledTimes(1));
    expect(test.briefingFetch).not.toHaveBeenCalled();
    expect(analysisResultsNeedRefresh(test.client)).toBe(false);
  });
  it.each(["completed", "failed"])("reconciles %s on remount after all observers missed the terminal response", async status => {
    const test = setup(); test.remount(0);
    const completed = run(status); test.respond(completed);
    act(() => test.client.setQueryData(queryKeys.analysisRun(), payload(completed)));
    expect(analysisResultsNeedRefresh(test.client)).toBe(true);
    test.remount(4, 1);
    await waitFor(() => test.expectRefreshes(1));
    expect(analysisResultsNeedRefresh(test.client)).toBe(false);
  });
  it.each(["completed", "failed"])("converges to one refresh with four observers when a run becomes %s", async status => {
    const test = setup();
    await test.observe(run(status));
    test.expectRefreshes(1);
    expect(await screen.findAllByText(status)).toHaveLength(4);
    await test.observe({ ...run(status), elapsedMs: 39000 });
    test.remount(5); test.remount(0); test.remount(4, 2);
    await test.observe(run(status));
    test.expectRefreshes(1);
  });
  it.each([true, false])("does not refresh an already reflected historical completion (cached=%s)", async cached => {
    const test = setup(run("completed"), cached);
    await waitFor(() => expect(screen.getAllByText("completed")).toHaveLength(4));
    await test.observe(run("completed")); test.remount(0); test.remount();
    test.expectRefreshes(0);
  });
  it.each([true, false])("shares the same state comparison for an immediate completed POST (observers=%s)", async mounted => {
    const test = setup(run("idle")); if (!mounted) test.remount(0);
    test.respond(run("completed", "posted-run"));
    await act(async () => { await analysisMutationOptions(test.client, test.transport).mutationFn(); });
    test.expectRefreshes(1);
    test.remount(5); await test.observe(run("completed", "posted-run"));
    test.expectRefreshes(1);
  });
  it("refreshes again for the next execution with a different start time", async () => {
    const test = setup(); await test.observe(run("completed")); test.expectRefreshes(1);
    await test.observe(run("running", "run-2", start + 60000));
    await test.observe(run("completed", "run-2", start + 60000));
    test.expectRefreshes(2);
  });
  it("refreshes a rank with no snapshot timestamp when terminal execution time is known", async () => {
    const test = setup(run("completed"), false);
    act(() => test.client.setQueryData(queryKeys.rank(), { ...rankFor(run("completed")), asOf: null }));
    await waitFor(() => expect(test.rankFetch).toHaveBeenCalledTimes(1));
    expect(test.briefingFetch).not.toHaveBeenCalled();
    expect(analysisResultsNeedRefresh(test.client)).toBe(false);
  });
  it("leaves inactive invalidated results scheduled for their next mount without repeated invalidation", async () => {
    const test = setup(); stops.splice(0).forEach(stop => stop());
    await test.observe(run("completed"));
    test.remount(5); await test.observe(run("completed"));
    expect(test.invalidationsFor("rank")).toBe(1); expect(test.invalidationsFor("briefing")).toBe(1);
    expect(test.rankFetch).not.toHaveBeenCalled(); expect(test.briefingFetch).not.toHaveBeenCalled();
    expect(test.client.getQueryState(queryKeys.rank())?.isInvalidated).toBe(true);
    const rank = new QueryObserver(test.client, { queryKey: queryKeys.rank(), queryFn: async () => rankFor(run("completed")) });
    stops.push(rank.subscribe(() => {}));
    await waitFor(() => expect(rank.getCurrentResult().data?.data[0]?.previousRun).toBeUndefined());
    expect(test.client.getQueryState(queryKeys.rank())?.isInvalidated).toBe(false);
  });
  it("waits for an existing result fetch and refreshes only the other stale result", async () => {
    const test = setup(), pending = deferred<ReturnType<typeof briefingFor>>();
    test.holdBriefing(() => pending.promise);
    const read = test.client.refetchQueries({ queryKey: queryKeys.briefing() });
    await test.observe(run("completed")); test.remount(5);
    expect(test.rankFetch).not.toHaveBeenCalled(); expect(test.briefingFetch).toHaveBeenCalledTimes(1);
    pending.resolve(briefingFor(run("completed")));
    await act(async () => { await read; await reconcileAnalysisResults(test.client); });
    expect(test.briefingFetch).toHaveBeenCalledTimes(1); expect(test.rankFetch).toHaveBeenCalledTimes(1);
    expect(analysisResultsNeedRefresh(test.client)).toBe(false);
  });
  it("rechecks a stale response from a fetch that began before completion", async () => {
    const test = setup(), pending = deferred<ReturnType<typeof briefingFor>>();
    test.holdBriefing(() => pending.promise);
    const read = test.client.refetchQueries({ queryKey: queryKeys.briefing() });
    await test.observe(run("completed"));
    test.holdBriefing(async () => briefingFor(run("completed")));
    pending.resolve(briefingFor(run("running")));
    await act(async () => { await read; await reconcileAnalysisResults(test.client); });
    expect(test.briefingFetch).toHaveBeenCalledTimes(2); expect(test.rankFetch).toHaveBeenCalledTimes(1);
    expect(analysisResultsNeedRefresh(test.client)).toBe(false);
  });
  it("keeps only one live refresh and releases it after every execution without growing cache records", async () => {
    const test = setup(), cacheSize = test.client.getQueryCache().getAll().length;
    for (let index = 0; index < 30; index++) {
      const completed = run("completed", `run-${index}`, start + index * 60000); test.respond(completed);
      let pending!: Promise<void>;
      await act(async () => {
        test.client.setQueryData(queryKeys.analysisRun(), payload(completed));
        pending = reconcileAnalysisResults(test.client);
        expect(reconcileAnalysisResults(test.client)).toBe(pending);
        await pending;
      });
      expect(reconcileAnalysisResults(test.client)).not.toBe(pending);
      expect(test.client.isFetching()).toBe(0);
      expect(test.client.getQueryCache().getAll()).toHaveLength(cacheSize);
      expect(analysisResultsNeedRefresh(test.client)).toBe(false);
    }
    test.expectRefreshes(30);
  });
});
