import { getRankPayload } from "./pipelineResults";
import { getBriefing } from "./briefing";
import { modelEvidence } from "../src/types/modelEvidence";
import { stockObservations } from "./stockObservations";
import { safeArticleUrl } from "../src/shared/lib/articleUrl";
import type { StockInsight } from "../src/types/stockInsight";
declare const process: { env: Record<string, string | undefined> };
export function createStockInsightService({ rank = getRankPayload, briefing = getBriefing, observations = stockObservations } = {}) {
  return async (code: string, env = process.env): Promise<StockInsight> => {
    if (!/^\d{6}$/.test(code) || code === "000000") throw new Error("유효한 6자리 종목 코드가 필요합니다.");
    const [rows, context, observed] = await Promise.all([rank(env), briefing(env).catch(() => null), observations.get([code])]);
    const row = rows.find(row => row.input_row.ticker === code), model = row ? modelEvidence(row.input_row) : null;
    const top = context?.stocks.find(stock => stock.code === code), narrative = context?.narrative.stocks.find(stock => stock.code === code);
    const articles = top?.news.articles ?? (row?.news ?? []).flatMap((article, i) => {
      const url = safeArticleUrl(article.url);
      return url && article.title ? [{ id: `N:${code}:${i + 1}`, title: article.title, url, source: article.source ?? "", pubDate: article.pub_date ?? null }] : [];
    }).slice(0, 3);
    const usable = narrative?.source === "llm" && context?.narrative.status === "llm"
      && narrative.citations.some(id => articles.some(article => article.id === id));
    const sensitivity = observed.sensitivities[0];
    return { version: 1, code, name: row?.result.company_name ?? code, status: model ? "ready" : "no_model",
      baseDate: row && typeof row.input_row.prediction_base_date === "string" ? row.input_row.prediction_base_date : null, model, sensitivity,
      news: { summary: usable ? narrative.summary : articles.length ? `관련 기사 ${articles.length}건의 제목·출처·발행 시각을 확인할 수 있습니다.` : "현재 연결된 관련 기사가 없습니다.",
        source: usable ? "llm" : "template", bodyCollected: false, limitation: "기사 본문을 수집하지 않았습니다. 제목 기반 요약이며 사실 확인이나 호재·악재 판정이 아닙니다.",
        articles, citations: usable ? narrative.citations.filter(id => articles.some(article => article.id === id)) : articles.map(article => article.id) },
      cautions: ["다음 거래일 시가→종가 상대 순위입니다. 하루 등락만으로 모델을 평가하지 않습니다.",
        "입력 특징의 백분위는 모델 기여도나 인과 설명이 아닙니다.",
        ...(model?.agreement === "불일치" ? ["20일·120일 모델의 상대 순위 차이가 비교 종목 수의 25%를 넘습니다."] : []),
        ...(sensitivity.status !== "ready" ? ["과거 통계는 유효 관측 200일 이상 확보 후 표시합니다."] : ["최근 1년 표본에 한정된 관측이며 미래 결과를 보장하지 않습니다."]),
        ...(!sensitivity.complete && sensitivity.status === "ready" ? ["일부 거래일이 누락될 수 있어 제공된 표본 수를 함께 확인해야 합니다."] : [])],
      data_meta: { source: "cache", asOf: context?.model?.runStartedAt ?? null } };
  };
}
export const getStockInsight = createStockInsightService();
