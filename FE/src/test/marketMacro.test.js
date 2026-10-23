import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarketMacro, usSession } from "../../server/marketMacro";

const timestamp = Date.parse("2026-10-22T20:00:00Z") / 1000;
function payload(value = 100, time = timestamp) {
  return { chart: { result: [{ meta: { regularMarketPrice: value, chartPreviousClose: 80, regularMarketTime: time,
    currentTradingPeriod: { regular: { start: timestamp - 23400, end: timestamp } } } }] } };
}
const reply = (body) => ({ ok: true, json: async () => body });
afterEach(() => vi.useRealTimers());
describe("market macro", () => {
  it("lets GET use Yahoo immediately after a bounded night wait and reflects background completion on its next read", async () => {
    vi.useFakeTimers(); let release;
    const transport = vi.fn(async () => reply(payload())), night = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const get = createMarketMacro({ transport, night, reference: async () => null });
    const pending = get({}, { backgroundKis: true }); await vi.advanceTimersByTimeAsync(1500);
    const cold = await pending; expect(cold.indicators[0].status).toBe("ok"); expect(cold.indicators[6].status).toBe("unavailable");
    release({ id: "KOSPI200_NIGHT", name: "코스피200 야간선물", value: 848, change: 0, changePct: 0, unit: "pt", asOf: "2026-10-22T20:00:00Z", source: "kis", status: "ok" });
    await vi.advanceTimersByTimeAsync(0);
    const warm = await get({}, { backgroundKis: true }); expect(warm.indicators[6].value).toBe(848);
    expect(night).toHaveBeenCalledOnce(); expect(transport).toHaveBeenCalledTimes(6);
  });
  it("fetches all six symbols, percent units and real observation times; isolates cache copies", async () => {
    let now = timestamp * 1000 + 1000;
    const transport = vi.fn(async (url) => reply(payload(String(url).includes("%5ETNX") ? 4.2 : 100)));
    const get = createMarketMacro({ transport, now: () => now });
    const first = await get({});
    expect(first.indicators).toHaveLength(7); expect(transport).toHaveBeenCalledTimes(6);
    expect(first.indicators[6]).toMatchObject({ id: "KOSPI200_NIGHT", source: "kis", status: "unavailable" });
    expect(first.indicators[0]).toMatchObject({ status: "ok", value: 100, change: 20, changePct: 25, asOf: "2026-10-22T20:00:00.000Z" });
    expect(first.indicators[2].session).toBe("closed");
    expect(first.indicators[5]).toMatchObject({ unit: "%", value: 4.2 });
    first.indicators[0].value = 999;
    expect((await get({})).indicators[0].value).toBe(100); expect(transport).toHaveBeenCalledTimes(6);
    now += 600_001; await get({}); expect(transport).toHaveBeenCalledTimes(12);
  });
  it("keeps valid indicators when another fails or carries malformed metadata", async () => {
    const transport = vi.fn(async (url) => {
      if (String(url).includes("KS11")) throw new Error("network");
      if (String(url).includes("KQ11")) return reply(payload(Number.NaN));
      if (String(url).includes("GSPC")) return reply({ chart: { result: [{ meta: { regularMarketPrice: 100 } }] } });
      return reply(payload());
    });
    const result = await createMarketMacro({ transport })({});
    expect(result.indicators.map(row => row.status)).toEqual(["unavailable", "unavailable", "ok", "unavailable", "ok", "ok", "unavailable"]);
  });
  it("uses previousClose when chartPreviousClose is absent and honors TTL override", async () => {
    let now = timestamp * 1000;
    const body = payload(); const meta = body.chart.result[0].meta;
    const transport = vi.fn(async () => reply({ chart: { result: [{ meta: { ...meta, chartPreviousClose: undefined, previousClose: 50 } }] } }));
    const get = createMarketMacro({ transport, now: () => now });
    expect((await get({ BRIEFING_MACRO_CACHE_TTL_MS: "100" })).indicators[0].changePct).toBe(100);
    now += 101; await get({}); expect(transport).toHaveBeenCalledTimes(12);
  });
  it("times out stalled bodies within eight seconds and coalesces concurrent loads", async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async (_url, _options) => ({ ok: true, json: () => new Promise(() => {}) }));
    const get = createMarketMacro({ transport });
    const first = get({}), second = get({});
    await vi.advanceTimersByTimeAsync(8000);
    expect((await first).indicators.every(row => row.status === "unavailable")).toBe(true);
    expect(await second).toEqual(await first); expect(transport).toHaveBeenCalledTimes(6);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("exposes intraday US values and recognizes an early regular-session close", async () => {
    const transport = vi.fn(async () => reply(payload(100, timestamp - 3600)));
    const open = await createMarketMacro({ transport, now: () => (timestamp - 3500) * 1000 })({});
    expect(open.indicators[2]).toMatchObject({ session: "open", asOf: "2026-10-22T19:00:00.000Z" });
    const early = payload(100, timestamp - 10800);
    early.chart.result[0].meta.currentTradingPeriod.regular.end = timestamp - 10800;
    const closed = await createMarketMacro({ transport: vi.fn(async () => reply(early)), now: () => timestamp * 1000 })({});
    expect(closed.indicators[2].session).toBe("closed");
  });
  it.each([
    ["summer open", "2026-07-15T14:00:00Z", "2026-07-15T13:30:00Z", "2026-07-15T20:00:00Z", "2026-07-15T14:01:00Z", "open"],
    ["winter open", "2026-01-15T15:00:00Z", "2026-01-15T14:30:00Z", "2026-01-15T21:00:00Z", "2026-01-15T15:01:00Z", "open"],
    ["early close sparse tick", "2026-11-27T17:00:00Z", "2026-11-27T14:30:00Z", "2026-11-27T18:00:00Z", "2026-11-27T19:00:00Z", "closed"],
    ["weekend rollover", "2026-10-23T19:57:00Z", "2026-10-26T13:30:00Z", "2026-10-26T20:00:00Z", "2026-10-24T15:00:00Z", "closed"],
    ["next day after early close", "2026-11-27T18:00:00Z", "2026-11-30T14:30:00Z", "2026-11-30T21:00:00Z", "2026-11-30T13:00:00Z", "closed"],
    ["pre market", "2026-10-22T13:15:00Z", "2026-10-22T13:30:00Z", "2026-10-22T20:00:00Z", "2026-10-22T13:15:00Z", null],
  ])("US session: %s", (_label, observed, start, end, now, expected) => {
    const meta = { currentTradingPeriod: { regular: { start: Date.parse(start) / 1000, end: Date.parse(end) / 1000 } } };
    expect(usSession(meta, Date.parse(observed) / 1000, Date.parse(now))).toBe(expected);
  });
  it("does not call 09:00-09:29 ET open when regular metadata is absent", () => {
    const now = Date.parse("2026-10-22T13:15:00Z"); expect(usSession({}, now / 1000, now)).toBeNull();
  });
  it("isolates night timeout and loads the static reference", async () => {
    vi.useFakeTimers();
    const get = createMarketMacro({ transport: vi.fn(async () => reply(payload())), night: () => new Promise(() => {}), reference: async () => ({ title: "fixture" }) });
    const pending = get({}); await vi.advanceTimersByTimeAsync(8000);
    const result = await pending; expect(result.indicators[6].status).toBe("unavailable"); expect(result.reference.title).toBe("fixture");
  });
});
