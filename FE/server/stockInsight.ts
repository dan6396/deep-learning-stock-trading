import { configuredNewsValidation } from "./newsValidation";
import { getRankPayload } from "./pipelineResults";
import { getBriefing } from "./briefing";
import { modelEvidence } from "../src/types/modelEvidence";
import { stockObservations } from "./stockObservations";
import { safeArticleUrl } from "../src/shared/lib/articleUrl";
import type { StockInsight } from "../src/types/stockInsight";
import { currentHeadlineSummary, readCachedHeadlineSummaries } from "./headlineSummaryCache";
import { cachedArticleContext } from "./articlePrivacy";
import { pipelineOutputDir } from "./pipelineFreshness";
declare const process: { env: Record<string, string | undefined> };
export function createStockInsightService({ rank = getRankPayload, briefing = getBriefing, observations = stockObservations } = {}) {
  return async (code: string, env = process.env): Promise<StockInsight> => {
    if (!/^\d{6}$/.test(code) || code === "000000") throw new Error("유효한 6자리 종목 코드가 필요합니다.");
    const [rows, context, observed] = await Promise.all([rank(env), briefing(env).catch(() => null), observations.get([code])]);
    const row = rows.find(row => row.input_row.ticker === code), model = row ? modelEvidence(row.input_row) : null;
    const index = context?.stocks.findIndex(stock => stock.code === code) ?? -1, top = index >= 0 ? context?.stocks[index] : undefined;
    const opinion = top ? context?.narrative.stockOpinions?.find(stock => stock.code === code) : undefined;
    const articles = top?.news.articles.map(({ id, title, url, source, pubDate }) => ({ id, title, url, source, pubDate })) ?? (row?.news ?? []).flatMap((article, i) => {
      const url = safeArticleUrl(article.url);
      return url && article.title ? [{ id: `N:${code}:${i + 1}`, title: article.title, url, source: article.source ?? "", pubDate: article.pub_date ?? null }] : [];
    }).slice(0, 3);
    const candidate = context?.narrative.newsSummaries?.find(stock => stock.code === code);
    const privateContext = top && context ? await cachedArticleContext(context, pipelineOutputDir(env)) : { articleBodies: {}, articleExcerpts: {} };
    const articleBodies: import("./articleBodies").ArticleBodyContext = privateContext.articleBodies;
    let headline = top && context?.macro ? currentHeadlineSummary(candidate, { ...context, ...privateContext, newsValidation: configuredNewsValidation(env) }, index) : null;
    if (!headline && top && context?.macro && context.model) {
      headline = (await readCachedHeadlineSummaries(context, env)).find(stock => stock.code === code) ?? null;
    }
    const sensitivity = observed.sensitivities[0];
    return { version: 1, code, name: row?.result.company_name ?? code, status: model ? "ready" : "no_model",
      baseDate: row && typeof row.input_row.prediction_base_date === "string" ? row.input_row.prediction_base_date : null, model, sensitivity,
      ...(opinion ? { aiOpinion: { source: opinion.source, text: opinion.text, citations: opinion.citations,
        ...(context?.narrative.generatedAt ? { generatedAt: context.narrative.generatedAt } : {}) } } : {}),
      news: { summary: headline ? headline.text : articles.length ? `관련 기사 ${articles.length}건의 제목·출처·발행 시각을 확인할 수 있습니다.` : "현재 연결된 관련 기사가 없습니다.",
        source: headline ? "llm" : "template", summarySource: headline ? "llm" : "template", ...(headline ? { summaryBasis: headline.summaryBasis } : {}), bodyCollected: articles.some(article => Boolean(articleBodies[article.id])), limitation: !headline ? "기사 목록을 확인할 수 있습니다." : headline.summaryBasis === "body" ? "기사 본문을 바탕으로 작성한 AI 요약입니다." : headline.summaryBasis === "excerpt" ? "기사 발췌를 바탕으로 작성한 AI 요약입니다." : "기사 제목을 바탕으로 작성한 AI 요약입니다.",
        ...(headline?.validation === "off" ? { validation: "off" } : {}), articles, citations: headline ? headline.citations : articles.map(article => article.id) },
      cautions: ["다음 거래일 시가→종가 상대 순위입니다. 하루 등락만으로 모델을 평가하지 않습니다.",
        "입력 특징의 백분위는 모델 기여도나 인과 설명이 아닙니다.",
        ...(model?.agreement === "불일치" ? ["20일·120일 모델의 상대 순위 차이가 비교 종목 수의 25%를 넘습니다."] : []),
        ...(sensitivity.status !== "ready" ? ["과거 통계는 유효 관측 200일 이상 확보 후 표시합니다."] : ["최근 1년 표본에 한정된 관측이며 미래 결과를 보장하지 않습니다."]),
        ...(!sensitivity.complete && sensitivity.status === "ready" ? ["일부 거래일이 누락될 수 있어 제공된 표본 수를 함께 확인해야 합니다."] : [])],
      data_meta: { source: "cache", asOf: context?.model?.runStartedAt ?? null } };
  };
}
export const getStockInsight = createStockInsightService();
