import { afterEach, describe, expect, it, vi } from "vitest";
import { createSectorProvider, fetchKisNightFutures, nearestKospi200Future, nightSession, parseNightFutures, parseNightFuturesCandles } from "../../server/kisBriefing";
const env = { KIS_ENV: "real", KIS_APP_KEY: "fixture-key", KIS_APP_SECRET: "fixture-secret" };
const now = Date.parse("2026-10-22T20:00:00+09:00");
function body() { return { rt_cd: "0", output1: { futs_prpr: "401.25", futs_prdy_clpr: "400.00", futs_prdy_vrss: "1.25", futs_prdy_ctrt: "0.31",
  stck_bsop_date: "20261022", stck_cntg_hour: "190001" } }; }
afterEach(() => vi.restoreAllMocks());
describe("KIS briefing night futures", () => {
  it.each([
    ["20261026", "010000", "2026-10-27T01:16:00+09:00", "2026-10-26T16:00:00.000Z"],
    ["20261023", "010000", "2026-10-24T01:16:00+09:00", "2026-10-23T16:00:00.000Z"],
    ["20261023", "010000", "2026-10-23T01:16:00+09:00", "2026-10-22T16:00:00.000Z"],
  ])("normalizes session-start dates with ordinary after-midnight clocks: %s/%s", (date, time, clock, expected) => {
    const value = body(); Object.assign(value.output1, { stck_bsop_date: date, stck_cntg_hour: time });
    expect(parseNightFutures(value, Date.parse(clock)).asOf).toBe(expected);
  });
  it("still rejects weekend and future ordinary clocks after date correction", () => {
    for (const [date, clock] of [["20261025", "2026-10-26T01:16:00+09:00"], ["20261026", "2026-10-26T20:00:00+09:00"]]) {
      const value = body(); Object.assign(value.output1, { stck_bsop_date: date, stck_cntg_hour: "010000" });
      expect(() => parseNightFutures(value, Date.parse(clock))).toThrow("not_a_verified_night_observation");
    }
  });
  it.each([
    ["2026-03-11T20:00:00+09:00", "A01603"], ["2026-03-12T20:00:00+09:00", "A01606"],
    ["2026-06-11T20:00:00+09:00", "A01609"], ["2026-10-22T20:00:00+09:00", "A01612"],
    ["2026-12-10T20:00:00+09:00", "A01703"],
  ])("calculates the quarterly second-Thursday roll: %s", (date, expected) => { expect(nearestKospi200Future(Date.parse(date))).toBe(expected); });
  it.each([
    ["2026-10-22T18:00:00+09:00", "open"], ["2026-10-23T05:59:59+09:00", "open"], ["2026-10-23T06:00:00+09:00", "closed"],
    ["2026-10-24T03:00:00+09:00", "open"], ["2026-10-24T18:00:00+09:00", "closed"], ["2026-10-26T03:00:00+09:00", "closed"],
  ])("labels the night window including Friday rollover: %s", (date, expected) => { expect(nightSession(Date.parse(date))).toBe(expected); });
  it("requires a verified night observation and uses only the documented price fields", () => {
    expect(parseNightFutures(body(), now)).toMatchObject({ id: "KOSPI200_NIGHT", value: 401.25, change: 1.25, changePct: 0.31,
      source: "kis", unit: "pt", status: "ok", session: "open", asOf: "2026-10-22T10:00:01.000Z" });
    for (const edit of [value => { delete value.output1.stck_cntg_hour; }, value => { value.output1.stck_cntg_hour = "150000"; },
      value => { value.output1.stck_bsop_date = "20261024"; }, value => { value.output1.stck_cntg_hour = "250000"; },
      value => { value.output1.futs_prpr = ""; }, value => { value.output1.futs_prdy_ctrt = "99"; }]) {
      const value = body(); edit(value); expect(() => parseNightFutures(value, now)).toThrow();
    }
  });
  it("uses the CM endpoint, supports explicit overrides and isolates configuration/errors", async () => {
    const provider = vi.fn(async () => body()), warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await fetchKisNightFutures(env, now, provider)).status).toBe("ok");
    expect(provider).toHaveBeenLastCalledWith("/uapi/domestic-futureoption/v1/quotations/inquire-price", "FHMIF10000000", { FID_COND_MRKT_DIV_CODE: "CM", FID_INPUT_ISCD: "A01612" }, env);
    const custom = { ...env, KIS_NIGHT_FUTURES_CODE: "A01703", KIS_NIGHT_FUTURES_MARKET_CODE: "F" };
    await fetchKisNightFutures(custom, now, provider); expect(provider.mock.calls[1][2]).toMatchObject({ FID_INPUT_ISCD: "A01703", FID_COND_MRKT_DIV_CODE: "F" });
    provider.mockRejectedValueOnce(new Error(`provider echoed ${env.KIS_APP_SECRET}`)).mockRejectedValueOnce(new Error("minute failed"));
    expect((await fetchKisNightFutures(env, now, provider)).status).toBe("unavailable");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(env.KIS_APP_SECRET);
    expect((await fetchKisNightFutures({}, now, provider)).status).toBe("unavailable"); expect(provider).toHaveBeenCalledTimes(4);
  });
  it("falls back to the last verified night minute close, never a day bar, and allows missing changes", async () => {
    const untimed = body(); delete untimed.output1.stck_cntg_hour;
    const candles = { rt_cd: "0", output1: {}, output2: [
      { stck_bsop_date: "20261022", stck_cntg_hour: "150000", futs_prpr: "999" },
      { stck_bsop_date: "20261022", stck_cntg_hour: "183000", futs_prpr: "400.5" },
      { stck_bsop_date: "20261022", stck_cntg_hour: "193000", futs_prpr: "402" },
    ] };
    const provider = vi.fn().mockResolvedValueOnce(untimed).mockResolvedValueOnce(candles);
    const result = await fetchKisNightFutures(env, now, provider);
    expect(result).toMatchObject({ status: "ok", value: 402, change: 2, changePct: 0.5, asOf: "2026-10-22T10:30:00.000Z" });
    expect(provider.mock.calls[1].slice(0, 2)).toEqual(["/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice", "FHKIF03020200"]);
    expect(parseNightFuturesCandles(candles, null, now)).toMatchObject({ value: 402, change: null, changePct: null });
    expect(() => parseNightFuturesCandles({ ...candles, output2: [candles.output2[0]] }, null, now)).toThrow();
  });
  it.each([
    ["2026-10-22T23:59:59+09:00", "20261022", "235959"],
    ["2026-10-23T01:19:50+09:00", "20261022", "251950"],
    ["2026-10-23T06:01:00+09:00", "20261022", "300000"],
    ["2026-10-25T12:00:00+09:00", "20261023", "300000"],
  ])("queries the night-session start date and extended clock: %s", async (date, sessionDate, clock) => {
    const untimed = body(); delete untimed.output1.stck_cntg_hour;
    const provider = vi.fn().mockResolvedValueOnce(untimed).mockResolvedValueOnce({ rt_cd: "0", output2: [] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await fetchKisNightFutures(env, Date.parse(date), provider);
    expect(provider.mock.calls[1][2]).toMatchObject({ FID_INPUT_DATE_1: sessionDate, FID_INPUT_HOUR_1: clock });
  });
  it("normalizes descending extended-clock bars across midnight before selecting the latest", () => {
    const candles = { rt_cd: "0", output2: [
      { stck_bsop_date: "20261022", stck_cntg_hour: "251900", futs_prpr: "402" },
      { stck_bsop_date: "20261022", stck_cntg_hour: "250000", futs_prpr: "401" },
      { stck_bsop_date: "20261022", stck_cntg_hour: "235900", futs_prpr: "400" },
    ] };
    const clock = Date.parse("2026-10-23T01:20:00+09:00");
    for (const bars of [candles.output2, [...candles.output2].reverse()]) {
      expect(parseNightFuturesCandles({ ...candles, output2: bars }, null, clock)).toMatchObject({ value: 402, asOf: "2026-10-22T16:19:00.000Z", session: "open" });
    }
  });
  it("accepts exactly the 30:00 close and rejects excess, invalid dates, weekend, future and stale observations", () => {
    const clock = Date.parse("2026-10-23T06:01:00+09:00");
    const closing = body(); closing.output1.stck_cntg_hour = "300000";
    expect(parseNightFutures(closing, clock)).toMatchObject({ asOf: "2026-10-22T21:00:00.000Z", session: "closed" });
    for (const time of ["300001", "300100", "305900", "310000"]) {
      expect(() => parseNightFutures({ ...closing, output1: { ...closing.output1, stck_cntg_hour: time } }, clock)).toThrow();
    }
    for (const date of ["20261024", "20261023", "20261016", "20260931"]) {
      expect(() => parseNightFutures({ ...closing, output1: { ...closing.output1, stck_bsop_date: date } }, clock)).toThrow();
    }
  });
});
describe("KIS sector facts", () => {
  it("bounds the whole GET batch but continues collecting the remaining stocks in the background", async () => {
    vi.useFakeTimers(); let release;
    const gate = new Promise(resolve => { release = resolve; });
    const provider = vi.fn(async (_path, _tr, params) => { if (params.PDNO === "005930") await gate;
      return { rt_cd: "0", output: { pdno: params.PDNO, idx_bztp_mcls_cd_name: "전기전자" } }; });
    const get = createSectorProvider(provider, () => now);
    const pending = get(["005930", "000660", "042660"], env, { backgroundKis: true });
    await vi.advanceTimersByTimeAsync(1500); expect((await pending).sectors).toBeNull(); expect(provider).toHaveBeenCalledOnce();
    release(); await vi.advanceTimersByTimeAsync(0); expect(provider).toHaveBeenCalledTimes(3);
    expect((await get(["005930", "000660", "042660"], env, { backgroundKis: true })).sectors[0].codes).toHaveLength(3);
  });
  it("shares concurrent stock lookups and retries a rejected request without waiting a day", async () => {
    let release;
    const provider = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const get = createSectorProvider(provider, () => now);
    const pending = Array.from({ length: 8 }, () => get(["005930"], env));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    release({ rt_cd: "0", output: { pdno: "005930", idx_bztp_mcls_cd_name: "전기전자" } });
    const results = await Promise.all(pending); expect(results.every(result => result.sectors[0].name === "전기전자")).toBe(true);
    const failed = vi.fn().mockRejectedValueOnce(new Error("temporary fixture failure")).mockResolvedValueOnce({ rt_cd: "1", msg_cd: "fixture-failure" })
      .mockResolvedValue({ rt_cd: "0", output: { pdno: "005930", idx_bztp_mcls_cd_name: "전기전자" } });
    let recoveryClock = now;
    const recover = createSectorProvider(failed, () => recoveryClock);
    const rejected = await Promise.all(Array.from({ length: 8 }, () => recover(["005930"], env)));
    expect(rejected.every(result => result.sectors === null)).toBe(true); expect(failed).toHaveBeenCalledOnce();
    expect((await recover(["005930"], env)).sectors).toBeNull(); expect(failed).toHaveBeenCalledOnce();
    recoveryClock += 60_001;
    expect((await recover(["005930"], env)).sectors).toBeNull();
    recoveryClock += 60_001;
    expect((await recover(["005930"], env)).sectors[0].name).toBe("전기전자"); expect(failed).toHaveBeenCalledTimes(3);
  });
  it("uses index-industry middle names, groups by sector and caches each stock for a Korean date", async () => {
    let clock = now;
    const provider = vi.fn(async (_path, _tr, params) => ({ rt_cd: "0", output: { pdno: params.PDNO, idx_bztp_mcls_cd_name: params.PDNO === "005930" ? "전기전자" : "운수장비" } }));
    const get = createSectorProvider(provider, () => clock);
    const result = await get(["005930", "000660"], env);
    expect(result.sectors).toEqual([{ name: "전기전자", codes: ["005930"] }, { name: "운수장비", codes: ["000660"] }]);
    expect(result.sectorSource).toContain("지수업종 중분류");
    await get(["000660", "005930"], env); expect(provider).toHaveBeenCalledTimes(2);
    clock += 86_400_000; await get(["005930"], env); expect(provider).toHaveBeenCalledTimes(3);
  });
  it("returns null when a stock classification is absent, mismatched or failed, and caches failed observations", async () => {
    const provider = vi.fn(async () => ({ rt_cd: "0", output: { pdno: "005930", idx_bztp_mcls_cd_name: "" } }));
    const get = createSectorProvider(provider, () => now);
    expect(await get(["005930"], env)).toEqual({ sectors: null, sectorSource: null });
    await get(["005930"], env); expect(provider).toHaveBeenCalledOnce();
    expect(await get(["005930"], {})).toEqual({ sectors: null, sectorSource: null });
    const mismatch = createSectorProvider(async () => ({ rt_cd: "0", output: { pdno: "999999", idx_bztp_mcls_cd_name: "전기전자" } }), () => now);
    expect((await mismatch(["005930"], env)).sectors).toBeNull();
  });
});
