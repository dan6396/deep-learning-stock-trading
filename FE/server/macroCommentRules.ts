import type { PreOpenIndicator, PreOpenMacroId } from "../src/types/preOpenMacro";

/** Editable wording/threshold table. These provisional rules never predict KOSPI. */
export const MACRO_COMMENT_RULES: Record<PreOpenMacroId, { threshold: number; up: string; down: string; flat: string }> = {
  UST10Y: { threshold: 0.01, up: "최근 관측 구간에서 금리가 높아졌습니다", down: "최근 관측 구간에서 금리가 낮아졌습니다", flat: "최근 관측 구간의 금리 변화가 작습니다" },
  NASDAQ: { threshold: 0.1, up: "최근 관측 구간에서 나스닥이 상승했습니다", down: "최근 관측 구간에서 나스닥이 하락했습니다", flat: "최근 관측 구간의 나스닥 변화가 작습니다" },
  USDKRW: { threshold: 1, up: "최근 관측 구간에서 원·달러 환율이 올랐습니다", down: "최근 관측 구간에서 원·달러 환율이 내렸습니다", flat: "최근 관측 구간의 환율 변화가 작습니다" },
  KOSPI200_FOREIGN_FUTURES: { threshold: 1, up: "외국인 선물 순매수 관측치가 증가했습니다", down: "외국인 선물 순매수 관측치가 감소했습니다", flat: "외국인 선물 순매수 관측치 변화가 작습니다" },
};
export function macroComment(row: Omit<PreOpenIndicator, "comment">): PreOpenIndicator["comment"] {
  if (row.status !== "ok") return { text: row.id === "KOSPI200_FOREIGN_FUTURES" ? "데이터 출처 확인 중" : "직전 미국장 기준 관측 자료가 없습니다", placeholder: true, ruleId: "unavailable" };
  if (row.history.length < 2 || row.fiveDayChange === null) return { text: "추세를 비교할 관측일이 부족합니다", placeholder: true, ruleId: "insufficient" };
  const rule = MACRO_COMMENT_RULES[row.id], delta = row.id === "NASDAQ" ? row.fiveDayChangePct ?? 0 : row.fiveDayChange;
  const state = delta > rule.threshold ? "up" : delta < -rule.threshold ? "down" : "flat";
  const change = row.id === "NASDAQ" ? row.fiveDayChangePct! : row.fiveDayChange;
  const unit = row.id === "UST10Y" ? "%p" : row.id === "NASDAQ" ? "%" : row.unit === "KRW" ? "원" : row.unit;
  return { text: `${rule[state]}. ${row.history.length}개 관측일의 첫날 대비 ${change > 0 ? "+" : ""}${Number(change.toFixed(row.unit === "%" ? 3 : 2))}${unit}입니다.`, placeholder: true, ruleId: `${row.id}:${state}` };
}
