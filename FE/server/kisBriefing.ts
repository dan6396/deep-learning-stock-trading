import { requestBriefingKis } from "./kisDashboard";
import { inFlightKey } from "./inFlight";
import { createRevalidatingCache, type KisReadOptions } from "./revalidatingCache";
import type { MacroIndicator } from "./marketMacro";
declare const process: { env: Record<string, string | undefined> };
type Env = Record<string, string | undefined>;
type Request = (path: string, tr: string, params: Record<string, string>, env: Env) => Promise<Record<string, unknown>>;
const request: Request = (...args) => requestBriefingKis(...args);
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value
  : typeof value === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
function kstParts(now: number) {
  const shifted = new Date(now + 9 * 3_600_000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours(), weekday: shifted.getUTCDay(), shifted };
}
export function nightSession(now: number): "open" | "closed" {
  const { hour, weekday } = kstParts(now);
  return hour >= 18 && weekday >= 1 && weekday <= 5 || hour < 6 && weekday >= 2 && weekday <= 6 ? "open" : "closed";
}
/** Official current master uses A01612 for 2026-12 and A01703 for 2027-03. */
export function nearestKospi200Future(now: number): string {
  const { date, shifted } = kstParts(now);
  for (let year = shifted.getUTCFullYear(); year <= shifted.getUTCFullYear() + 1; year++) {
    for (const month of [3, 6, 9, 12]) {
      const first = new Date(Date.UTC(year, month - 1, 1)), secondThursday = 1 + (4 - first.getUTCDay() + 7) % 7 + 7;
      const expiry = `${year}-${String(month).padStart(2, "0")}-${String(secondThursday).padStart(2, "0")}`;
      // Expiry-day night session belongs to the next contract; the day contract expires before 18:00.
      if (date < expiry || date === expiry && shifted.getUTCHours() < 15) return `A01${year % 10}${String(month).padStart(2, "0")}`;
    }
  }
  throw new Error("No valid futures expiry.");
}
export const unavailableNight = (): MacroIndicator => ({ id: "KOSPI200_NIGHT", name: "코스피200 야간선물", unit: "pt", source: "kis",
  value: null, change: null, changePct: null, asOf: null, status: "unavailable", session: null });
