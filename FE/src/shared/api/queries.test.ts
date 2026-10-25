import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { createApiClient } from "./client";
import { createQueries, queryKeys, requestBriefingNarrative } from "./queries";
import { analysisMutationOptions, invalidateAnalysisResults } from "./analysis";
import { deferred, jsonResponse, pipelineRow } from "../../test/dataFixtures";
import { chartBundle } from "../../test/fixtures/reportFixtures";
import { adaptDashboard, adaptIndex, adaptQuote } from "../../entities/market";

const clients: QueryClient[] = [];
function client() { const c = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(c); return c; }
afterEach(() => clients.splice(0).forEach(c => c.clear()));

describe("query contracts and race boundaries", () => {
  it("hydrates every supplied chart range from one bundle and uses thirty-minute retention", async () => {
    const request = vi.fn().mockResolvedValue({ data: chartBundle(), source: "cache", asOf: "2026-10-22T07:00:00Z" });
    const queries = createQueries({ request }), cache = client();
    await cache.fetchQuery(queries.chart("005930", "1D"));
    const daily = await cache.fetchQuery(queries.chart("005930", "1M"));
    expect(daily.data.range).toBe("1M"); expect(request).toHaveBeenCalledOnce();
    expect(queries.chart("005930", "1M").staleTime).toBe(600_000);
    expect(queries.quote("005930").staleTime).toBe(20_000); expect(queries.quote("005930").gcTime).toBe(1_800_000);
  });
  it("keeps a same-code quote visible during refetch and after failure, but never carries it to another code", async () => {
    const pending = deferred<Response>(), cache = client();
    const request = vi.fn().mockResolvedValueOnce(jsonResponse({ code: "005930", currentPrice: 100, source: "live" })).mockImplementation(() => pending.promise);
    const queries = createQueries(createApiClient("", request));
    await cache.fetchQuery(queries.quote("005930"));
    const observer = new QueryObserver(cache, queries.quote("005930")); const unsubscribe = observer.subscribe(() => {});
    const refreshed = observer.refetch();
    expect(observer.getCurrentResult()).toMatchObject({ isFetching: true, data: { data: { code: "005930", currentPrice: 100 } } });
    pending.reject(new Error("fixture network failure")); await refreshed;
    expect(observer.getCurrentResult()).toMatchObject({ isError: true, data: { data: { currentPrice: 100 } } });
    observer.setOptions({ ...queries.quote("000660"), enabled: false }); expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
  });
  it("passes the explicit 75-second chart timeout instead of the general 15-second default", async () => {
    const request = vi.fn().mockResolvedValue({ data: chartBundle(), source: "cache", asOf: null });
    await client().fetchQuery(createQueries({ request }).chart("005930", "1M"));
    expect(request).toHaveBeenCalledWith("/api/korean-market/stock-chart?symbol=005930", expect.objectContaining({ timeoutMs: 75_000 }));
  });
  it("allows a 26.2-second cold chart within the existing 75-second chart budget", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(async () => { await new Promise(resolve => setTimeout(resolve, 26_200)); return jsonResponse(chartBundle()); });
      const options = createQueries(createApiClient("", fetcher)).chart("005930", "1M"), cache = client();
      const pending = cache.fetchQuery(options);
      await vi.advanceTimersByTimeAsync(15_001); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(11_199); expect((await pending).data.code).toBe("005930");
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("replaces a previous candidate list with an authoritative empty API result", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse([pipelineRow()])).mockResolvedValueOnce(jsonResponse([]));
    const queries = createQueries(createApiClient("", fetcher)), cache = client();
    expect((await cache.fetchQuery(queries.candidates())).data).toHaveLength(1);
    expect((await cache.fetchQuery(queries.candidates())).data).toEqual([]);
    expect(cache.getQueryData(queryKeys.candidates())).toMatchObject({ data: [], source: "cache" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps run, normalized stock, quote and chart range keys independent", () => {
    expect(queryKeys.stock("5930")).toEqual(["stock", "005930"]);
    expect(queryKeys.chart("005930", "1D")).not.toEqual(queryKeys.chart("005930", "1M"));
    expect(queryKeys.candidates("run-a")).not.toEqual(queryKeys.candidates("run-b"));
    expect(() => queryKeys.stock("x")).toThrow();
  });
  it("rejects a different code and fallback samples even for a matching code", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(pipelineRow()));
    const queries = createQueries(createApiClient("", fetcher)), cache = client();
    await expect(cache.fetchQuery(queries.stock("000660"))).rejects.toThrow("코드");
    fetcher.mockResolvedValue(jsonResponse(pipelineRow({}, { source: "sample" })));
    await expect(cache.fetchQuery(queries.stock("005930"))).rejects.toThrow("예시");
    fetcher.mockResolvedValue(jsonResponse(null));
    expect((await cache.fetchQuery(queries.stock("005930"))).data).toBeNull();
  });
  it("clears previous stock on observer switch and isolates out-of-order responses", async () => {
    const a = deferred<Response>(), b = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(url => String(url).includes("005930") ? a.promise : b.promise);
    const queries = createQueries(createApiClient("", fetcher)), cache = client();
    const observer = new QueryObserver(cache, queries.stock("005930"));
    const unsubscribe = observer.subscribe(() => {});
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    observer.setOptions(queries.stock("000660"));
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const rowB = pipelineRow({ ticker: "000660" }); rowB.result.ticker = "000660";
    b.resolve(jsonResponse(rowB));
    await waitFor(() => expect(observer.getCurrentResult().data?.data?.code).toBe("000660"));
    a.resolve(jsonResponse(pipelineRow()));
    await Promise.resolve();
    expect(observer.getCurrentResult().data?.data?.code).toBe("000660");
    expect(cache.getQueryData(queryKeys.stock("005930"))).toBeUndefined();
    unsubscribe();
  });
  it("does not promote cached/sample indices or interpolated series", () => {
    const index = { symbol: "KOSPI", value: "", change: 0, miniSeries: [1, "", 3], source: "sample", miniSeriesSource: "interpolated" };
    expect(adaptIndex(index, { source: "live" })).toMatchObject({ source: "sample", data: { value: null, change: 0, miniSeries: [], miniSeriesSource: "interpolated" } });
    expect(adaptIndex({ ...index, value: 100 }).data.miniSeries).toEqual([1, null, 3]);
    expect(adaptIndex({ symbol: "KOSPI", miniSeries: [1, 2] }).data.miniSeriesSource).toBe("unknown");
  });
  it("preserves upstream nulls even when legacy quote/index fields contain generated zero", () => {
    expect(adaptQuote({ code: "005930", currentPrice: 0, change: 0, rawValues: { currentPrice: null, change: 0 } }).data).toMatchObject({ currentPrice: null, change: 0 });
    expect(adaptIndex({ symbol: "KOSPI", value: 0, rawValues: { value: null }, miniSeriesSource: "interpolated", miniSeries: [0, 0] }).data).toMatchObject({ value: null, miniSeries: [] });
  });
  it("aggregates sample/unknown children while retaining individual index provenance", () => {
    const result = adaptDashboard({ source: "cache", stocks: [], indices: [{ symbol: "KOSPI", source: "sample" }, { symbol: "KOSPI200", source: "live", miniSeriesSource: "history" }] });
    expect(result.source).toBe("sample");
    expect(result.data.indices[1]).toMatchObject({ source: "live", data: { miniSeriesSource: "history" } });
  });
  it("never exposes a cached previous stock after switching the active code", () => {
    const cache = client(), queries = createQueries(createApiClient("", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(null))));
    cache.setQueryData(queryKeys.stock("005930"), { data: { code: "005930" }, source: "cache", asOf: null });
    const observer = new QueryObserver(cache, { ...queries.stock("005930"), enabled: false });
    expect(observer.getCurrentResult().data?.data?.code).toBe("005930");
    observer.setOptions({ ...queries.stock("000660"), enabled: false });
    expect(observer.getCurrentResult().data).toBeUndefined();
  });
  it("uses quote/code and range validation without zero coercion", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ code: "005930", currentPrice: "", change: 0, source: "cache" }));
    const queries = createQueries(createApiClient("", fetcher)), cache = client();
    expect(await cache.fetchQuery(queries.quote("005930"))).toMatchObject({ source: "cache", data: { currentPrice: null, change: 0 } });
    await expect(cache.fetchQuery(queries.quote("000660"))).rejects.toThrow("코드");
    fetcher.mockImplementation(async () => jsonResponse({ chartData: { code: "005930", ranges: { "1D": { prices: [{ date: "2026-10-07", price: "" }], candles: [] } } }, source: "cache" }));
    expect((await cache.fetchQuery(queries.chart("005930", "1D"))).data.prices[0].price).toBeNull();
    await expect(cache.fetchQuery(queries.chart("000660", "1D"))).rejects.toThrow("코드");
  });
  it("only polls running jobs", () => {
    const options = createQueries().analysisRun();
    const interval = options.refetchInterval;
    if (typeof interval !== "function") throw new Error("missing interval callback");
    for (const status of ["idle", "completed", "failed"]) expect(interval({ state: { data: { data: { status } } } } as never)).toBe(false);
    expect(interval({ state: { data: { data: { status: "running" } } } } as never)).toBe(5000);
  });
  it("ignores an older launch result when a newer mutation has already attached", async () => {
    const a = deferred<Response>(), b = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const cache = client(), options = analysisMutationOptions(cache, createApiClient("", fetcher));
    const first = options.mutationFn();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const second = options.mutationFn();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    b.resolve(jsonResponse({ status: "running", progress: { updatedAt: 2 } }));
    await second;
    a.resolve(jsonResponse({ status: "completed", progress: { updatedAt: 1 } }));
    await first;
    expect(cache.getQueryData(queryKeys.analysisRun())).toMatchObject({ data: { status: "running", progress: { updatedAt: 2 } } });
  });
  it("cancels a pre-completion read before invalidating every candidate/run key", async () => {
    const pending = deferred<Response>(), fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const queries = createQueries(createApiClient("", fetcher)), cache = client();
    cache.setQueryData(queryKeys.candidates("run-a"), { data: [], source: "cache", asOf: null });
    cache.setQueryData(queryKeys.rank("run-a"), { data: [] });
    cache.setQueryData(queryKeys.stock("005930"), { data: null });
    const read = cache.fetchQuery(queries.candidates("run-b")).catch(() => null);
    await invalidateAnalysisResults(cache);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    pending.resolve(jsonResponse([pipelineRow()]));
    await read;
    expect(cache.getQueryData(queryKeys.candidates("run-b"))).toBeUndefined();
    for (const key of [queryKeys.candidates("run-a"), queryKeys.rank("run-a"), queryKeys.stock("005930")]) expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
  });
  it("requests briefing narrative with 60-second timeout and POST method", async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        data: {
          version: 1,
          status: "ready",
          model: { modelId: "test", scoreKind: "rank_zscore", baseDate: "2026-10-23", predictionTarget: null, poolSize: 50, runStartedAt: null },
          macro: null,
          stocks: [],
          narrative: null,
          composition: null,
          disclaimer: "",
          data_meta: { source: "live", asOf: null },
        },
      }),
    };
    const result = await requestBriefingNarrative(mockClient as never);
    expect(mockClient.request).toHaveBeenCalledWith("/api/briefing/narrative", {
      method: "POST",
      timeoutMs: 60000,
    });
    expect(result.status).toBe("ready");
  });
  it("propagates timeout error when requesting briefing narrative times out", async () => {
    const timeoutErr = new Error("timeout of 60000ms exceeded");
    const mockClient = {
      request: vi.fn().mockRejectedValue(timeoutErr),
    };
    await expect(requestBriefingNarrative(mockClient as never)).rejects.toThrow(
      "timeout of 60000ms exceeded"
    );
    expect(mockClient.request).toHaveBeenCalledWith("/api/briefing/narrative", {
      method: "POST",
      timeoutMs: 60000,
    });
  });
});
