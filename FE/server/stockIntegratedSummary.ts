import type { BriefingInput } from "./briefing";
import type { BriefingNarrative } from "./briefingNarrative";
import { cachedArticleContext } from "./articlePrivacy";
import { currentHeadlineSummary, readCachedHeadlineSummaries } from "./headlineSummaryCache";
import { configuredNewsValidation } from "./newsValidation";
import { pipelineOutputDir } from "./pipelineFreshness";
import { integratedCitations, integratedStockOpinion, integratedSummaryReason, type IntegratedPieces } from "./stockOpinionSummary";
import type { StockAiOpinion } from "../src/types/stockOpinion";

/**
 * /stock "AI 최종 의견".
 * AI 문단 후보(narrative.stockSummaries)는 기존 브리핑 Gemini 호출 한 번의 응답에 함께 들어 있다(추가 호출 없음).
 * 조회 때 /stock이 실제로 쓰는 조각(순위·브리핑 시장 의견·뉴스 요약·종목 분석)으로 다시 검증하고,
 * 없거나 실패하면 규칙 연결 문단(integratedStockOpinion)으로 대체한다.
 */
export type { IntegratedPieces } from "./stockOpinionSummary";
type BriefingContext = BriefingInput & { narrative: BriefingNarrative };
type Env = Record<string, string | undefined>;

/** 브리핑 컨텍스트에서 TOP5 종목별 통합 조각을 만든다. 뉴스 요약 선택은 기존 /stock 규칙과 같다. */
export async function briefingStockPieces(context: BriefingContext, env: Env): Promise<IntegratedPieces[]> {
  const privateContext = await cachedArticleContext(context, pipelineOutputDir(env));
  const input = { ...context, ...privateContext, newsValidation: configuredNewsValidation(env) };
  let cached: Awaited<ReturnType<typeof readCachedHeadlineSummaries>> | null = null;
  const pieces: IntegratedPieces[] = [];
  for (const [index, stock] of context.stocks.entries()) {
    const opinion = context.narrative.stockOpinions?.find(row => row.code === stock.code) ?? null;
    let news = context.macro ? currentHeadlineSummary(context.narrative.newsSummaries?.find(row => row.code === stock.code), input, index) : null;
    if (!news && context.macro && context.model) news = (cached ??= await readCachedHeadlineSummaries(context, env)).find(row => row.code === stock.code) ?? null;
    pieces.push({ code: stock.code, name: stock.name, rank: stock.rank, poolSize: stock.poolSize, topPercent: stock.topPercent, metrics: stock.analysisMetrics ?? null, cautions: (stock.cautions ?? []).map(row => row.text), outlook: context.narrative.marketOutlook ?? null, news, opinion,
      ...(context.narrative.generatedAt ? { generatedAt: context.narrative.generatedAt } : {}) });
  }
  return pieces;
}

/** Gemini를 호출하지 않는다. 같은 호출에서 받은 후보를 현재 조각으로 다시 검증해 쓰고, 아니면 규칙 연결 문단을 쓴다. */
export function resolveIntegratedOpinion(pieces: IntegratedPieces, candidate?: string | null): StockAiOpinion {
  if (candidate && integratedSummaryReason(candidate, pieces) === null) {
    return { source: "llm", composition: "ai", text: candidate.normalize("NFKC").trim(), citations: integratedCitations(pieces), ...(pieces.generatedAt ? { generatedAt: pieces.generatedAt } : {}) };
  }
  const stitched = integratedStockOpinion(pieces);
  return stitched.source === "llm" ? { ...stitched, composition: "rule" } : stitched;
}
