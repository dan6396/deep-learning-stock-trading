import { readBoundedJson } from "./boundedJson";
import { createNightProvider, fetchKisNightFutures, unavailableNight } from "./kisBriefing";
import type { KisReadOptions } from "./revalidatingCache";
import { getNasdaqReference, type MacroReference } from "./briefingReference";
import type { MacroObservation, PreOpenIndicator } from "../src/types/preOpenMacro";
import { extractMacroHistory, buildPreOpenIndicators } from "./preOpenMacro";
import { getFuturesForeignFlow, futuresFlowIndicator } from "./futuresForeignFlow";
declare const process: { env: Record<string, string | undefined> };

export const MACRO_UNIVERSE = [
  { id: "KOSPI", name: "코스피", symbol: "^KS11", unit: "pt" },
  { id: "KOSDAQ", name: "코스닥", symbol: "^KQ11", unit: "pt" },
  { id: "NASDAQ", name: "나스닥", symbol: "^IXIC", unit: "pt" },
  { id: "SP500", name: "S&P 500", symbol: "^GSPC", unit: "pt" },
  { id: "USDKRW", name: "원·달러 환율", symbol: "KRW=X", unit: "KRW" },
  { id: "UST10Y", name: "미국 국채 10년 금리", symbol: "^TNX", unit: "%" },
] as const;
type Definition = typeof MACRO_UNIVERSE[number];
export type MacroIndicator = {
  id: Definition["id"] | "KOSPI200_NIGHT"; name: string; value: number | null; change: number | null; changePct: number | null;
  unit: Definition["unit"]; asOf: string | null; source: "yahoo" | "kis"; status: "ok" | "unavailable";
  session?: "closed" | "open" | null;
  history?: MacroObservation[];
};
export type MarketMacro = { asOf: string | null; indicators: MacroIndicator[]; preOpen?: PreOpenIndicator[];
  context?: { usSessionDate: string | null; targetSessionNote: string }; reference?: MacroReference | null };
