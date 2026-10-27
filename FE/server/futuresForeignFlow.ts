import type { MacroObservation, PreOpenIndicator } from "../src/types/preOpenMacro";
import { nextKrxSession } from "./krxCalendar";
import { requestBriefingKis } from "./kisDashboard";
import { macroComment } from "./macroCommentRules";
import { createMarketDataCache } from "./marketDataCache";
import { inFlightKey, shareInFlight } from "./inFlight";
import { intradayRepairRetryAt } from "./marketCachePolicy";
import type { KisReadOptions } from "./revalidatingCache";

type Env = Record<string, string | undefined>;
type Calendar = (day: string) => string | null;
type StoredFlow = { targetDate: string; history: MacroObservation[] };
type Request = typeof requestBriefingKis;
const requestExisting: Request = (...args) => requestBriefingKis(...args);
const dayBefore = (day: string) => new Date(Date.parse(day + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
const validDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
const tradingDay = (day: string, calendar: Calendar) => calendar(dayBefore(day)) === day;

/** A pre-open brief never includes the current KST day's still-revisable flow. */
export function previousFuturesSession(now: number, calendar: Calendar = nextKrxSession): string | null {
  let day = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
  for (let offset = 0; offset < 31; offset++) {
    day = dayBefore(day);
    const confirmed = calendar(dayBefore(day));
    if (confirmed === null) return null;
    if (confirmed === day) return day;
  }
  return null;
}
/** Exactly the five confirmed sessions ending at targetDate; never bridge a missing day. */
function sessionWindow(targetDate: string | undefined, calendar: Calendar): string[] {
  if (!validDay(targetDate) || !tradingDay(targetDate, calendar)) return [];
  const days = [targetDate];
  while (days.length < 5) {
    const previous = previousFuturesSession(Date.parse(days[0] + "T00:00:00+09:00"), calendar);
    if (!previous) return [];
    days.unshift(previous);
  }
  return days;
}
export function parseFuturesForeignFlow(body: Record<string, unknown>, targetDate: string, calendar: Calendar = nextKrxSession): MacroObservation[] {
  if (!validDay(targetDate) || !tradingDay(targetDate, calendar) || body.rt_cd !== "0" || !Array.isArray(body.output)) return [];
  const dates = new Map<string, number>();
  for (const raw of body.output) {
    if (!raw || typeof raw !== "object" || typeof raw.stck_bsop_date !== "string" || !/^\d{8}$/.test(raw.stck_bsop_date)) continue;
    const token = raw.stck_bsop_date, date = `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`;
    const value = typeof raw.frgn_ntby_qty === "number" ? raw.frgn_ntby_qty : typeof raw.frgn_ntby_qty === "string" && /^[+-]?\d+$/.test(raw.frgn_ntby_qty.trim()) ? Number(raw.frgn_ntby_qty) : NaN;
    if (validDay(date) && date <= targetDate && tradingDay(date, calendar) && Number.isSafeInteger(value)) dates.set(date, value);
  }
  const days = sessionWindow(targetDate, calendar);
  return days.length === 5 && days.every(date => dates.has(date)) ? days.map(date => ({ date, value: dates.get(date)! })) : [];
}
export function futuresFlowIndicator(history: MacroObservation[], calendar: Calendar = nextKrxSession): PreOpenIndicator {
  const days = sessionWindow(history[history.length - 1]?.date, calendar);
  if (days.length !== 5 || history.length !== 5 || history.some((row, index) => row.date !== days[index] || !Number.isSafeInteger(row.value))) history = [];
  const last = history[history.length - 1], previous = history[history.length - 2];
  let consecutiveDays = 0;
  if (last && last.value !== 0) for (let index = history.length - 1; index >= 0 && Math.sign(history[index].value) === Math.sign(last.value); index--) {
    if (index < history.length - 1 && calendar(history[index].date) !== history[index + 1].date) break;
    consecutiveDays += Math.sign(last.value);
  }
  const base: Omit<PreOpenIndicator, "comment"> = { id: "KOSPI200_FOREIGN_FUTURES", name: "코스피200 선물 외국인 순매수", unit: "계약", source: "kis",
    status: last ? "ok" : "unavailable", value: last?.value ?? null, asOf: last?.date ?? null, history,
    change: last && previous ? last.value - previous.value : null, changePct: null,
    fiveDayChange: null, fiveDayChangePct: null,
    fiveDaySum: last ? history.reduce((sum, row) => sum + row.value, 0) : null, consecutiveDays };
  return { ...base, comment: macroComment(base) };
}

export function createFuturesForeignFlowProvider({ request = requestExisting, now = Date.now, calendar = nextKrxSession, directory }: { request?: Request; now?: () => number; calendar?: Calendar; directory?: string } = {}) {
  const cache = createMarketDataCache<StoredFlow>("futures-flow", (value): value is StoredFlow => {
    const row = value as StoredFlow;
    return !!row && validDay(row.targetDate) && Array.isArray(row.history) && row.history.length > 0 && row.history.length <= 5
      && row.history.every(point => validDay(point.date) && point.date <= row.targetDate && Number.isSafeInteger(point.value));
  }, directory);
  const pending = new Map<string, Promise<PreOpenIndicator>>();
  const failures = new Map<string, { repairFailedAt: number; repairFailures: number }>();
  return async (env: Env = process.env, options: KisReadOptions = {}): Promise<PreOpenIndicator> => {
    const targetDate = previousFuturesSession(now(), calendar), fallback = () => futuresFlowIndicator([]);
    if (!targetDate || env.KIS_ENV !== "real" || !(env.KIS_REAL_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY)?.trim() || !(env.KIS_REAL_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET)?.trim()) return fallback();
    const key = inFlightKey(["K2I", "F001", targetDate, env.KIS_ENV, env.KIS_BASE_URL, env.KIS_REAL_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY]);
    const saved = await cache.read(key, true);
    if (saved?.data.targetDate === targetDate) {
      const history = parseFuturesForeignFlow({ rt_cd: "0", output: saved.data.history.map(row => ({ stck_bsop_date: row.date.replace(/-/g, ""), frgn_ntby_qty: row.value })) }, targetDate, calendar);
      if (history[history.length - 1]?.date === targetDate) return futuresFlowIndicator(history, calendar);
    }
    if (now() < intradayRepairRetryAt(failures.get(key))) return fallback();
    const refresh = shareInFlight(pending, key, async () => {
      try {
        const date = targetDate.replace(/-/g, "");
        const body = await request("/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market", "FHPTJ04040000", {
          FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "0001", FID_INPUT_DATE_1: date,
          FID_INPUT_ISCD_1: "K2I", FID_INPUT_DATE_2: date, FID_INPUT_ISCD_2: "F001",
        }, { ...env, KIS_MAX_RPS: "1" });
        const history = parseFuturesForeignFlow(body, targetDate, calendar);
        if (history[history.length - 1]?.date !== targetDate) throw Error("missing_previous_session");
        await cache.write(key, { targetDate, history }, true); failures.delete(key);
        return futuresFlowIndicator(history, calendar);
      } catch {
        failures.set(key, { repairFailedAt: now(), repairFailures: (failures.get(key)?.repairFailures ?? 0) + 1 });
        console.warn("[briefing] KOSPI200_FOREIGN_FUTURES unavailable: daily_flow_failed", { targetDate });
        return fallback();
      }
    });
    if (!options.backgroundKis) return refresh;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([refresh, new Promise<PreOpenIndicator>(resolve => { timer = setTimeout(() => resolve(fallback()), Math.max(0, Math.min(1500, options.kisWaitMs ?? 1500))); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
}
export const getFuturesForeignFlow = createFuturesForeignFlowProvider();
