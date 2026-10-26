import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefreshAhead, startRefreshAhead } from "../../server/refreshAhead";

const at = value => Date.parse(`${value}+09:00`);
const fixture = (now, extra = {}) => {
  const providers = { symbols: vi.fn(async () => ["005930", "000660"]), quote: vi.fn(async () => {}), chart: vi.fn(async () => {}), indices: vi.fn(async () => {}), now, ...extra };
  return { providers, worker: createRefreshAhead(providers) };
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("server refresh-ahead schedule", () => {
  it("retries failed after-close jobs after one minute and caps exponential backoff at ten minutes", async () => {
    let now = at("2026-10-23T16:00:00");
    const load = vi.fn().mockRejectedValue(new Error("offline")), { worker } = fixture(() => now, { quote: load });
    await worker.tick(); await worker.idle(); expect(load).toHaveBeenCalledTimes(2);
    for (const interval of [60_000, 120_000, 240_000, 480_000, 600_000, 600_000]) {
      now += interval - 1; await worker.tick(); await worker.idle(); const before = load.mock.calls.length;
      now++; await worker.tick(); await worker.idle(); expect(load).toHaveBeenCalledTimes(before + 2);
    }
    load.mockResolvedValue({ ok: true }); now += 600_000; await worker.tick(); await worker.idle(); const done = load.mock.calls.length;
    now += 600_000; await worker.tick(); await worker.idle(); expect(load).toHaveBeenCalledTimes(done);
  });
  it("treats a missing daily history as failure and recovers on the weekend without waiting until Monday", async () => {
    let now = at("2026-10-24T12:00:00"), history = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ rows: [] });
    const { worker } = fixture(() => now, { symbols: async () => ["005930"], history });
    await worker.tick(); await worker.idle(); expect(worker.stats().failed).toBe(1);
    now += 60_000; await worker.tick(); await worker.idle(); expect(history).toHaveBeenCalledTimes(2);
  });
  it("warms once, then quotes/indices every thirty seconds and charts every sixty", async () => {
    let now = at("2026-10-22T10:00:00");
    const { worker, providers: p } = fixture(() => now);
    await worker.tick(); await worker.idle();
    expect(p.quote).toHaveBeenCalledTimes(2); expect(p.chart).toHaveBeenCalledTimes(2); expect(p.indices).toHaveBeenCalledOnce();
    now += 29_999; await worker.tick(); await worker.idle(); expect(p.quote).toHaveBeenCalledTimes(2);
    now++; await worker.tick(); await worker.idle(); expect(p.quote).toHaveBeenCalledTimes(4); expect(p.indices).toHaveBeenCalledTimes(2); expect(p.chart).toHaveBeenCalledTimes(2);
    now += 30_000; await worker.tick(); await worker.idle(); expect(p.quote).toHaveBeenCalledTimes(6); expect(p.chart).toHaveBeenCalledTimes(4);
    worker.stop(); now += 60_000; await worker.tick(); expect(p.quote).toHaveBeenCalledTimes(6);
  });
  it("performs a closing refresh once and sleeps through a holiday/weekend until the next open", async () => {
    let now = at("2026-10-08T15:29:50"); const { worker, providers: p } = fixture(() => now);
    await worker.tick(); await worker.idle();
    now = at("2026-10-08T15:30:00"); await worker.tick(); await worker.idle(); expect(p.quote).toHaveBeenCalledTimes(4);
    for (const date of ["2026-10-08T17:00:00", "2026-10-09T10:00:00", "2026-10-11T10:00:00", "2026-10-12T08:59:59"]) {
      now = at(date); await worker.tick(); await worker.idle();
    }
    expect(p.quote).toHaveBeenCalledTimes(4); expect(p.chart).toHaveBeenCalledTimes(4);
    now = at("2026-10-12T09:00:00"); await worker.tick(); await worker.idle(); expect(p.quote).toHaveBeenCalledTimes(6);
  });
  it("deduplicates slow chart jobs while fresh quotes continue and follows changed TOP5", async () => {
    let now = at("2026-10-22T10:00:00"), resolve;
    const gate = new Promise(done => { resolve = done; });
    const { worker, providers: p } = fixture(() => now, { chart: vi.fn(() => gate) });
    await worker.tick(); await vi.waitFor(() => expect(worker.stats().pending).toBe(1));
    now += 60_000; await worker.tick(); await vi.waitFor(() => expect(p.quote).toHaveBeenCalledTimes(4));
    expect(p.chart).toHaveBeenCalledTimes(1); expect(p.quote).toHaveBeenCalledTimes(4);
    p.symbols.mockResolvedValue(["035420"]); now += 30_000; await worker.tick(); await Promise.resolve();
    expect(p.quote).toHaveBeenLastCalledWith("035420"); expect(p.chart).toHaveBeenLastCalledWith("005930");
    resolve(); await worker.idle();
    expect(p.chart.mock.calls.map(([code]) => code)).toEqual(["005930", "035420"]);
  });
  it("isolates failed jobs and disables timers in test environments or REFRESH_AHEAD=0", async () => {
    const { worker, providers: p } = fixture(() => at("2026-10-22T10:00:00"), { quote: vi.fn(async () => { throw new Error("fixture"); }) });
    await worker.tick(); await worker.idle();
    expect(worker.stats()).toMatchObject({ failed: 2, completed: 3, pending: 0 }); expect(p.indices).toHaveBeenCalledOnce();
    const interval = vi.spyOn(globalThis, "setInterval");
    for (const env of [{ REFRESH_AHEAD: "0" }, { NODE_ENV: "test" }, { VITEST: "true" }]) startRefreshAhead(env)();
    expect(interval).not.toHaveBeenCalled();
  });
  it("coalesces consecutive TOP5 updates, finishes in-flight work, and prioritizes the latest rank one", async () => {
    let release;
    const events = [], gate = new Promise(resolve => { release = resolve; });
    const { worker, providers: p } = fixture(() => at("2026-10-22T10:00:00"), {
      chart: vi.fn(async code => { events.push(`chart:${code}`); if (code === "005930") await gate; }),
      history: vi.fn(async code => { events.push(`history:${code}`); }),
    });
    await worker.tick(); await Promise.resolve();
    for (const codes of [["000660", "035720"], ["035420", "005930"]]) {
      worker.setTargets(codes); await worker.tick();
    }
    expect(events).toEqual(["chart:005930"]);
    release(); await worker.idle();
    expect(events).toEqual(["chart:005930", "chart:035420", "history:035420", "history:005930"]);
    const calls = p.chart.mock.calls.length;
    await worker.tick(); await worker.idle(); expect(p.chart).toHaveBeenCalledTimes(calls);
  });
  it("bounds pre-publication quote waits at six seconds, shares jobs, and caps timed-out work", async () => {
    vi.useFakeTimers();
    let release;
    const gate = new Promise(resolve => { release = resolve; }), urgentQuote = vi.fn(() => gate);
    const { worker } = fixture(Date.now, { urgentQuote });
    const codes = ["005930", "000660", "035420", "035720", "051910"];
    const first = worker.warmQuotes(codes), second = worker.warmQuotes(codes);
    await vi.advanceTimersByTimeAsync(5999); expect(urgentQuote).toHaveBeenCalledTimes(5);
    let done = false; void first.then(() => { done = true; });
    expect(done).toBe(false); await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]); expect(done).toBe(true);
    await worker.warmQuotes(["012345"]); expect(urgentQuote).toHaveBeenCalledTimes(5);
    release(); await vi.advanceTimersByTimeAsync(0);
    await worker.warmQuotes(["012345"]); expect(urgentQuote).toHaveBeenCalledTimes(6);
  });
  it("does not queue unbounded jobs across repeated completed results while KIS is stalled", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { worker, providers: p } = fixture(() => at("2026-10-22T10:00:00"), {
      quote: vi.fn(() => gate), chart: vi.fn(() => gate), session: vi.fn(() => gate),
    });
    for (let index = 0; index < 30; index++) {
      worker.setTargets(Array.from({ length: 5 }, (_, offset) => String(100000 + index * 5 + offset)), "2026-10-21");
      await worker.tick(); await Promise.resolve();
    }
    expect(p.quote).toHaveBeenCalledTimes(5); expect(p.chart).toHaveBeenCalledOnce(); expect(p.session).toHaveBeenCalledOnce();
    expect(worker.stats().pending).toBe(7);
    release(); await worker.idle();
    expect(p.chart.mock.calls.map(([code]) => code)).toEqual(["100000", "100145", "100146", "100147", "100148", "100149"]);
  });
  it("does not lose completed targets when the server-start symbol read is still pending", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { worker, providers: p } = fixture(() => at("2026-10-22T10:00:00"), { symbols: vi.fn(() => gate) });
    const boot = worker.tick();
    worker.setTargets(["035420"]); await worker.tick(); release(["005930"]);
    await boot; await worker.idle();
    expect(p.quote).toHaveBeenCalledExactlyOnceWith("035420"); expect(p.chart).toHaveBeenCalledExactlyOnceWith("035420");
  });
  it("does not expose provider errors and does not wait the budget after a quote failure", async () => {
    vi.useFakeTimers(); const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { worker } = fixture(Date.now, { urgentQuote: vi.fn(async () => { throw new Error("fixture private response"); }) });
    await worker.warmQuotes(["005930"]);
    expect(warn).toHaveBeenCalledWith("[refresh-ahead]", { reason: "quote_warmup_failed" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
