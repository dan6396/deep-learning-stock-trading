// 출처: 사용자가 제공한 발표 시연용 모의투자 고정 기록(2026-10-06~2026-10-08).
// API·실시간 성과와 독립된 기록이며, 실제 투자 수익 또는 미래 수익을 뜻하지 않는다.
export const PAPER_TRADING = {
  startDate: "2026-10-06", endDate: "2026-10-08", tradingDays: 3, initialCapital: 10_000_000,
  finalCapital: 9_761_000, modelReturnPercent: -2.39, benchmarkReturnPercent: -5.65,
  benchmarkStart: 1107.04, benchmarkEnd: 1044.52, excessReturnPoints: 3.26,
} as const;
