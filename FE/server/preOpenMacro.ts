import type { MacroIndicator } from "./marketMacro";
import type { MacroObservation, PreOpenIndicator } from "../src/types/preOpenMacro";
import { macroComment } from "./macroCommentRules";
import { usMarketDate } from "./marketMacro";

/** Yahoo timestamps identify actual daily observations; null days are never filled. */
export function extractMacroHistory(result: any, now: number, timezone = "America/New_York"): MacroObservation[] {
  const closes = result?.indicators?.quote?.[0]?.close, times = result?.timestamp;
  if (!Array.isArray(closes) || !Array.isArray(times)) return [];
  const byDate = new Map<string, number>();
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: result?.meta?.exchangeTimezoneName || timezone, year: "numeric", month: "2-digit", day: "2-digit" }); } catch { return []; }
  times.forEach((time: unknown, index: number) => {
    const value = closes[index];
    if (typeof time !== "number" || !Number.isFinite(time) || time <= 0 || time * 1000 > now || typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
    const parts = formatter.formatToParts(new Date(time * 1000)), get = (type: string) => parts.find(p => p.type === type)?.value;
    byDate.set(`${get("year")}-${get("month")}-${get("day")}`, value);
  });
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

export function buildPreOpenIndicators(indicators: MacroIndicator[]): PreOpenIndicator[] {
  const nasdaq = indicators.find(row => row.id === "NASDAQ" && row.status === "ok");
  const currentUsDate = nasdaq?.asOf ? usMarketDate(nasdaq.asOf) : null;
  const closedNasdaq = (nasdaq?.history ?? []).filter(row => currentUsDate && (nasdaq?.session === "open" ? row.date < currentUsDate : row.date <= currentUsDate));
  const referenceDate = closedNasdaq[closedNasdaq.length - 1]?.date ?? (nasdaq?.session === "closed" ? currentUsDate : null);
  const rows = (["UST10Y", "NASDAQ", "USDKRW"] as const).map(id => {
    const observed = indicators.find(row => row.id === id);
    const history = (observed?.status === "ok" ? observed.history ?? [] : []).filter(row => referenceDate && row.date <= referenceDate).slice(-5);
    const last = history[history.length - 1], previous = history[history.length - 2], first = history[0];
    const value = last?.value ?? null, change = last && previous ? last.value - previous.value : null;
    const fiveDayChange = last && history.length >= 2 ? last.value - first.value : null;
    const base: Omit<PreOpenIndicator, "comment"> = { id, name: observed?.name ?? id,
      unit: id === "UST10Y" ? "%" : id === "USDKRW" ? "KRW" : "pt", value, change,
      changePct: change !== null && previous ? change / previous.value * 100 : null, history,
      fiveDayChange, fiveDayChangePct: fiveDayChange !== null ? fiveDayChange / first.value * 100 : null,
      // Historical daily bars identify a date, not an invented closing clock time.
      asOf: last ? observed?.history?.[observed.history.length - 1]?.date === last.date && observed?.asOf && usMarketDate(observed.asOf) === last.date ? observed.asOf : last.date : null,
      source: "yahoo", status: value === null ? "unavailable" : "ok" };
    return { ...base, comment: macroComment(base) };
  });
  const futures: Omit<PreOpenIndicator, "comment"> = { id: "KOSPI200_FOREIGN_FUTURES", name: "코스피200 선물 외국인 순매수", value: null, change: null, changePct: null, unit: "계약", history: [], asOf: null, fiveDayChange: null, fiveDayChangePct: null, source: "unknown", status: "unavailable" };
  return [...rows, { ...futures, comment: macroComment(futures) }];
}