function nightObservation(output: Record<string, unknown>, now: number): string {
  const date = typeof output.stck_bsop_date === "string" ? output.stck_bsop_date : "";
  const time = typeof output.stck_cntg_hour === "string" ? output.stck_cntg_hour : "";
  const hour = Number(time.slice(0, 2)), minute = Number(time.slice(2, 4)), second = Number(time.slice(4, 6));
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time) || hour > 30 || minute > 59 || second > 59 || hour === 30 && (minute !== 0 || second !== 0)) throw new Error("missing_observation_fields");
  const midnight = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00+09:00`);
  let observed = midnight + (hour * 3600 + minute * 60 + second) * 1000;
  // Some night bars retain the session's business date with a normal 00–05 clock.
  if (hour < 6 && (nightSession(observed) !== "open" || now - observed >= 18 * 3_600_000)) observed += 86_400_000;
  // KIS represents the next calendar day's final night-session bar as 30:00:00.
  const closingBar = hour === 30;
  if (!Number.isFinite(midnight) || kstParts(midnight).date.replace(/-/g, "") !== date || nightSession(observed - (closingBar ? 1 : 0)) !== "open" || observed > now + 60_000 || now - observed > 4 * 86_400_000) throw new Error("not_a_verified_night_observation");
  return new Date(observed).toISOString();
}
function nightQuery(now: number): { date: string; time: string } {
  const { shifted, hour } = kstParts(now);
  let queryHour = hour, minute = shifted.getUTCMinutes(), second = shifted.getUTCSeconds();
  if (hour < 18) {
    shifted.setUTCDate(shifted.getUTCDate() - 1);
    queryHour = hour < 6 ? hour + 24 : 30;
    if (hour >= 6) minute = second = 0;
  }
  // A closed weekend query must refer to the most recent weekday session.
  while (shifted.getUTCDay() === 0 || shifted.getUTCDay() === 6) {
    shifted.setUTCDate(shifted.getUTCDate() - 1);
    queryHour = 30; minute = second = 0;
  }
  return { date: shifted.toISOString().slice(0, 10).replace(/-/g, ""),
    time: [queryHour, minute, second].map(value => String(value).padStart(2, "0")).join("") };
}
// Price fields: inquire_price/chk_inquire_price.py. Explicit observation pair:
// inquire_time_fuopchartprice/chk_inquire_time_fuopchartprice.py (never use expiry date as observation).
export function parseNightFutures(body: Record<string, unknown>, now: number): MacroIndicator {
  const output = body.output1 as Record<string, unknown> | undefined;
  if (!output || Array.isArray(output) || body.rt_cd !== "0") throw new Error("invalid_response");
  const value = finite(output.futs_prpr), previous = finite(output.futs_prdy_clpr), rawChange = finite(output.futs_prdy_vrss), rate = finite(output.futs_prdy_ctrt);
  if (value === null || value <= 0 || previous === null || previous <= 0 || rawChange === null || rate === null) throw new Error("missing_price_fields");
  const asOf = nightObservation(output, now);
  const change = value - previous;
  if (Math.abs(Math.abs(change) - Math.abs(rawChange)) > 0.011 || Math.abs(change / previous * 100 - rate) > 0.03) throw new Error("inconsistent_price_fields");
  return { ...unavailableNight(), value, change, changePct: rate, asOf, status: "ok", session: nightSession(now) };
}
export function parseNightFuturesCandles(body: Record<string, unknown>, price: Record<string, unknown> | null, now: number): MacroIndicator {
  if (body.rt_cd !== "0" || !Array.isArray(body.output2)) throw new Error("invalid_response");
  const candles = body.output2.flatMap(output => {
    if (!output || typeof output !== "object") return [];
    const value = finite(output.futs_prpr);
    if (value === null || value <= 0) return [];
    try { return [{ value, asOf: nightObservation(output, now) }]; } catch { return []; }
  }).sort((a, b) => b.asOf.localeCompare(a.asOf));
  const latest = candles[0];
  if (!latest) throw new Error("not_a_verified_night_observation");
  const previous = finite((body.output1 as Record<string, unknown> | undefined)?.futs_prdy_clpr)
    ?? (price?.rt_cd === "0" ? finite((price.output1 as Record<string, unknown> | undefined)?.futs_prdy_clpr) : null);
  const change = previous !== null && previous > 0 ? latest.value - previous : null;
  return { ...unavailableNight(), ...latest, change, changePct: change !== null && previous !== null ? change / previous * 100 : null,
    status: "ok", session: nightSession(now) };
}
export async function fetchKisNightFutures(env: Env = process.env, now = Date.now(), provider: Request = request): Promise<MacroIndicator> {
  if (!hasRealKis(env)) return unavailableNight();
  try {
    const code = env.KIS_NIGHT_FUTURES_CODE?.trim() || nearestKospi200Future(now);
    const market = env.KIS_NIGHT_FUTURES_MARKET_CODE?.trim() || "CM";
    if (!/^[A-Z0-9]{6,9}$/.test(code) || !/^[A-Z]{1,2}$/.test(market)) throw new Error("invalid_configuration");
    let price: Record<string, unknown> | null = null;
    try {
      price = await provider("/uapi/domestic-futureoption/v1/quotations/inquire-price", "FHMIF10000000", { FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: code }, env);
      return parseNightFutures(price, now);
    } catch { /* Explicitly timed minute bars are the only secondary path. */ }
    const { date, time } = nightQuery(now);
    const candles = await provider("/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice", "FHKIF03020200", {
      FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: code, FID_HOUR_CLS_CODE: "60", FID_PW_DATA_INCU_YN: "Y", FID_FAKE_TICK_INCU_YN: "N",
      FID_INPUT_DATE_1: date, FID_INPUT_HOUR_1: time,
    }, env);
    return parseNightFuturesCandles(candles, price, now);
  } catch (error) {
    const reason = error instanceof Error && ["invalid_response", "missing_price_fields", "missing_observation_fields", "not_a_verified_night_observation", "inconsistent_price_fields", "invalid_configuration"].includes(error.message) ? error.message : "request_failed";
    console.warn(`[briefing] KOSPI200_NIGHT unavailable: ${reason}`);
    return unavailableNight();
  }
}
function hasRealKis(env: Env) { return env.KIS_ENV === "real" && Boolean((env.KIS_REAL_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY)?.trim())
  && Boolean((env.KIS_REAL_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET)?.trim()); }

export function createSectorProvider(provider: Request = request, now = Date.now) {
  const read = createRevalidatingCache<string | null>(now);
  type Classification = { sectors: { name: string; codes: string[] }[] | null; sectorSource: string | null };
  const batches = createRevalidatingCache<Classification>(now);
  return async (codes: string[], env: Env = process.env, options: KisReadOptions = {}): Promise<{ sectors: { name: string; codes: string[] }[] | null; sectorSource: string | null }> => {
    const missing = { sectors: null, sectorSource: null };
    if (!codes.length || !hasRealKis(env) || codes.some(code => !/^\d{6}$/.test(code))) return missing;
    const scope = (identity: string | string[]) => inFlightKey([env.KIS_ENV, env.KIS_BASE_URL,
      env.KIS_REAL_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY, env.KIS_REAL_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET, identity]);
    const untilMidnight = () => 86_400_000 - (now() + 9 * 3_600_000) % 86_400_000;
    const collect = async (): Promise<Classification> => {
      const names = new Map<string, string[]>();
      for (const code of codes) {
        const name = await read(scope(code), async () => {
          const body = await provider("/uapi/domestic-stock/v1/quotations/search-stock-info", "CTPF1002R", { PRDT_TYPE_CD: "300", PDNO: code }, env);
          if (body.rt_cd !== "0") throw new Error("Sector request failed.");
          const output = body.output as Record<string, unknown> | undefined, field = output?.idx_bztp_mcls_cd_name;
          return output && !Array.isArray(output) && output.pdno === code && typeof field === "string" && field.trim() ? field.trim() : null;
        }, () => null, value => value !== null, untilMidnight);
        if (!name) return missing;
        const group = names.get(name) ?? []; group.push(code); names.set(name, group);
      }
      return { sectors: [...names].map(([name, grouped]) => ({ name, codes: grouped })), sectorSource: "KIS 주식기본조회 · 지수업종 중분류" };
    };
    // Bound the complete classification lookup so remaining stocks continue after GET returns.
    return options.backgroundKis ? batches(scope(codes), collect, () => missing, value => value.sectors !== null, untilMidnight, options) : collect();
  };
}
export const getBriefingSectors = createSectorProvider();

export function createNightProvider(provider = fetchKisNightFutures, now = Date.now) {
  const read = createRevalidatingCache<MacroIndicator>(now);
  return (env: Env = process.env, options: KisReadOptions = {}) => {
    const key = inFlightKey([env.KIS_ENV, env.KIS_BASE_URL, env.KIS_REAL_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY,
      env.KIS_REAL_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET, env.KIS_NIGHT_FUTURES_CODE, env.KIS_NIGHT_FUTURES_MARKET_CODE]);
    const configured = Number(env.BRIEFING_MACRO_CACHE_TTL_MS), ttl = Number.isFinite(configured) && configured > 0 ? configured : 600_000;
    return read(key, () => provider(env, now()), unavailableNight, value => value.status === "ok", ttl, options)
      .then(value => ({ ...value, session: value.status === "ok" ? nightSession(now()) : value.session }));
  };
}
