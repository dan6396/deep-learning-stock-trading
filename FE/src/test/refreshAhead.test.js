import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefreshAhead, startRefreshAhead } from "../../server/refreshAhead";

const at = value => Date.parse(`${value}+09:00`);
const fixture = (now, extra = {}) => {
  const providers = { symbols: vi.fn(async () => ["005930", "000660"]), quote: vi.fn(async () => {}), chart: vi.fn(async () => {}), indices: vi.fn(async () => {}), now, ...extra };
  return { providers, worker: createRefreshAhead(providers) };
};
afterEach(() => vi.restoreAllMocks());
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
    await worker.tick(); await vi.waitFor(() => expect(worker.stats().pending).toBe(2));
    now += 60_000; await worker.tick(); await vi.waitFor(() => expect(p.quote).toHaveBeenCalledTimes(4));
    expect(p.chart).toHaveBeenCalledTimes(2); expect(p.quote).toHaveBeenCalledTimes(4);
    p.symbols.mockResolvedValue(["035420"]); now += 30_000; await worker.tick(); await Promise.resolve();
    expect(p.quote).toHaveBeenLastCalledWith("035420"); expect(p.chart).toHaveBeenLastCalledWith("035420");
    resolve(); await worker.idle();
  });
  it("isolates failed jobs and disables timers in test environments or REFRESH_AHEAD=0", async () => {
    const { worker, providers: p } = fixture(() => at("2026-10-22T10:00:00"), { quote: vi.fn(async () => { throw new Error("fixture"); }) });
    await worker.tick(); await worker.idle();
    expect(worker.stats()).toMatchObject({ failed: 2, completed: 3, pending: 0 }); expect(p.indices).toHaveBeenCalledOnce();
    const interval = vi.spyOn(globalThis, "setInterval");
    for (const env of [{ REFRESH_AHEAD: "0" }, { NODE_ENV: "test" }, { VITEST: "true" }]) startRefreshAhead(env)();
    expect(interval).not.toHaveBeenCalled();
  });
});
