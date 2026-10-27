import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import raw from "./fixtures/futures-flow-daily.json";
const disk = vi.hoisted(() => new Map());
vi.mock("node:fs/promises", () => { const api = { readFile: vi.fn(async path => { if (!disk.has(path)) throw Error("missing"); return disk.get(path); }), mkdir: vi.fn(), writeFile: vi.fn(async (path, value) => disk.set(path, value)), rename: vi.fn(async (from, to) => { disk.set(to, disk.get(from)); disk.delete(from); }) }; return { ...api, default: api }; });
import { parseFuturesForeignFlow, previousFuturesSession, futuresFlowIndicator, createFuturesForeignFlowProvider } from "../../server/futuresForeignFlow";
import { validateMarketOutlook, applyNarrativeExtensions } from "../../server/briefingExtensions";
import { groundedNumbers } from "../../server/briefingValidation";
import { createMarketMacro } from "../../server/marketMacro";
import { adaptMacroData } from "../entities/briefing";
// Field names and observed values come from futures-probe-2/04-daily-k2i-20261027.json.
const env = { KIS_ENV: "real", KIS_APP_KEY: "fixture-key", KIS_APP_SECRET: "fixture-secret" };
const day = "2026-10-26";
const input = flow => ({ model: null, stocks: [], macro: { asOf: day, indicators: [], preOpen: [flow] } });
const opinion = text => ({ stance: "중립", text, citations: ["M:KOSPI200_FOREIGN_FUTURES"] });
beforeEach(() => { disk.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T13:00:00+09:00")); });
afterEach(() => vi.useRealTimers());
describe("previous-session KOSPI200 foreign futures flow", () => {
  it("extracts actual dated contracts only and discards reference prices and raw cash", () => {
    const history = parseFuturesForeignFlow(raw, day);
    expect(history).toHaveLength(5); expect(history[4]).toEqual({ date: day, value: 3451 });
    const flow = futuresFlowIndicator(history);
    expect(flow).toMatchObject({ status: "ok", unit: "계약", value: 3451, asOf: day });
    expect(flow.fiveDaySum).toBe(history.reduce((sum, row) => sum + row.value, 0));
    expect(JSON.stringify(flow)).not.toMatch(/frgn_ntby_tr_pbmn|bstp_nmix_prpr|740853|5469.47/);
    expect(adaptMacroData(input(flow).macro).preOpen[0].fiveDaySum).toBe(flow.fiveDaySum);
  });
  it("skips holidays, invalid dates, missing values and future/current rows and deduplicates corrections", () => {
    const body = { rt_cd: "0", output: [
      { stck_bsop_date: "20261026", frgn_ntby_qty: "1" }, { stck_bsop_date: "20261023", frgn_ntby_qty: "-2" },
      { stck_bsop_date: "20261026", frgn_ntby_qty: "3" }, { stck_bsop_date: "20261027", frgn_ntby_qty: "999" },
      { stck_bsop_date: "20261009", frgn_ntby_qty: "50" }, { stck_bsop_date: "20261025", frgn_ntby_qty: "50" },
      { stck_bsop_date: "20260230", frgn_ntby_qty: "50" }, { stck_bsop_date: "20261022", frgn_ntby_qty: null },
    ] };
    expect(parseFuturesForeignFlow(body, day)).toEqual([]);
    const complete = { ...raw, output: [...raw.output, ...body.output] };
    const history = parseFuturesForeignFlow(complete, day);
    expect(history).toHaveLength(5); expect(history[4]).toEqual({ date: day, value: 3 });
  });
  it("selects a prior confirmed trading day through weekends and holidays, never today", () => {
    expect(previousFuturesSession(Date.parse("2026-10-27T23:00:00+09:00"))).toBe(day);
    expect(previousFuturesSession(Date.parse("2026-10-12T08:00:00+09:00"))).toBe("2026-10-08");
    expect(previousFuturesSession(Date.now(), () => null)).toBeNull();
    expect(previousFuturesSession(Date.parse("2027-01-15T08:00:00+09:00"))).toBeNull();
  });
  it("uses one documented read path and persists a successful day across provider instances", async () => {
    const request = vi.fn(async () => raw), get = createFuturesForeignFlowProvider({ request });
    const results = await Promise.all([get(env), get(env)]); expect(results[0].value).toBe(3451);
    await get(env); await createFuturesForeignFlowProvider({ request })(env);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]).toMatchObject(["/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market", "FHPTJ04040000", { FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "0001", FID_INPUT_ISCD_1: "K2I", FID_INPUT_ISCD_2: "F001", FID_INPUT_DATE_1: "20261026", FID_INPUT_DATE_2: "20261026" }, { KIS_MAX_RPS: "1" }]);
    vi.setSystemTime(new Date("2026-10-28T08:00:00+09:00")); expect((await get(env)).value).toBe(670); expect(request).toHaveBeenCalledTimes(2);
  });
  it("backs off empty responses at 60s then 120s without per-GET retries", async () => {
    const request = vi.fn(async () => ({ rt_cd: "0", output: [] })), get = createFuturesForeignFlowProvider({ request });
    expect((await get(env)).status).toBe("unavailable"); await get(env); expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000); await get(env); expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000); await get(env); expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000); await get(env); expect(request).toHaveBeenCalledTimes(3);
  });
  it("bounds cold background waits and later reuses the same request", async () => {
    let release; const request = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const get = createFuturesForeignFlowProvider({ request }), pending = get(env, { backgroundKis: true });
    await vi.advanceTimersByTimeAsync(1500); expect((await pending).status).toBe("unavailable");
    release(raw); await vi.advanceTimersByTimeAsync(0); expect((await get(env)).status).toBe("ok"); expect(request).toHaveBeenCalledOnce();
  });
  it("does not call KIS for missing configuration or an unknown calendar", async () => {
    const request = vi.fn(); expect((await createFuturesForeignFlowProvider({ request })({})).status).toBe("unavailable");
    expect((await createFuturesForeignFlowProvider({ request, calendar: () => null })(env)).status).toBe("unavailable"); expect(request).not.toHaveBeenCalled();
  });
  it("isolates thrown provider failures as unavailable", async () => {
    const get = createFuturesForeignFlowProvider({ request: vi.fn(async () => { throw Error("fixture failure"); }) });
    expect((await get(env)).status).toBe("unavailable");
  });
  it("creates provisional sum and trailing buy/sell comments including zero", () => {
    for (const [values, sign, streak] of [[[-1, -2, 1, 2, 3], "up", 3], [[1, 2, 3, -2, -5], "down", -2], [[1, -1, 1, -1, 0], "flat", 0]]) {
      const flow = futuresFlowIndicator(parseFuturesForeignFlow(raw, day).map((row, index) => ({ ...row, value: values[index] })));
      expect(flow.comment.placeholder).toBe(true); expect(flow.comment.ruleId).toContain(sign); expect(flow.consecutiveDays).toBe(streak);
      if (streak) expect(flow.comment.text).toContain(`${Math.abs(streak)}거래일 연속 순매${streak > 0 ? "수" : "도"}`);
    }
  });
  it("rejects a six-session window with the 10/22 observation missing, including old disk caches", async () => {
    const incomplete = { ...raw, output: raw.output.filter(row => row.stck_bsop_date !== "20261022") };
    expect(parseFuturesForeignFlow(incomplete, day)).toEqual([]);
    const old = [...parseFuturesForeignFlow(raw, day).filter(row => row.date !== "2026-10-22"), { date: "2026-10-19", value: 1 }].sort((a, b) => a.date.localeCompare(b.date));
    const flow = futuresFlowIndicator(old);
    expect(flow).toMatchObject({ status: "unavailable", history: [], fiveDaySum: null, fiveDayChange: null });
    const request = vi.fn(async () => raw); await createFuturesForeignFlowProvider({ request })(env);
    for (const [path, value] of disk) { const saved = JSON.parse(value); saved.data.history = old; disk.set(path, JSON.stringify(saved)); }
    const repair = vi.fn(async () => incomplete), get = createFuturesForeignFlowProvider({ request: repair });
    expect((await get(env)).status).toBe("unavailable"); await get(env); expect(repair).toHaveBeenCalledOnce();
  });
  it.each([
    "외국인 선물 3,451계약 순매수, 외국인 코스피 순매수가 이어졌습니다.",
    "외국인 선물 3,451계약 순매수, 코스피에서는 외국인 순매도가 이어졌습니다.",
    "외국인 선물 3,451계약 순매수, 외국인 주식 순매수도 이어졌습니다.",
    "선물 외국인은 순매도 우위입니다.",
    "선물 외국인은 최근 5일 순매도 흐름입니다.",
    "외국인 선물은 3,451계약 순매수이며 외국인 순매수가 이어졌습니다.",
    "외국인 선물은 순매수이고 시장 전체 수급은 순매수입니다.",
    "외국인 선물은 순매수지만 코스피 외국인 순매수도 이어졌습니다.",
    "외국인 선물은 순매수고 외국인 주식 순매도가 이어졌습니다.",
    "외국인 선물 순매수와 외국인 주식 순매수가 이어졌습니다.",
    "외국인 선물 순매수 및 외국인 순매도가 이어졌습니다.",
  ])("rejects mixed spot subjects and unsupported qualitative direction: %s", text => {
    const data = input(futuresFlowIndicator(parseFuturesForeignFlow(raw, day)));
    const value = opinion(text + " 중립입니다.");
    expect(validateMarketOutlook(value, data)).not.toBeNull();
    const base = { status: "llm", overview: "기존 종합 요약", marketNote: "", stocks: [], llmModel: "fixture", fallbackReason: null };
    const result = applyNarrativeExtensions(base, { marketOutlook: value }, data);
    expect(result.marketOutlook.source).toBe("template"); expect(result.overview).toBe(base.overview); expect(result.status).toBe("llm");
  });
  it("checks aggregate, latest and consecutive signs independently and preserves valid coordination", () => {
    const history = parseFuturesForeignFlow(raw, day), data = input(futuresFlowIndicator(history));
    expect(validateMarketOutlook(opinion("외국인 선물은 최근 5거래일 합계 2,004계약 순매수이고 직전일 3,451계약 순매수입니다. 중립입니다."), data)).toBeNull();
    expect(validateMarketOutlook(opinion("선물 외국인은 최근 5일 순매수 흐름입니다. 중립입니다."), data)).toBeNull();
    expect(validateMarketOutlook(opinion("선물 외국인은 4,995계약입니다. 중립입니다."), data)).toBe("ungrounded_number");
    const mixed = input(futuresFlowIndicator(history.map((row, index) => ({ ...row, value: [100, 100, 100, -10, -20][index] }))));
    for (const text of ["선물 외국인은 최근 5일 순매수이며 직전일 순매도입니다.", "외국인 선물은 2거래일 연속 순매도입니다."]) {
      expect(validateMarketOutlook(opinion(text + " 중립입니다."), mixed)).toBeNull();
    }
    for (const text of ["선물 외국인은 직전일 순매수입니다.", "외국인 선물은 최근 5일 순매도입니다.", "외국인 선물은 2거래일 연속 순매수입니다."]) {
      expect(validateMarketOutlook(opinion(text + " 중립입니다."), mixed)).not.toBeNull();
    }
  });
  it("licenses contract facts and totals only for scoped foreign futures opinion", () => {
    const flow = futuresFlowIndicator(parseFuturesForeignFlow(raw, day)), data = input(flow);
    const text = `선물 외국인은 ${flow.value}계약 순매수이며 최근 5일 합계는 ${flow.fiveDaySum}계약입니다. 중립입니다.`;
    expect(validateMarketOutlook(opinion(text), data)).toBeNull();
    expect(validateMarketOutlook(opinion(flow.comment.text + " 중립입니다."), data)).toBeNull();
    expect(validateMarketOutlook(opinion(`외국인 선물은 ${flow.value}계약 순매수입니다. 중립입니다.`), data)).toBeNull();
    expect(groundedNumbers(text, data)).toBe(false);
    expect(validateMarketOutlook(opinion(`선물 외국인은 ${flow.value}계약 순매도입니다. 중립입니다.`), data)).toBe("ungrounded_number");
    expect(validateMarketOutlook(opinion("선물 외국인 수급은 740853원입니다. 중립입니다."), data)).not.toBeNull();
    expect(validateMarketOutlook(opinion("선물 외국인 수급은 46.6%입니다. 중립입니다."), data)).toBe("ungrounded_number");
    expect(validateMarketOutlook(opinion(`선물 외국인 최근 5일 합계는 ${flow.value}계약입니다. 중립입니다.`), data)).toBe("ungrounded_number");
    expect(validateMarketOutlook(opinion("외국인 현물 순매수가 증가했습니다. 중립입니다."), data)).toBe("forbidden_content");
    expect(validateMarketOutlook(opinion("외국인 선물 순매수 자료는 확인되지 않았습니다. 중립입니다."), data)).toBe("invalid_availability");
    expect(validateMarketOutlook(opinion("외국인 선물 수급 데이터가 결측되어 중립입니다."), data)).toBe("invalid_availability");
    expect(validateMarketOutlook(opinion("야간선물 자료는 확인되지 않았습니다. 외국인 선물은 순매수입니다. 중립입니다."), data)).toBeNull();
  });
  it("joins futures with existing six indicators without changing old transport counts", async () => {
    const flow = futuresFlowIndicator(parseFuturesForeignFlow(raw, day));
    const result = await createMarketMacro({ transport: vi.fn(async () => ({ ok: false })), foreignFlow: async () => flow, reference: async () => null })({});
    expect(result.preOpen[3].value).toBe(3451); expect(result.indicators).toHaveLength(7);
  });
});
