import { finiteNumber } from "../../entities/value";
export const MISSING_VALUE = "—";

export function formatNumber(value: unknown, digits = 0): string {
  const number = finiteNumber(value);
  return number === null ? MISSING_VALUE : new Intl.NumberFormat("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Object.is(number, -0) ? 0 : number);
}

export function formatWon(value: unknown): string {
  const text = formatNumber(value);
  return text === MISSING_VALUE ? text : `${text}원`;
}

/** Predictions are fractions (0.01 = 1%); quote changeRate is already percent. */
export function formatPercent(value: unknown, unit: "fraction" | "percent" = "fraction", digits = 2): string {
  const number = finiteNumber(value);
  if (number === null) return MISSING_VALUE;
  const percent = unit === "fraction" ? number * 100 : number;
  if (!Number.isFinite(percent)) return MISSING_VALUE;
  const rounded = Number(percent.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${formatNumber(rounded, digits)}%`;
}

export function formatDate(value: unknown, includeTime = false): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return MISSING_VALUE;
  const day = value.slice(0, 10), parsedDay = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== day) return MISSING_VALUE;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return MISSING_VALUE;
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).format(date);
}

export function formatAgreement(ratio: number | null): string {
  return ratio !== null && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? formatPercent(ratio, "fraction", 0).replace(/^\+/, "") : MISSING_VALUE;
}
