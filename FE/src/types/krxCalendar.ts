/**
 * Built-in KRX (stock market) closure days, used when the KIS holiday calendar is unavailable
 * (it requires a real-trading app key). Weekends are closed implicitly.
 * Sources checked 2026-10-11: KRX year-start/year-end notices via press, brokerage holiday notices,
 * calendarlabs KRX 2026. Update this table each year and on any temporary holiday announcement.
 */
const KRX_CLOSED_DAYS: Record<number, readonly string[]> = {
  2026: [
    "2026-01-01", // 신정
    "2026-02-16", "2026-02-17", "2026-02-18", // 설날
    "2026-03-02", // 삼일절 대체공휴일
    "2026-05-01", // 근로자의 날
    "2026-05-05", // 어린이날
    "2026-05-25", // 부처님오신날 대체공휴일
    "2026-06-03", // 전국동시지방선거
    "2026-07-17", // 제헌절
    "2026-08-17", // 광복절 대체공휴일
    "2026-09-24", "2026-09-25", // 추석
    "2026-10-05", // 개천절 대체공휴일
    "2026-10-09", // 한글날
    "2026-12-25", // 성탄절
    "2026-12-31", // 연말 휴장
  ],
};

function isoDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Next KRX session after baseDate, or null when the date falls outside the covered years. */
export function nextKrxSession(baseDate: string): string | null {
  const base = isoDay(baseDate);
  if (!base) return null;
  for (let offset = 1; offset <= 31; offset++) {
    const date = new Date(base.getTime() + offset * 86_400_000), day = date.toISOString().slice(0, 10);
    const closed = KRX_CLOSED_DAYS[date.getUTCFullYear()];
    if (!closed) return null; // Never guess a year whose closures are not recorded.
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !closed.includes(day)) return day;
  }
  return null;
}
