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
