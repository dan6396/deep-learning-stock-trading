export type RunKind = "official" | "adhoc";
export type RunMode = "model_only" | "full";
export type OutcomeState = "waiting" | "complete" | "unavailable";
export type FrozenPrediction = { code: string; name: string; baseDate: string; prediction: number; rank: number; selected: boolean };
export type PriceOutcome = { code: string; date: string; open: number; close: number; actualReturn: number; source: "kis"; collectedAt: string };
export type AnalysisRecord = {
  version: 1; runId: string; kind: RunKind; mode: RunMode; status: "running" | "completed" | "failed";
  startedAt: string; finishedAt: string | null; baseDate: string | null; targetDate: string | null;
  predictions: FrozenPrediction[]; predictionHash: string | null;
  officialEligible: boolean | null; reason: string; error: string | null;
  outcomes: PriceOutcome[]; outcomeState: OutcomeState; lastCollectedAt: string | null;
};
export type PerformanceRun = Omit<AnalysisRecord, "predictions" | "predictionHash" | "outcomes"> & {
  predictedCount: number; selectedCount: number; measuredCount: number;
  actualReturn: number | null; predictedReturn: number | null; hitRate: number | null;
  measurements: { code: string; name: string; predictedReturn: number; date: string | null; open: number | null; close: number | null; actualReturn: number | null }[];
};
export type PerformanceSummary = {
  mode: RunMode; tradingDays: number; measuredRuns: number; averageReturn: number | null;
  cumulativeReturn: number | null; hitRate: number | null;
};
export type PerformancePayload = {
  version: 1; source: "cache"; asOf: string | null; runs: PerformanceRun[]; summaries: PerformanceSummary[];
  reasons: string[]; collector: { status: "idle" | "running" | "completed" | "failed"; checkedAt: string | null; error: string | null };
};
