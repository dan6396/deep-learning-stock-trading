import type { PreOpenIndicator, PreOpenMacroId } from "../src/types/preOpenMacro";

/** Editable wording/threshold table. These provisional rules never predict KOSPI. */
export const MACRO_COMMENT_RULES: Record<PreOpenMacroId, { threshold: number; up: string; down: string; flat: string }> = {
  UST10Y: { threshold: 0.01, up: "최근 관측 구간에서 금리가 높아졌습니다", down: "최근 관측 구간에서 금리가 낮아졌습니다", flat: "최근 관측 구간의 금리 변화가 작습니다" },
  NASDAQ: { threshold: 0.1, up: "최근 관측 구간에서 나스닥이 상승했습니다", down: "최근 관측 구간에서 나스닥이 하락했습니다", flat: "최근 관측 구간의 나스닥 변화가 작습니다" },
  USDKRW: { threshold: 1, up: "최근 관측 구간에서 원·달러 환율이 올랐습니다", down: "최근 관측 구간에서 원·달러 환율이 내렸습니다", flat: "최근 관측 구간의 환율 변화가 작습니다" },
  KOSPI200_FOREIGN_FUTURES: { threshold: 1, up: "외국인 선물 수급 합계는 순매수입니다", down: "외국인 선물 수급 합계는 순매도입니다", flat: "외국인 선물 수급 합계는 보합입니다" },
};
export function macroComment(row: Omit<PreOpenIndicator, "comment">): PreOpenIndicator["comment"] {
  if (row.status !== "ok") return { text: row.id === "KOSPI200_FOREIGN_FUTURES" ? "데이터 출처 확인 중" : "직전 미국장 기준 관측 자료가 없습니다", placeholder: true, ruleId: "unavailable" };
  if (row.id === "KOSPI200_FOREIGN_FUTURES") {
    const sum = row.fiveDaySum ?? 0, streak = row.consecutiveDays ?? 0, rule = MACRO_COMMENT_RULES[row.id];
    const state = sum >= rule.threshold ? "up" : sum <= -rule.threshold ? "down" : "flat";
    return { text: `외국인 선물은 ${row.history.length}거래일 합계 ${sum > 0 ? "+" : ""}${sum.toLocaleString("ko-KR")}계약입니다. ${rule[state]}.${streak ? ` 외국인 선물은 ${Math.abs(streak)}거래일 연속 순매${streak > 0 ? "수" : "도"}입니다.` : ""}`, placeholder: true, ruleId: `${row.id}:${state}` };
  }
  if (row.history.length < 2 || row.fiveDayChange === null) return { text: "추세를 비교할 관측일이 부족합니다", placeholder: true, ruleId: "insufficient" };
  const rule = MACRO_COMMENT_RULES[row.id], delta = row.id === "NASDAQ" ? row.fiveDayChangePct ?? 0 : row.fiveDayChange;
  const state = delta > rule.threshold ? "up" : delta < -rule.threshold ? "down" : "flat";
  const change = row.id === "NASDAQ" ? row.fiveDayChangePct! : row.fiveDayChange;
  const unit = row.id === "UST10Y" ? "%p" : row.id === "NASDAQ" ? "%" : row.unit === "KRW" ? "원" : row.unit;
  return { text: `${rule[state]}. ${row.history.length}개 관측일의 첫날 대비 ${change > 0 ? "+" : ""}${Number(change.toFixed(row.unit === "%" ? 3 : 2))}${unit}입니다.`, placeholder: true, ruleId: `${row.id}:${state}` };
}
