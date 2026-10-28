export type PreOpenMacroId = "UST10Y" | "NASDAQ" | "USDKRW" | "KOSPI200_FOREIGN_FUTURES";
export type MacroObservation = { date: string; value: number };
export type PreOpenIndicator = {
  id: PreOpenMacroId; name: string; value: number | null; change: number | null; changePct: number | null;
  unit: "%" | "pt" | "KRW" | "계약"; history: MacroObservation[]; asOf: string | null;
  fiveDayChange: number | null; fiveDayChangePct: number | null;
  fiveDaySum?: number | null; consecutiveDays?: number;
  source: "yahoo" | "kis" | "unknown"; status: "ok" | "unavailable";
  comment: { text: string; placeholder: true; ruleId: string };
};
export const OUTLOOK_STANCES = ["상승 우위", "하락 우위", "중립", "판단 보류"] as const;
export type MarketOutlook = { stance: typeof OUTLOOK_STANCES[number]; text: string; citations: string[]; source?: "llm" | "template" };
export type HeadlineSummary = { code: string; text: string; citations: string[]; source?: "llm" | "template"; summaryBasis?: "body" | "title"; sentenceCitations?: string[][] };
