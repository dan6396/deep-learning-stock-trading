import { nextKrxSession } from "./krxCalendar";

type Calendar = (date: string) => string | null;
export function marketClock(now: number, calendar: Calendar = nextKrxSession) {
  const date = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
  const previous = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const confirmed = calendar(previous);
  const trading = confirmed === date;
  const open = Date.parse(`${date}T09:00:00+09:00`), close = Date.parse(`${date}T15:30:00+09:00`);
  return { date, trading, known: confirmed !== null, open, close, active: trading && now >= open && now < close };
}

/** Unconfirmed years cannot establish holidays or delayed-opening sessions. */
export function intradayQueryCursor(now: number, calendar: Calendar = nextKrxSession): string {
  const clock = marketClock(now, calendar);
  // Stay conservative when the year is unknown, including all unknown weekends.
  // Special delayed-opening hours remain outside this fixed-session policy.
  if (!clock.active) return "153000";
  return new Date(now + 9 * 3_600_000).toISOString().slice(11, 16).replace(/:/g, "") + "00";
}

/** Only the current date or a calendar-confirmed immediately preceding session. */
export function isRecentMarketSession(day: string, now: number, calendar: Calendar = nextKrxSession): boolean {
  const today = marketClock(now, calendar).date;
  if (day === today) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) return false;
  const previous = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000);
  if (!Number.isFinite(previous.getTime())) return false;
  const next = calendar(day);
  return calendar(previous.toISOString().slice(0, 10)) === day && next !== null && next >= today;
}

/** Repair failures survive otherwise successful bundle writes (60s, 120s, ... 10m). */
export function intradayRepairRetryAt(state?: { repairFailedAt?: number; repairFailures?: number }): number {
  if (!state || !Number.isFinite(state.repairFailedAt)) return 0;
  const count = Math.max(1, state.repairFailures ?? 1);
  return state.repairFailedAt! + Math.min(600_000, 60_000 * 2 ** Math.min(count - 1, 4));
}

/** Intraday observations must get a final closing refresh, then rest until the next open. */
export function marketCacheExpiry(builtAt: number, ttl: number, daily = false, calendar: Calendar = nextKrxSession): number {
  const clock = marketClock(builtAt, calendar);
  if (!clock.known) return builtAt + ttl; // A missing calendar must never freeze data indefinitely.
  if (daily && clock.trading && builtAt < clock.close) return clock.close; // Finalize a still-forming daily bar.
  if (!daily && clock.active) return Math.min(builtAt + ttl, clock.close);
  const next = clock.trading && builtAt < clock.open ? clock.date : calendar(clock.date);
  if (!next) return builtAt + ttl;
  return Date.parse(`${next}T${daily ? "15:30:00" : "09:00:00"}+09:00`);
}
