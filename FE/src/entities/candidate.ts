import { resultMeta, type DataResult } from "./source";
import { finiteNumber, nonnegativeInteger, nullableBoolean, record, stockCode, textValue } from "./value";
import { isNewsCollectionSuccess } from "../types/newsCollection";

export type Sentiment = "positive" | "neutral" | "negative";
export type NewsTally = { positive: number; neutral: number; negative: number };
export type CandidateNews = {
  title: string | null; url: string | null; source: string | null; publishedAt: string | null;
  sentiment: Sentiment | null;
  reason?: string | null; description?: string | null;
};
export type CandidateData = {
  code: string; name: string | null; isFinalCandidate: boolean;
  predictedReturn: number | null; finalPredictedReturn: number | null;
  rank: number | null; poolSize: number | null; baseDate: string | null;
  finalRank?: number | null;
  predictionTarget: string | null; nextTradingDay: null;
  summary: string | null; tradingInsight: string | null;
  news: CandidateNews[]; newsCollected: boolean; newsMethod: "llm" | "keyword" | "unknown";
  newsStatus: string | null;
  newsTally: NewsTally | null;
  supply: {
    foreignNetBuy: number | null; institutionNetBuy: number | null; combinedNetBuy: number | null;
    foreignPositiveDays: number | null; institutionPositiveDays: number | null;
    combinedPositiveDays: number | null; window: number | null; dataDays: number | null;
    enough: boolean | null; status: string | null;
  };
};

function sentiment(value: unknown): Sentiment | null {
  const text = textValue(value)?.toUpperCase();
  return text === "POSITIVE" || text === "BULLISH" ? "positive"
    : text === "NEGATIVE" || text === "BEARISH" ? "negative"
      : text === "NEUTRAL" ? "neutral" : null;
}

function tally(value: unknown): NewsTally | null {
  const object = record(value);
  let positive = nonnegativeInteger(object.positive);
  let neutral = nonnegativeInteger(object.neutral);
  let negative = nonnegativeInteger(object.negative);
  if (typeof value === "string") {
    positive = nonnegativeInteger(value.match(/긍정\s*(\d+)\s*건/)?.[1]);
    neutral = nonnegativeInteger(value.match(/중립\s*(\d+)\s*건/)?.[1]);
    negative = nonnegativeInteger(value.match(/부정\s*(\d+)\s*건/)?.[1]);
  }
  return positive !== null && neutral !== null && negative !== null ? { positive, neutral, negative } : null;
}

export function adaptCandidate(value: unknown, isFinalCandidate = false): DataResult<CandidateData> {
  const row = record(value), input = record(row.input_row), result = record(row.result), meta = record(row.data_meta);
  const resultCode = stockCode(result.ticker), inputCode = stockCode(input.ticker);
  if (resultCode && inputCode && resultCode !== inputCode) throw new Error("분석 응답의 종목 코드가 서로 다릅니다.");
  const code = resultCode ?? inputCode;
  if (!code) throw new Error("분석 응답에 유효한 종목 코드가 없습니다.");
  const news = Array.isArray(row.news) ? row.news.map(item => {
    const article = record(item);
    return {
      title: textValue(article.title), url: textValue(article.url), source: textValue(article.source),
      publishedAt: textValue(article.pub_date), sentiment: sentiment(article.sentiment),
      reason: textValue(article.sentiment_reason ?? article.reason), description: textValue(article.description),
    };
  }) : [];
  const methodValue = meta.newsMethod ?? input.news_method;
  // Old CSV output has news:[] even when collection never ran. Absence alone proves nothing.
  const rawStatus = textValue(meta.newsStatus ?? input.news_analysis_status)?.toLowerCase() ?? null;
  const newsCollected = isNewsCollectionSuccess(rawStatus) && (meta.newsCollected === true || (meta.newsCollected !== false && input.news_collected === true));
  const points = Array.isArray(result.key_data_points) ? result.key_data_points : [];
  const explicitTally = tally(Object.prototype.hasOwnProperty.call(meta, "newsTally") ? meta.newsTally : input.news_sentiment_tally ?? points.find(point => typeof point === "string" && /긍정\s*\d+\s*건/.test(point)));
  const newsMethod = methodValue === "keyword" ? "keyword"
      : methodValue === "llm" || (methodValue == null && (explicitTally !== null || news.some(item => item.sentiment !== null))) ? "llm" : "unknown";
  const hasExplicitEvidence = newsMethod === "llm" && (news.some(item => item.sentiment !== null) || (explicitTally !== null && Object.values(explicitTally).some(count => count > 0)));
  const foreignNetBuy = finiteNumber(input.foreign_net_buy_sum), institutionNetBuy = finiteNumber(input.inst_net_buy_sum);
  const combinedNetBuy = foreignNetBuy !== null && institutionNetBuy !== null ? finiteNumber(foreignNetBuy + institutionNetBuy) : null;
  const rawFinalRank = nonnegativeInteger(Object.prototype.hasOwnProperty.call(meta, "rawFinalRank") ? meta.rawFinalRank : input.final_rank);
  return {
    ...resultMeta(row, { source: "cache" }),
    data: {
      code, name: textValue(result.company_name ?? input.company_name), isFinalCandidate,
      predictedReturn: finiteNumber(input.ensemble_pred_return),
      finalPredictedReturn: finiteNumber(Object.prototype.hasOwnProperty.call(meta, "rawFinalPrediction") ? meta.rawFinalPrediction : input.final_pred_return),
      rank: nonnegativeInteger(Object.prototype.hasOwnProperty.call(meta, "rawModelRank") ? meta.rawModelRank : input.pred_rank), poolSize: nonnegativeInteger(input.pred_pool_size),
      finalRank: rawFinalRank !== null && rawFinalRank >= 1 ? rawFinalRank : null,
      baseDate: textValue(input.prediction_base_date ?? input.transformer_base_date ?? input.lstm_base_date),
      predictionTarget: textValue(input.prediction_target), nextTradingDay: null,
      summary: textValue(result.summary), tradingInsight: textValue(result.trading_insight),
      news, newsCollected, newsMethod, newsTally: explicitTally,
      newsStatus: rawStatus ?? (hasExplicitEvidence ? "llm_evidence" : null),
      supply: {
        foreignNetBuy, institutionNetBuy, combinedNetBuy,
        foreignPositiveDays: nonnegativeInteger(input.foreign_positive_days),
        institutionPositiveDays: nonnegativeInteger(input.inst_positive_days),
        combinedPositiveDays: nonnegativeInteger(input.combined_positive_days),
        window: nonnegativeInteger(input.supply_window), dataDays: nonnegativeInteger(input.supply_data_days),
        enough: nullableBoolean(input.supply_data_enough),
        status: textValue(input.supply_status),
      },
    },
  };
}
