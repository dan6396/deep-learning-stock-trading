import { getPerformancePayload } from "./performance";
import { getBriefingSectors } from "./kisBriefing";
import type { PerformancePayload, PerformanceRun } from "../src/types/performance";
import type { BriefingInput } from "./briefing";
import type { KisReadOptions } from "./revalidatingCache";
declare const process: { env: Record<string, string | undefined> };
export type BriefingComposition = {
  basis: "equal_weight_reference"; note: "최적화하지 않은 동일 비중(각 20%) 참고 구성입니다. 투자 권유가 아닙니다.";
  sectors: { name: string; codes: string[] }[] | null; sectorSource: string | null;
  performance: { asOf: string | null; measuredDays: number; averageReturnPct: number | null; positiveDays: number;
    recent: { date: string; returnPct: number }[] } | null; commonCautions: string[];
};
export function compositionPerformance(payload: PerformancePayload): NonNullable<BriefingComposition["performance"]> {
  const selected = payload.runs.filter(run => run.mode === "model_only" && run.modelId === "plain_20_120_rank_mean_v1" && run.scoreKind === "rank_zscore"
    && run.kind === "official" && run.officialEligible === true && run.outcomeState === "complete" && typeof run.actualReturn === "number" && Number.isFinite(run.actualReturn) && run.targetDate);
  // Match summarizePerformance: sort, keep one official equal-weight portfolio per target date; never recompute per-stock returns.
  selected.sort((a, b) => b.targetDate!.localeCompare(a.targetDate!));
  const unique = [...new Map(selected.map(run => [run.targetDate, run])).values()].slice(0, 10) as (PerformanceRun & { targetDate: string; actualReturn: number })[];
  const recent = unique.map(run => ({ date: run.targetDate, returnPct: run.actualReturn * 100 }));
  return { asOf: payload.asOf, measuredDays: recent.length, averageReturnPct: recent.length ? recent.reduce((sum, row) => sum + row.returnPct, 0) / recent.length : null,
    positiveDays: recent.filter(row => row.returnPct > 0).length, recent };
}
export function createCompositionProvider(performance = getPerformancePayload, sectors = getBriefingSectors) {
  return async (input: BriefingInput, env = process.env, options: KisReadOptions = {}): Promise<BriefingComposition> => {
    const [history, classification] = await Promise.all([performance(env).then(compositionPerformance).catch(() => null),
      sectors(input.stocks.map(stock => stock.code), env, options).catch(() => ({ sectors: null, sectorSource: null }))]);
    return buildBriefingComposition(input, history, classification);
  };
}
export function buildBriefingComposition(input: BriefingInput, history: BriefingComposition["performance"] = null,
  classification: Pick<BriefingComposition, "sectors" | "sectorSource"> = { sectors: null, sectorSource: null }): BriefingComposition {
    const cautions: string[] = [];
    if (input.stocks.length && input.stocks.every(stock => !stock.news.articles.length)) cautions.push("모든 후보 종목에서 확인된 관련 기사가 없습니다.");
    if (input.macro.indicators.some(indicator => indicator.status !== "ok")) cautions.push("일부 시장 지표를 확보하지 못했습니다.");
    if (input.stocks.length !== 5) cautions.push("유효한 TOP5 후보 구성이 완성되지 않았습니다.");
    if (!classification.sectors) cautions.push("업종 분류를 확인하지 못했습니다.");
    if (history === null) cautions.push("공식 성과 자료를 확인하지 못했습니다.");
    return { basis: "equal_weight_reference", note: "최적화하지 않은 동일 비중(각 20%) 참고 구성입니다. 투자 권유가 아닙니다.",
      ...classification, performance: history, commonCautions: cautions };
}
export const getBriefingComposition = createCompositionProvider();
