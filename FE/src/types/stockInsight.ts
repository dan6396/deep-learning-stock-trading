import type { ModelEvidence } from "./modelEvidence";
export type SensitivityMetric = { definition: "close_to_close" | "open_to_close"; correlation: number; beta: number; samples: number };
export type NasdaqSensitivity = {
  status: "ready" | "preparing"; samples: number; periodStart: string | null; periodEnd: string | null;
  metrics: SensitivityMetric[]; conditional: { count: number; total: number; ratioPct: number; baselinePct: number; baselineCount: number; baselineTotal: number } | null;
  source: string; note: string; complete: boolean;
};
export type Diversification = {
  status: "ready" | "preparing"; codes: string[]; samples: number; periodStart: string | null; periodEnd: string | null;
  matrix: (number | null)[][]; averageCorrelation: number | null;
  highestPair: { codes: [string, string]; correlation: number } | null;
  nasdaqBetas: { code: string; closeToClose: number; openToClose: number; samples: number }[];
  commonRisks: string[]; note: string;
};
export type StockInsight = {
  version: 1; code: string; name: string; status: "ready" | "no_model"; baseDate: string | null;
  model: ModelEvidence | null; sensitivity: NasdaqSensitivity;
  news: { summary: string; source: "llm" | "template"; bodyCollected: false; limitation: string;
    articles: { id: string; title: string; url: string; source: string; pubDate: string | null }[]; citations: string[] };
  cautions: string[]; data_meta: { source: "cache"; asOf: string | null };
};
