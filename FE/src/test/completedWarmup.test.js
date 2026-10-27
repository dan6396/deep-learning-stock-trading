import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/kisDashboard", () => ({
  buildKisStockQuote: vi.fn(async () => ({})), buildKisStockChart: vi.fn(async () => ({})),
  getDailyHistory: vi.fn(async () => ({})), buildKisIndices: vi.fn(async () => ({})), fetchKisTargetSession: vi.fn(async () => "2026-10-26"),
}));
vi.mock("../../server/pipelineResults", () => ({ getRankPayload: vi.fn(async () => []) }));
import { buildKisStockQuote, buildKisStockChart, getDailyHistory, fetchKisTargetSession } from "../../server/kisDashboard";
import { getRankPayload } from "../../server/pipelineResults";
import { warmCompletedQuotes, refreshCompletedTopFive, startRefreshAhead } from "../../server/refreshAhead";

const rows = codes => codes.map((ticker, index) => ({ result: { ticker }, input_row: { pred_rank: index + 1, prediction_base_date: "2026-10-23" } }));
const idle = () => globalThis.__top5RefreshWorker.idle();
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T10:00:00+09:00")); });
afterEach(() => {
  globalThis.__top5RefreshAhead?.(); globalThis.__top5RefreshWorker?.stop();
  delete globalThis.__top5RefreshWorker; delete globalThis.__top5RefreshAhead;
  vi.useRealTimers();
});

describe("completed TOP5 warmup through existing KIS providers (mock KIS)", () => {
  it("continues warming other targets when one chart repair remains deferred and backs off that job", async () => {
    const rank = rows(["005930", "000660"]);
    buildKisStockChart.mockResolvedValueOnce({ chartData: { ranges: { "1D": { intraday: { needsRefresh: true } } } } });
    refreshCompletedTopFive(rank, {}); await idle();
    expect(buildKisStockChart.mock.calls.map(([code]) => code)).toEqual(["005930", "000660"]);
    expect(getDailyHistory.mock.calls.map(([code]) => code)).toEqual(["005930", "000660"]);
    expect(globalThis.__top5RefreshWorker.stats().failed).toBe(1);
    refreshCompletedTopFive(rank, {}); await idle();
    expect(buildKisStockChart).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 59_999);
    refreshCompletedTopFive(rank, {}); await idle();
    expect(buildKisStockChart).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 1);
    refreshCompletedTopFive(rank, {}); await idle();
    expect(buildKisStockChart).toHaveBeenCalledTimes(4);
  });
  it("includes a stalled recovery rank read in the quote budget and ignores late resolution", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const warm = warmCompletedQuotes(() => gate, {});
    await vi.advanceTimersByTimeAsync(6000);
    expect(await warm).toEqual([]); expect(buildKisStockQuote).not.toHaveBeenCalled();
    release(rows(["005930"])); await vi.advanceTimersByTimeAsync(0);
    expect(buildKisStockQuote).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("starts the rank-one full chart first, fills observation history and target session on the background lane", async () => {
    const rank = rows(["035420", "000660", "005930", "035720", "051910"]);
    await warmCompletedQuotes(rank, {});
    expect(buildKisStockQuote.mock.calls.map(([code]) => code)).toEqual(rank.map(row => row.result.ticker));
    expect(buildKisStockQuote.mock.calls.every(([, env, wait]) => env.KIS_REQUEST_PRIORITY === "user" && wait)).toBe(true);
    expect(buildKisStockChart).not.toHaveBeenCalled();
    refreshCompletedTopFive([...rank].reverse(), {}); await idle();
    expect(buildKisStockChart.mock.calls.map(([code]) => code)).toEqual(rank.map(row => row.result.ticker));
    expect(getDailyHistory.mock.calls.map(([code]) => code)).toEqual(rank.map(row => row.result.ticker));
    expect(buildKisStockChart.mock.calls.every(([, env, wait]) => env.KIS_REQUEST_PRIORITY === "background" && wait)).toBe(true);
    expect(getDailyHistory.mock.calls.every(([, opts, env]) => opts.allowNetwork && env.KIS_REQUEST_PRIORITY === "background")).toBe(true);
    expect(fetchKisTargetSession).toHaveBeenCalledExactlyOnceWith("2026-10-23", expect.objectContaining({ KIS_REQUEST_PRIORITY: "background" }));
    refreshCompletedTopFive(rank, {}); await idle();
    expect(buildKisStockChart).toHaveBeenCalledTimes(5); expect(getDailyHistory).toHaveBeenCalledTimes(5);
    expect(fetchKisTargetSession).toHaveBeenCalledOnce();
  });
  it("keeps bounded quote preparation with REFRESH_AHEAD=0 and skips all post-publication jobs", async () => {
    const rank = rows(["035420", "000660"]), env = { REFRESH_AHEAD: "0" };
    await warmCompletedQuotes(rank, env); refreshCompletedTopFive(rank, env); await idle();
    expect(buildKisStockQuote).toHaveBeenCalledTimes(2);
    expect(buildKisStockChart).not.toHaveBeenCalled(); expect(getDailyHistory).not.toHaveBeenCalled(); expect(fetchKisTargetSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("updates the worker started at server boot so future ticks use the completed TOP5", async () => {
    getRankPayload.mockResolvedValueOnce(rows(["005930"]));
    const stop = startRefreshAhead({}); await vi.advanceTimersByTimeAsync(0); await idle();
    refreshCompletedTopFive(rows(["035420"]), {}); await idle();
    buildKisStockQuote.mockClear();
    await vi.advanceTimersByTimeAsync(30_000); await idle();
    expect(buildKisStockQuote.mock.calls.map(([code]) => code)).toEqual(["035420"]);
    expect(getRankPayload).toHaveBeenCalledOnce(); stop();
  });
});
