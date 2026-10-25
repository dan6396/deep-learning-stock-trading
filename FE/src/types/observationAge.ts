import { nextKrxSession } from "./krxCalendar";
const DAY = 86_400_000;
/** Intraday: thirty minutes. Otherwise: latest completed KRX close, including holidays. */
export function pastObservation(asOf: string | null | undefined, now = Date.now()): boolean {
  if (!asOf) return false;
  const observed = Date.parse(asOf); if (!Number.isFinite(observed) || observed > now) return false;
  const day = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
  const previous = (date: string) => new Date(Date.parse(date) - DAY).toISOString().slice(0, 10);
  const session = nextKrxSession(previous(day)), close = Date.parse(`${day}T15:30:00+09:00`), open = Date.parse(`${day}T09:00:00+09:00`);
  if (!session) return now - observed > 30 * 60_000;
  if (session === day && now >= open && now < close) return now - observed > 30 * 60_000;
  let completed = session === day && now >= close ? day : previous(day);
  for (let count = 0; count < 31; count++, completed = previous(completed)) {
    if (nextKrxSession(previous(completed)) === completed) return observed < Date.parse(`${completed}T15:30:00+09:00`);
  }
  return now - observed > 30 * 60_000;
}
