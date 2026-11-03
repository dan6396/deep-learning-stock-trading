// Three extra available pre-open indicators whose analysis bands all imply 상승 요인
// (USD/KRW and rates falling, SOX rising), so a fixture's own row plus these meets
// MIN_DIRECTIONAL_OUTLOOK_INDICATORS (3) as an agreeing majority for 상승 우위.
export const extraOutlookIndicators = () => [
  { id: "USDKRW", name: "원/달러 환율", status: "ok", unit: "원", value: 1400, change: -1, changePct: -.07, fiveDayChange: -2, fiveDayChangePct: -.14, history: [], comment: { text: "환율 관측 자료입니다.", ruleId: "USDKRW:하락", band: "하락", metric: -.14 } },
  { id: "UST10Y", name: "미국 국채 10년 금리", status: "ok", unit: "%", value: 4.2, change: -.01, changePct: -.24, fiveDayChange: -.02, fiveDayChangePct: -.48, history: [], comment: { text: "금리 관측 자료입니다.", ruleId: "UST10Y:하락", band: "하락", metric: -.48 } },
  { id: "SOX", name: "필라델피아 반도체 지수", status: "ok", unit: "pt", value: 5000, change: 10, changePct: .2, fiveDayChange: 100, fiveDayChangePct: 2, history: [], comment: { text: "반도체 지수 관측 자료입니다.", ruleId: "SOX:상승", band: "상승", metric: 2 } },
];
export const withOutlookIndicators = data => ({ ...data, macro: { ...data.macro, preOpen: [...(data.macro.preOpen ?? []), ...extraOutlookIndicators()] } });