type Options = { transport?: typeof fetch; now?: () => number; night?: typeof fetchKisNightFutures; reference?: typeof getNasdaqReference; foreignFlow?: typeof getFuturesForeignFlow };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function usMarketDate(asOf: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(asOf));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function usSession(meta: Record<string, any>, timestamp: number, now: number): "closed" | "open" | null {
  const regular = meta.currentTradingPeriod?.regular;
  if (finite(regular?.start) && finite(regular?.end) && regular.end > regular.start) {
    if (timestamp < regular.start) return usMarketDate(new Date(timestamp * 1000).toISOString()) < usMarketDate(new Date(regular.start * 1000).toISOString()) ? "closed" : null;
    if (now / 1000 >= regular.end) return "closed";
    return now / 1000 >= regular.start && timestamp <= now / 1000 ? "open" : null;
  }
  // chart's currentTradingPeriod may describe the next session while regularMarketTime is the last close.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(now));
  const hour = Number(parts.find(part => part.type === "hour")?.value), minute = Number(parts.find(part => part.type === "minute")?.value);
  const weekday = parts.find(part => part.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun" || usMarketDate(new Date(timestamp * 1000).toISOString()) < usMarketDate(new Date(now).toISOString())) return "closed";
  if (hour >= 16) return "closed";
  return hour > 9 && hour < 16 || hour === 9 && minute >= 30 ? "open" : null;
}

/** One source and one unit convention for domestic and overseas indicators. */
export function createMarketMacro({ transport = (...args) => fetch(...args), now = Date.now, night = (...args) => fetchKisNightFutures(...args), reference = getNasdaqReference, foreignFlow = getFuturesForeignFlow }: Options = {}) {
  let cached: { expires: number; value: MarketMacro } | null = null;
  let pending: Promise<MarketMacro> | null = null;
  const getNight = createNightProvider(night, now);
  async function load(env: Record<string, string | undefined>): Promise<MarketMacro> {
    const yahoo = Promise.all(MACRO_UNIVERSE.map(async definition => {
      const unavailable: MacroIndicator = { id: definition.id, name: definition.name, unit: definition.unit,
        value: null, change: null, changePct: null, asOf: null, source: "yahoo", status: "unavailable",
        ...(definition.id === "NASDAQ" || definition.id === "SP500" ? { session: null } : {}) };
      // The deadline covers headers AND body, including transports that ignore abort.
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          (async (): Promise<MacroIndicator> => {
            const response = await transport(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(definition.symbol)}?range=1mo&interval=1d`, {
              signal: controller.signal, redirect: "error", headers: { Accept: "application/json", "User-Agent": "kospi-ai-trading-briefing/1.0" },
            });
            if (!response.ok) return unavailable;
            const body = await readBoundedJson(response);
            const meta = body?.chart?.error ? null : body?.chart?.result?.[0]?.meta;
            const history = extractMacroHistory(body?.chart?.result?.[0], now(), definition.id === "KOSPI" || definition.id === "KOSDAQ" ? "Asia/Seoul" : definition.id === "USDKRW" ? "UTC" : "America/New_York");
            const value: unknown = meta?.regularMarketPrice;
            const timestamp: unknown = meta?.regularMarketTime;
            // Use the prior actual daily observation, even if today's daily bar is absent.
            // chartPreviousClose is a monthly range baseline, so it is the last fallback.
            const day = finite(timestamp) ? new Intl.DateTimeFormat("en-CA", { timeZone: meta?.exchangeTimezoneName || (definition.id === "KOSPI" || definition.id === "KOSDAQ" ? "Asia/Seoul" : definition.id === "USDKRW" ? "UTC" : "America/New_York"), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp * 1000)) : null;
            const prior = history.filter(row => day && row.date < day);
            const previous: unknown = prior[prior.length - 1]?.value ?? meta?.previousClose ?? meta?.chartPreviousClose;
            if (!finite(value) || !finite(previous) || previous <= 0 || !finite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp * 1000).getTime())) return unavailable;
            const change = value - previous, changePct = change / previous * 100;
            if (!finite(change) || !finite(changePct)) return unavailable;
            return { ...unavailable, value, change, changePct, history, asOf: new Date(timestamp * 1000).toISOString(), status: "ok",
              ...(definition.id === "NASDAQ" || definition.id === "SP500" ? { session: usSession(meta, timestamp, now()) } : {}) };
          })(),
          new Promise<MacroIndicator>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unavailable); }, 8000); }),
        ]);
      } catch { return unavailable; }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }));
    // Earliest actual observation: consumers must still show each market's own asOf.
    const [indicators, historical] = await Promise.all([yahoo, reference(env).catch(() => null)]);
    const times = indicators.flatMap(row => row.asOf ? [row.asOf] : []).sort();
    return { asOf: times[0] ?? null, indicators, preOpen: buildPreOpenIndicators(indicators), reference: historical };
  }
  async function base(env: Record<string, string | undefined>): Promise<MarketMacro> {
    if (cached && now() < cached.expires) return structuredClone(cached.value);
    if (!pending) {
      const requestedTtl = Number(env.BRIEFING_MACRO_CACHE_TTL_MS);
      const ttl = Number.isFinite(requestedTtl) && requestedTtl > 0 ? requestedTtl : 600_000;
      pending = load(env).then(value => { cached = { expires: now() + ttl, value }; return value; }).finally(() => { pending = null; });
    }
    return structuredClone(await pending);
  };
  return async (env = process.env, options: KisReadOptions = {}): Promise<MarketMacro> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nightResult = options.backgroundKis ? getNight(env, options) : Promise.race([getNight(env, options), new Promise<MacroIndicator>(resolve => {
      timer = setTimeout(() => resolve(unavailableNight()), 8000);
    })]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
    let flowTimer: ReturnType<typeof setTimeout> | undefined;
    const flowResult = Promise.race([foreignFlow(env, options).catch(() => futuresFlowIndicator([])), new Promise<PreOpenIndicator>(resolve => {
      flowTimer = setTimeout(() => resolve(futuresFlowIndicator([])), options.backgroundKis ? Math.max(0, Math.min(1500, options.kisWaitMs ?? 1500)) : 8000);
    })]).finally(() => { if (flowTimer !== undefined) clearTimeout(flowTimer); });
    const [market, observedNight, observedFlow] = await Promise.all([base(env), nightResult, flowResult]);
    const indicators = [...market.indicators, observedNight], times = indicators.flatMap(row => row.asOf ? [row.asOf] : []).sort();
    return { ...market, asOf: times[0] ?? null, indicators, preOpen: [...(market.preOpen ?? []).filter(row => row.id !== "KOSPI200_FOREIGN_FUTURES"), observedFlow] };
  };
}
export const getMarketMacro = createMarketMacro();
