import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PipelineInputRow, PipelineOutputRow, StockQuote } from "../src/types/trading";
import { readLastSnapshot, writeDashboardSnapshot } from "./dashboardCache";
import { isFreshForRun, readPipelineRunMarker, type PipelineRunMarker } from "./pipelineFreshness";
import { isNewsCollectionSuccess } from "../src/types/newsCollection";
import type { PipelineAvailability } from "../src/types/backendStatus";

declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
};

const JSON_RESULT_FILES = ["final_stock_transformer_news_llm_result.json"];
const LEGACY_JSON_RESULT_FILES = ["final_stock_lstm_news_llm_result.json"];
const CSV_RESULT_FILES = ["step3_final_top5.csv", "step2_final_top10.csv"];
const FULL_RANK_CSV_RESULT_FILES = ["step2_all_transformer_rank.csv"];
const NEWS_RESULT_FILES = ["news_gemini_result.json", "step3_final_news_llm_analysis.json"];
const EVENT_RESULT_FILES = ["step3_final_news_event_analysis.json"];

type EventNewsItem = {
  title?: unknown;
  url?: unknown;
  source?: unknown;
  pub_date?: unknown;
  sentiment?: unknown;
  reason?: unknown;
  evidence_quote?: unknown;
};

type EventEntry = {
  ticker?: unknown;
  company_name?: unknown;
  news?: EventNewsItem[];
  status?: unknown;
  accepted_events?: unknown;
  applied?: unknown;
  news_delta?: unknown;
  final_score?: unknown;
  final_rank?: unknown;
  final_rank_percentile?: unknown;
  activation_reason?: unknown;
};

type GeminiEvaluation = {
  sentiment?: unknown;
  impact_score?: unknown;
  final_sentiment?: unknown;
  final_combined_score?: unknown;
  news_overall_score?: unknown;
  news_sentiment_tally?: unknown;
  news_item_sentiments?: unknown;
  news_sentiments?: unknown;
  summary?: unknown;
  trading_insight?: unknown;
};

type GeminiNewsEntry = {
  status?: unknown;
  ticker?: unknown;
  company_name?: unknown;
  news_count?: unknown;
  evaluation?: GeminiEvaluation;
  news?: unknown;
};

type LoadedRows = {
  mtimeMs: number;
  rows: PipelineOutputRow[];
};

/**
 * The dev server's cwd is usually `FE/`, so probe the root outputs folder plus
 * common alternatives. `PIPELINE_RESULT_PATH` may point to either JSON or CSV.
 */
function candidatePaths(fileNames: string[], includeOverride = true): string[] {
  const override = process.env.PIPELINE_RESULT_PATH;
  const outputDir = process.env.PIPELINE_OUTPUT_DIR;
  const cwd = process.cwd();
  const paths = [
    ...(includeOverride && override ? [override] : []),
    ...(outputDir ? fileNames.map((fileName) => join(outputDir, fileName)) : []),
    ...fileNames.flatMap((fileName) => [
      join(cwd, "outputs", fileName),
      join(cwd, "..", "outputs", fileName),
      join(cwd, "..", "..", "outputs", fileName),
    ]),
  ];

  return [...new Set(paths)];
}

function isPipelineRows(value: unknown): value is PipelineOutputRow[] {
  return (
    Array.isArray(value) &&
    value.every((row) => row !== null && typeof row === "object" && "result" in row && "input_row" in row)
  );
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  const headers = rows[0]?.map((header) => header.replace(/^\uFEFF/, "").trim()) ?? [];
  if (headers.length === 0) {
    return [];
  }

  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function toFiniteOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function boolFromCsv(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function upProbabilityFromInput(input: PipelineInputRow | undefined): number | null {
  return toFiniteOrNull(input?.p_up);
}

function modelScoreFromInput(input: PipelineInputRow | undefined): number | null {
  const pUp = upProbabilityFromInput(input);
  if (pUp !== null) {
    return null;
  }

  return toFiniteOrNull(input?.ensemble_pred_return) ?? toFiniteOrNull(input?.lstm_pred_return);
}

function stringValue(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function ensembleCsvToPipelineRow(record: Record<string, string>): PipelineOutputRow | null {
  const ticker = stringValue(record.ticker ?? record["종목코드"]).padStart(6, "0");
  if (!ticker || ticker === "000000") {
    return null;
  }

  const companyName = stringValue(record.company_name ?? record["종목명"], ticker);
  const pUp = toFiniteOrNull(record.p_up);
  const predictedReturn = record.prediction_target === "next_session_open_to_close"
    ? toFiniteOrNull(record.ensemble_pred_return) : null;
  const predRank = toFiniteOrNull(record.pred_rank);
  const supplyPass = boolFromCsv(record.supply_pass);
  const supplyStatus = stringValue(record.supply_status);
  const supplyChecked = supplyStatus !== "" && supplyStatus !== "not_checked";
  const modelDirection = predictedReturn === null ? (pUp === null ? 0 : pUp - 0.5) : predictedReturn;
  const label = modelDirection > 0 ? "POSITIVE" : modelDirection < 0 ? "NEGATIVE" : "NEUTRAL";
  const modelDescription = predictedReturn === null
    ? (pUp === null ? "예측값 없음" : `기존 모델 상승확률 ${(pUp * 100).toFixed(2)}%`)
    : `앙상블 다음 거래일 시가→종가 예측수익률 ${(predictedReturn * 100).toFixed(2)}%`;
  const pUpPercent = pUp === null ? null : Number((pUp * 100).toFixed(2));
  const status = stringValue(record.prediction_status, "unknown");
  const keyDataPoints = [
    modelDescription,
    predRank === null ? undefined : `Prediction rank: ${predRank}`,
    supplyChecked && record.supply_score ? `Supply score: ${record.supply_score}` : undefined,
    supplyChecked && record.supply_base_end_date ? `Supply base date: ${record.supply_base_end_date}` : undefined,
  ].filter((value): value is string => Boolean(value));

  const inputRow: PipelineInputRow = {
    ...record,
    company_name: companyName,
    p_up: pUp ?? undefined,
    pred_rank: predRank ?? undefined,
    prediction_status: status,
    ticker,
    // CSV columns spread above arrive as strings; the detail page calls
    // `formatRate(...).toFixed` on these, so coerce to number | undefined.
    lstm_pred_return: toFiniteOrNull(record.lstm_pred_return) ?? undefined,
    ensemble_pred_return: toFiniteOrNull(record.ensemble_pred_return) ?? undefined,
  };

  return {
    input_row: inputRow,
    news: [],
    data_meta: { source: "cache", newsCollected: false, newsMethod: "unknown" },
    result: {
      caution: "News and OpenAI sentiment were not run for this output.",
      company_name: companyName,
      confidence: 0,
      key_data_points: keyDataPoints,
      label,
      label_ko: label === "POSITIVE" ? "긍정" : label === "NEGATIVE" ? "부정" : "중립",
      negative_factors: [
        predictedReturn !== null && predictedReturn < 0 ? modelDescription : undefined,
        pUp !== null && pUp < 0.5 ? `Transformer 상승 확률이 ${pUpPercent}%로 50% 미만입니다.` : undefined,
        supplyChecked && !supplyPass ? "최근 수급 조건을 충족하지 못했습니다." : undefined,
      ].filter((value): value is string => Boolean(value)),
      positive_factors: [
        predictedReturn !== null && predictedReturn > 0 ? modelDescription : undefined,
        pUp !== null && pUp >= 0.5 ? `Transformer 상승 확률이 ${pUpPercent}%로 50% 이상입니다.` : undefined,
        supplyPass ? "최근 수급 조건을 충족했습니다." : undefined,
      ].filter((value): value is string => Boolean(value)),
      sentiment_score: 0, // No news sentiment or calibrated confidence in a model-only result.
      summary:
          `${modelDescription}, 전체 예측 순위 ${predRank ?? "미산출"}위입니다${
              supplyChecked ? `; 수급 조건은 ${supplyPass ? "통과" : "미통과"}입니다` : ""
            }.`,
      ticker,
      used_news_indices: [],
    },
  };
}

async function loadJsonRows(): Promise<LoadedRows | null> {
  let latest: LoadedRows | null = null;

  for (const path of candidatePaths(JSON_RESULT_FILES)) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (isPipelineRows(parsed)) {
        const mtimeMs = (await stat(path)).mtimeMs;
        if (!latest || mtimeMs > latest.mtimeMs) {
          latest = { mtimeMs, rows: parsed.map(row => withFileMeta(row, mtimeMs)) };
        }
      }
    } catch {
      // Try the next candidate path.
    }
  }

  return latest;
}

async function loadCsvRows(
  fileNames: string[] = CSV_RESULT_FILES,
  includeOverride = true,
): Promise<LoadedRows | null> {
  let latest: LoadedRows | null = null;

  for (const path of candidatePaths(fileNames, includeOverride)) {
    try {
      await access(path);
    } catch {
      continue;
    }

    try {
      const text = await readFile(path, "utf8");
      const rows = parseCsv(text)
        .map(ensembleCsvToPipelineRow)
        .filter((row): row is PipelineOutputRow => row !== null);
      if (rows.length > 0 || /^\s*(?:\uFEFF)?[^\r\n]*ticker[^\r\n]*/.test(text)) {
        const mtimeMs = (await stat(path)).mtimeMs;
        if (!latest || mtimeMs > latest.mtimeMs) {
          latest = { mtimeMs, rows: rows.map(row => withFileMeta(row, mtimeMs)) };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load ensemble candidate CSV ${path}: ${message}`);
    }
  }

  return latest;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function withFileMeta(row: PipelineOutputRow, mtimeMs: number): PipelineOutputRow {
  return { ...row, data_meta: { ...row.data_meta, source: row.data_meta?.source === "sample" ? "sample" : "cache", asOf: new Date(mtimeMs).toISOString() } };
}

/** Maps Gemini's Bullish/Bearish/Neutral to the pipeline's sentiment label. */
function sentimentLabelFromGemini(sentiment: string): { label: string; label_ko: string } {
  const normalized = sentiment.toLowerCase();
  if (normalized.includes("bull") || normalized.includes("positive") || sentiment.includes("호재")) {
    return { label: "POSITIVE", label_ko: "긍정" };
  }
  if (normalized.includes("bear") || normalized.includes("negative") || sentiment.includes("악재")) {
    return { label: "NEGATIVE", label_ko: "부정" };
  }
  return { label: "NEUTRAL", label_ko: "중립" };
}

function tickerFromRow(row: PipelineOutputRow): string {
  return String(row.result?.ticker ?? row.input_row?.ticker ?? "").padStart(6, "0");
}

function markerAllowsLoadedFile(marker: PipelineRunMarker | null, mtimeMs: number): boolean {
  if (!marker) {
    return process.env.PIPELINE_ALLOW_UNMARKED_RESULTS === "true";
  }

  return isFreshForRun(mtimeMs, marker);
}

function finalSentimentFromEntry(entry: GeminiNewsEntry | undefined): string {
  const evaluation = entry?.evaluation ?? {};
  const explicitSentiment = stringValue(evaluation.final_sentiment) || stringValue(evaluation.sentiment);
  if (explicitSentiment) {
    return explicitSentiment;
  }

  const combinedScore = toFiniteOrNull(evaluation.final_combined_score);
  if (combinedScore === null) {
    return "";
  }

  if (combinedScore >= 70) {
    return "Bullish";
  }
  if (combinedScore >= 60) {
    return "Neutral";
  }
  return "Bearish";
}

function finalCombinedScoreFromEntry(entry: GeminiNewsEntry | undefined): number | null {
  return toFiniteOrNull(entry?.evaluation?.final_combined_score) ?? toFiniteOrNull(entry?.evaluation?.impact_score);
}

function isDisplayableLlmEntry(entry: GeminiNewsEntry | undefined): boolean {
  const sentiment = finalSentimentFromEntry(entry);
  if (sentiment === "") {
    return false;
  }

  const { label } = sentimentLabelFromGemini(sentiment);
  return label === "POSITIVE" || label === "NEUTRAL";
}

function sortRowsByLlmScoreThenRank(
  rows: PipelineOutputRow[],
  news: Map<string, GeminiNewsEntry>,
): PipelineOutputRow[] {
  return [...rows].sort((a, b) => {
    const aScore = finalCombinedScoreFromEntry(news.get(tickerFromRow(a))) ?? -1;
    const bScore = finalCombinedScoreFromEntry(news.get(tickerFromRow(b))) ?? -1;
    if (bScore !== aScore) {
      return bScore - aScore;
    }

    const aRank = toFiniteOrNull(a.input_row?.pred_rank) ?? Number.MAX_SAFE_INTEGER;
    const bRank = toFiniteOrNull(b.input_row?.pred_rank) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

type NewsSentimentMeta = {
  label: string;
  label_ko: string;
  reason?: string;
};

function newsSentimentMapFromEvaluation(evaluation: GeminiEvaluation): Map<number, NewsSentimentMeta> {
  const raw = evaluation.news_item_sentiments ?? evaluation.news_sentiments;
  const map = new Map<number, NewsSentimentMeta>();

  const add = (indexValue: unknown, sentimentValue: unknown, reasonValue?: unknown) => {
    const index = toFiniteOrNull(indexValue);
    const sentiment = stringValue(sentimentValue);
    if (index === null || index < 1 || !/^(positive|negative|neutral|bullish|bearish)$/i.test(sentiment)) {
      return;
    }

    const { label, label_ko } = sentimentLabelFromGemini(sentiment);
    const reason = stringValue(reasonValue);
    map.set(Math.round(index), {
      label,
      label_ko,
      ...(reason ? { reason } : {}),
    });
  };

  if (Array.isArray(raw)) {
    raw.forEach((item, itemIndex) => {
      if (item && typeof item === "object") {
        const object = item as Record<string, unknown>;
        add(
          object.index ?? object.news_index ?? object.no ?? itemIndex + 1,
          object.sentiment ?? object.label ?? object.direction,
          object.reason ?? object.summary ?? object.rationale,
        );
      } else {
        add(itemIndex + 1, item);
      }
    });
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        add(
          object.index ?? key,
          object.sentiment ?? object.label ?? object.direction,
          object.reason ?? object.summary ?? object.rationale,
        );
      } else {
        add(key, value);
      }
    }
  }

  return map;
}

function toPipelineNews(value: unknown, evaluation: GeminiEvaluation = {}): PipelineOutputRow["news"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sentimentByIndex = newsSentimentMapFromEvaluation(evaluation);

  return value
    .map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const url = stringValue(item.url);
      const newsIndex = toFiniteOrNull(item.index) ?? index + 1;
      const sentiment = sentimentByIndex.get(newsIndex) ?? sentimentByIndex.get(index + 1);
      return {
        index: newsIndex,
        pub_date: stringValue(item.pub_date),
        source: stringValue(item.source),
        title: stringValue(item.title),
        description: stringValue(item.description) || undefined,
        url: url || undefined,
        ...(sentiment
          ? {
              sentiment: sentiment.label,
              sentiment_ko: sentiment.label_ko,
              sentiment_reason: sentiment.reason,
            }
          : {}),
      };
    })
    .filter((item) => item.title !== "");
}

/**
 * Overlays one Gemini news entry onto an ensemble candidate row: attaches the
 * crawled news and, when the LLM evaluation is present, rewrites the sentiment
 * label, confidence (from `impact_score`), summary and trading insight so the
 * frontend's news-sentiment view lights up. A positive `confidence` is what
 * `hasLlmSentiment` keys on, so analyzed rows always get a non-zero floor.
 */
function applyNewsToRow(row: PipelineOutputRow, entry: GeminiNewsEntry): PipelineOutputRow {
  const evaluation = entry.evaluation ?? {};
  const impact = toFiniteOrNull(evaluation.impact_score);
  const combinedScore = toFiniteOrNull(evaluation.final_combined_score);
  const rawNewsScore = toFiniteOrNull(evaluation.news_overall_score);
  const newsScore = rawNewsScore === null ? null : clamp(rawNewsScore > 10 ? rawNewsScore / 10 : rawNewsScore, 0, 10);
  const summary = stringValue(evaluation.summary);
  const sentiment = stringValue(evaluation.final_sentiment) || stringValue(evaluation.sentiment);
  const sentimentTally = stringValue(evaluation.news_sentiment_tally);
  const tradingInsight = stringValue(evaluation.trading_insight);
  const news = toPipelineNews(entry.news, evaluation);
  const rawStatus = stringValue(entry.status).toLowerCase();
  const hasExplicitEvidence = news.some(item => item.sentiment !== undefined) ||
    (/(긍정|중립|부정)\s*\d+\s*건/.test(sentimentTally) && [...sentimentTally.matchAll(/(?:긍정|중립|부정)\s*(\d+)\s*건/g)].some(match => Number(match[1]) > 0));
  // crolling.py emits only successful LLM entries but swallows crawling failures
  // into [] and emits no collection status. [] is therefore NOT confirmed zero.
  const newsStatus = rawStatus || (hasExplicitEvidence ? "llm_evidence" : "unknown");
  const newsCollected = Array.isArray(entry.news) && isNewsCollectionSuccess(rawStatus);

  const hasEvaluation =
    sentiment !== "" || sentimentTally !== "" || summary !== "" || impact !== null || combinedScore !== null || newsScore !== null;
  if (!hasEvaluation) {
    // Gemini failed/skipped this ticker — still surface any crawled headlines.
    return { ...row, news, data_meta: { ...row.data_meta, newsCollected, newsStatus, newsMethod: "unknown" } };
  }

  const { label, label_ko } = sentimentLabelFromGemini(sentiment);
  const newsCount = toFiniteOrNull(entry.news_count) ?? news.length;
  const geminiKeyPoints = [
    impact === null ? undefined : `Gemini 영향도 점수: ${impact}/10`,
    combinedScore === null ? undefined : `기술·뉴스 결합 점수: ${combinedScore}/100`,
    newsScore === null ? undefined : `뉴스 종합 점수: ${newsScore}/10`,
    sentimentTally || undefined,
    newsCount > 0 ? `분석 뉴스 ${newsCount}건` : undefined,
  ].filter((value): value is string => Boolean(value));

  const sentimentScore =
    combinedScore === null
      ? impact === null
        ? 0
        : clamp(impact / 10, -1, 1)
      : clamp((combinedScore - 50) / 50, -1, 1);
  const confidence =
    combinedScore === null
      ? impact === null
        ? 0.1
        : clamp(Math.abs(impact) / 10, 0.1, 1)
      : clamp(Math.abs(combinedScore - 50) / 50, 0.1, 1);

  return {
    ...row,
    news,
    data_meta: { ...row.data_meta, newsCollected, newsStatus, newsMethod: "llm", newsTally: sentimentTally || undefined },
    result: {
      ...row.result,
      label,
      label_ko,
      sentiment_score: sentimentScore,
      confidence,
      summary: summary || row.result.summary,
      trading_insight: tradingInsight || undefined,
      key_data_points: [...row.result.key_data_points, ...geminiKeyPoints],
      positive_factors: [
        ...row.result.positive_factors,
        ...(newsScore !== null && newsScore > 5 ? [`뉴스 종합 점수가 ${newsScore}/10으로 긍정 우위입니다.`] : []),
      ],
      negative_factors: [
        ...row.result.negative_factors,
        ...(newsScore !== null && newsScore < 5 ? [`뉴스 종합 점수가 ${newsScore}/10으로 부정 우위입니다.`] : []),
      ],
      caution: "",
      company_name: row.result.company_name || stringValue(entry.company_name),
    },
  };
}

function applyEventToRow(row: PipelineOutputRow, entry: EventEntry): PipelineOutputRow {
  const finalScore = toFiniteOrNull(entry.final_score);
  const newsDelta = toFiniteOrNull(entry.news_delta);
  const rank = toFiniteOrNull(entry.final_rank);
  const percentile = toFiniteOrNull(entry.final_rank_percentile);
  const applied = entry.applied === true;
  const rawAccepted = toFiniteOrNull(entry.accepted_events);
  const accepted = rawAccepted !== null && Number.isInteger(rawAccepted) && rawAccepted >= 0 ? rawAccepted : null;
  const articles = Array.isArray(entry.news) ? entry.news : [];
  const news = articles.map((item, index) => {
    const sentiment = stringValue(item.sentiment);
    const mapped = /^(positive|negative|neutral|bullish|bearish)$/i.test(sentiment) ? sentimentLabelFromGemini(sentiment) : null;
    return {
      index: index + 1,
      title: stringValue(item.title),
      url: stringValue(item.url),
      source: stringValue(item.source),
      pub_date: stringValue(item.pub_date),
      sentiment: mapped?.label ?? (sentiment || undefined),
      sentiment_ko: mapped?.label_ko,
      sentiment_reason: stringValue(item.reason) || stringValue(item.evidence_quote),
    };
  });
  const positiveCount = news.filter((item) => item.sentiment === "POSITIVE").length;
  const negativeCount = news.filter((item) => item.sentiment === "NEGATIVE").length;
  const neutralCount = news.filter(item => item.sentiment === "NEUTRAL").length;
  const direction = finalScore === null ? { label: "NEUTRAL", label_ko: "판정 불가" } : finalScore > 0 ? { label: "POSITIVE", label_ko: "상승 예상" }
    : finalScore < 0 ? { label: "NEGATIVE", label_ko: "하락 예상" }
      : { label: "NEUTRAL", label_ko: "중립" };
  const status = stringValue(entry.status).toLowerCase();
  const rawPrediction = toFiniteOrNull(row.input_row.ensemble_pred_return);
  const rawNewsDelta = toFiniteOrNull(entry.news_delta);
  const summary = (rawPrediction === null ? "Huber 원본 예측수익률 미확인. " : `Huber 예상수익률 ${(rawPrediction * 100).toFixed(2)}%. `) +
    (applied ? rawNewsDelta === null ? "적용된 뉴스 보정값은 미확인입니다." : `검증된 뉴스 보정 ${rawNewsDelta >= 0 ? "+" : ""}${(rawNewsDelta * 100).toFixed(2)}%p를 적용했습니다.`
      : `${accepted === null ? "직접 관련 사건 수는 미확인" : `${accepted}건의 직접 관련 사건을 확인`}이며, 뉴스 보정은 적용하지 않았습니다.`);
  return {
    ...row,
    data_meta: {
      ...row.data_meta,
      rawFinalPrediction: toFiniteOrNull(entry.final_score),
      rawModelRank: toFiniteOrNull(row.input_row.pred_rank),
      rawFinalRank: rank,
      newsCollected: Array.isArray(entry.news) && isNewsCollectionSuccess(status),
      newsStatus: status,
      newsMethod: articles.every(item => /^(positive|negative|neutral|bullish|bearish)$/i.test(stringValue(item.sentiment))) ? "llm" : "unknown",
      // Do not count an absent/unknown article label as an explicit LLM neutral vote.
      newsTally: articles.every(item => /^(positive|negative|neutral|bullish|bearish)$/i.test(stringValue(item.sentiment)))
        ? { positive: positiveCount, neutral: neutralCount, negative: negativeCount } : null,
    },
    input_row: {
      ...row.input_row,
      final_pred_return: finalScore,
      news_adjustment: newsDelta,
      news_applied: applied,
      news_analysis_status: status,
      final_rank_percentile: percentile ?? undefined,
      pred_rank: rank ?? row.input_row.pred_rank,
    },
    news,
    result: {
      ...row.result,
      label: direction.label,
      label_ko: direction.label_ko,
      confidence: 0,
      summary,
      trading_insight: applied ? "뉴스 사건 보정이 순위에 반영됐습니다." : "뉴스 분석은 참고 근거이며 현재 매매 순위에는 반영되지 않습니다.",
      key_data_points: [
        ...row.result.key_data_points,
        `최종 예상수익률: ${finalScore === null ? "미확인" : `${(finalScore * 100).toFixed(2)}%`}`,
        `뉴스 보정: ${newsDelta === null ? "미확인" : `${(newsDelta * 100).toFixed(2)}%p`}`,
        `본문 분석 ${news.length}건 · 직접 관련 사건 ${accepted === null ? "미확인" : `${accepted}건`}`,
        `긍정 ${positiveCount}건 · 중립 ${neutralCount}건 · 부정 ${negativeCount}건`,
      ],
      caution: stringValue(entry.activation_reason),
    },
  };
}

async function loadEventResult(): Promise<Map<string, EventEntry> | null> {
  if ((await readPipelineRunMarker())?.mode === "model_only") return null;
  let latest: { mtimeMs: number; map: Map<string, EventEntry> } | null = null;
  for (const path of candidatePaths(EVENT_RESULT_FILES, false)) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const mtimeMs = (await stat(path)).mtimeMs;
      if (latest && mtimeMs <= latest.mtimeMs) continue;
      const map = new Map<string, EventEntry>();
      for (const [ticker, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value && typeof value === "object") map.set(ticker.padStart(6, "0"), value as EventEntry);
      }
      latest = { mtimeMs, map };
    } catch {
      // Try the next output location.
    }
  }
  const marker = await readPipelineRunMarker();
  return latest && markerAllowsLoadedFile(marker, latest.mtimeMs) ? latest.map : null;
}

/** Loads the latest Gemini news result keyed by 6-digit ticker, or null if absent. */
async function loadNewsResult(): Promise<Map<string, GeminiNewsEntry> | null> {
  if ((await readPipelineRunMarker())?.mode === "model_only") return null;
  let latest: { mtimeMs: number; map: Map<string, GeminiNewsEntry> } | null = null;

  for (const path of candidatePaths(NEWS_RESULT_FILES)) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }

      const mtimeMs = (await stat(path)).mtimeMs;
      if (latest && mtimeMs <= latest.mtimeMs) {
        continue;
      }

      const map = new Map<string, GeminiNewsEntry>();
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value && typeof value === "object") {
          map.set(String(key).padStart(6, "0"), value as GeminiNewsEntry);
        }
      }
      latest = { mtimeMs, map };
    } catch {
      // Try the next candidate path.
    }
  }

  const marker = await readPipelineRunMarker();
  if (latest && !markerAllowsLoadedFile(marker, latest.mtimeMs)) {
    return null;
  }

  return latest?.map ?? null;
}

const SUPPLY_CHECKED_FILE = "step2_supply_checked.csv";
const REAL_SUPPLY_STATUSES = new Set(["ok", "insufficient_data"]);
function csvBoolean(value: string | undefined): boolean | null {
  const text = (value ?? "").trim().toLowerCase();
  return text === "true" ? true : text === "false" ? false : null;
}
function nonNegativeInteger(value: string | undefined): number | null {
  const parsed = toFiniteOrNull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Model-only runs keep supply only in step2_supply_checked.csv (the whole-rank CSV has none). Read it with the same
 * parser and freshness rule as the other outputs, and only if the run marker is unchanged across the read.
 * Duplicate tickers are ambiguous and dropped.
 */
async function loadModelOnlySupply(marker: PipelineRunMarker): Promise<Map<string, Record<string, string>>> {
  const found = new Map<string, Record<string, string>>();
  if (marker.status !== "completed") return found;
  let latest: { mtimeMs: number; records: Record<string, string>[] } | null = null;
  for (const path of candidatePaths([SUPPLY_CHECKED_FILE], false)) {
    try {
      const text = await readFile(path, "utf8"), mtimeMs = (await stat(path)).mtimeMs;
      if (!latest || mtimeMs > latest.mtimeMs) latest = { mtimeMs, records: parseCsv(text) };
    } catch {
      // Absent or unreadable: supply stays missing. The error is never surfaced.
    }
  }
  if (!latest || !isFreshForRun(latest.mtimeMs, marker)) return found;
  const after = await readPipelineRunMarker();
  if (!after || after.status !== marker.status || after.startedAt !== marker.startedAt || after.finishedAt !== marker.finishedAt || after.mode !== marker.mode) return found;
  const duplicates = new Set<string>();
  for (const record of latest.records) {
    const ticker = record.ticker ?? "";
    if (found.has(ticker)) duplicates.add(ticker);
    found.set(ticker, record);
  }
  duplicates.forEach(ticker => found.delete(ticker));
  return found;
}

/**
 * Copies only measured supply values onto the matching whole-rank row. A record is used only when it describes the same
 * prediction (exact ticker, base date, target, rank and value) and carries real data: not_checked rows hold placeholder
 * zeros and fetch_failed/empty rows hold nothing, so they are never promoted. combined_positive_days is not derived.
 */
function applyModelSupply(row: PipelineOutputRow, record: Record<string, string> | undefined): PipelineOutputRow {
  if (!record) return row;
  const input = row.input_row, ticker = tickerFromRow(row);
  const rank = toFiniteOrNull(input.pred_rank), prediction = toFiniteOrNull(input.ensemble_pred_return);
  const baseDate = isoDate(record.prediction_base_date);
  if (record.ticker !== ticker || record.prediction_status !== "ok" || record.prediction_target !== MODEL_TARGET || input.prediction_target !== MODEL_TARGET ||
    baseDate === null || baseDate !== input.prediction_base_date || rank === null || positiveInteger(record.pred_rank) !== rank ||
    prediction === null || toFiniteOrNull(record.ensemble_pred_return) !== prediction) return row;
  const status = record.supply_status, window = positiveInteger(record.supply_window), dataDays = positiveInteger(record.supply_data_days);
  const foreignNet = toFiniteOrNull(record.foreign_net_buy_sum), institutionNet = toFiniteOrNull(record.inst_net_buy_sum);
  const foreignDays = nonNegativeInteger(record.foreign_positive_days), institutionDays = nonNegativeInteger(record.inst_positive_days);
  const enough = csvBoolean(record.supply_data_enough);
  const combinedDays = nonNegativeInteger(record.combined_positive_days);
  if (status === undefined || !REAL_SUPPLY_STATUSES.has(status) || window === null || dataDays === null || foreignNet === null || institutionNet === null ||
    foreignDays === null || institutionDays === null || enough === null || foreignDays > dataDays || institutionDays > dataDays ||
    enough !== (dataDays >= window) || (status === "ok") !== enough) return row;
  return { ...row, input_row: { ...input, foreign_net_buy_sum: foreignNet, inst_net_buy_sum: institutionNet, foreign_positive_days: foreignDays,
    inst_positive_days: institutionDays, combined_positive_days: combinedDays !== null && combinedDays <= dataDays ? combinedDays : null,
    supply_window: window, supply_data_days: dataDays, supply_data_enough: enough, supply_status: status } };
}

/** Overlays the Gemini news result onto candidate rows, matched by ticker. */
async function overlayNewsResult(rows: PipelineOutputRow[]): Promise<PipelineOutputRow[]> {
  const marker = await readPipelineRunMarker();
  if (marker?.mode === "model_only") {
    const supply = await loadModelOnlySupply(marker);
    return rows.map(row => applyModelSupply({ ...row, news: [], data_meta: { ...row.data_meta, rawFinalPrediction: null, rawFinalRank: null,
      newsCollected: false, newsMethod: "unknown", newsStatus: "skipped", newsTally: null },
      input_row: { ...row.input_row, final_pred_return: null, news_adjustment: null, news_applied: false } }, supply.get(tickerFromRow(row))));
  }
  const events = await loadEventResult();
  if (events) {
    return rows.map((row) => {
      const entry = events.get(tickerFromRow(row));
      return entry ? applyEventToRow(row, entry) : row;
    });
  }
  const news = await loadNewsResult();
  if (!news) {
    return rows;
  }

  return rows.map((row) => {
    const ticker = String(row.result?.ticker ?? row.input_row?.ticker ?? "").padStart(6, "0");
    const entry = news.get(ticker);
    return entry ? applyNewsToRow(row, entry) : row;
  });
}

async function loadBaseRows(): Promise<PipelineOutputRow[] | null> {
  const marker = await readPipelineRunMarker();
  // STEP2 model selections are not news-adjusted final candidates.
  if (marker?.mode === "model_only") return marker.status === "completed" ? [] : null;
  if (!marker && process.env.PIPELINE_ALLOW_UNMARKED_RESULTS !== "true") {
    return null;
  }

  if (marker && marker.status !== "completed") {
    return null;
  }

  const csvRows = await loadCsvRows();
  if (csvRows && markerAllowsLoadedFile(marker, csvRows.mtimeMs)) {
    return csvRows.rows;
  }

  const transformerJsonRows = await loadJsonRows();
  if (transformerJsonRows && markerAllowsLoadedFile(marker, transformerJsonRows.mtimeMs)) {
    return transformerJsonRows.rows;
  }

  for (const path of candidatePaths(LEGACY_JSON_RESULT_FILES)) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (isPipelineRows(parsed)) {
        const mtimeMs = (await stat(path)).mtimeMs;
        if (!markerAllowsLoadedFile(marker, mtimeMs)) {
          continue;
        }
        return parsed.map(row => withFileMeta(row, mtimeMs));
      }
    } catch {
      // Try the next legacy path.
    }
  }

  return null;
}

/**
 * Loads pipeline analysis rows from disk and overlays the Gemini news result
 * (crolling.py output) when present. Returns `null` when no candidate output
 * file exists yet, so callers can distinguish "not run" from "ran and found zero".
 */
export async function loadPipelineRows(): Promise<PipelineOutputRow[] | null> {
  const baseRows = await loadBaseRows();
  if (!baseRows) {
    return null;
  }

  return overlayNewsResult(baseRows);
}

/**
 * Payload for `GET /api/candidates`: real pipeline output when present,
 * otherwise an empty array. The frontend decides whether to fall back to mock.
 */
export async function getCandidatesPayload(): Promise<PipelineOutputRow[]> {
  const rows = await loadPipelineRows();
  if (!rows) {
    return [];
  }

  const events = await loadEventResult();
  if (events) {
    return [...rows].sort((a, b) => {
      const aScore = toFiniteOrNull(a.input_row?.final_pred_return) ?? toFiniteOrNull(a.input_row?.ensemble_pred_return) ?? -Infinity;
      const bScore = toFiniteOrNull(b.input_row?.final_pred_return) ?? toFiniteOrNull(b.input_row?.ensemble_pred_return) ?? -Infinity;
      return bScore - aScore || tickerFromRow(a).localeCompare(tickerFromRow(b));
    });
  }

  const news = await loadNewsResult();
  if (!news) {
    return rows;
  }

  return sortRowsByLlmScoreThenRank(
    rows.filter((row) => isDisplayableLlmEntry(news.get(tickerFromRow(row)))),
    news,
  );
}

/**
 * Returns one stock's latest ensemble result from the full KOSPI200 ranking.
 * News/Gemini evidence is overlaid when that ticker has been analyzed.
 */
export async function getStockAnalysisPayload(ticker: string): Promise<PipelineOutputRow | null> {
  const normalized = String(ticker ?? "").replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (!/^\d{6}$/.test(normalized) || normalized === "000000") {
    throw new Error("A valid 6-digit ticker is required.");
  }

  const marker = await readPipelineRunMarker();
  if (!marker && process.env.PIPELINE_ALLOW_UNMARKED_RESULTS !== "true") {
    return null;
  }

  if (marker && marker.status !== "completed") {
    return null;
  }

  const top10Rows = await loadPipelineRows();
  const top10Match = top10Rows?.find(
    (row) => String(row.input_row?.ticker ?? row.result?.ticker ?? "").padStart(6, "0") === normalized,
  );
  if (top10Match) {
    return top10Match;
  }

  const fullRank = await loadCsvRows(FULL_RANK_CSV_RESULT_FILES, false);
  if (fullRank && !markerAllowsLoadedFile(marker, fullRank.mtimeMs)) {
    return null;
  }
  const rows = fullRank ? await overlayNewsResult(fullRank.rows) : top10Rows;
  return rows?.find((row) => String(row.input_row?.ticker ?? row.result?.ticker ?? "").padStart(6, "0") === normalized) ?? null;
}

/** Full model ranking; it is never narrowed to final news-filtered candidates. */
export async function getRankPayload(): Promise<PipelineOutputRow[]> {
  const marker = await readPipelineRunMarker();
  if ((!marker && process.env.PIPELINE_ALLOW_UNMARKED_RESULTS !== "true") || (marker && marker.status !== "completed")) return [];
  const rank = await loadCsvRows(FULL_RANK_CSV_RESULT_FILES, false);
  return rank && markerAllowsLoadedFile(marker, rank.mtimeMs) ? overlayNewsResult(rank.rows) : [];
}

/** Diagnostic only. Reuses the production parsers/loaders without changing their API contracts. */
export async function inspectPipelineResultAvailability(): Promise<{ candidates: PipelineAvailability; rank: PipelineAvailability }> {
  const unavailable = (state: PipelineAvailability["state"]): PipelineAvailability => ({ state, count: null, source: "unknown", asOf: null });
  const marker = await readPipelineRunMarker();
  if (!marker || marker.status !== "completed") return { candidates: unavailable("blocked"), rank: unavailable("blocked") };
  if (!Number.isFinite(marker.startedAt) || marker.startedAt <= 0 ||
    (marker.finishedAt !== undefined && (!Number.isFinite(marker.finishedAt) || marker.finishedAt < marker.startedAt))) {
    return { candidates: unavailable("invalid"), rank: unavailable("invalid") };
  }
  const failedLoad = async (paths: string[]): Promise<PipelineAvailability> => {
    let exists = false, fresh = false;
    for (const path of paths) {
      try { const file = await stat(path); if (!file.isFile()) continue; exists = true; fresh ||= isFreshForRun(file.mtimeMs, marker); }
      catch (error) { if ((error as { code?: string }).code !== "ENOENT") return unavailable("unknown"); }
    }
    return unavailable(!exists ? "missing" : !fresh ? "stale" : "invalid");
  };
  const ready = (rows: PipelineOutputRow[], asOf: string | null): PipelineAvailability => rows.some(row => row.data_meta?.source === "sample")
    ? { state: "sample", count: null, source: "sample", asOf }
    : { state: rows.length ? "available" : "empty", count: rows.length, source: "cache", asOf };
  const candidates = async (): Promise<PipelineAvailability> => {
    if (marker.mode === "model_only") return unavailable("not_produced");
    try {
      const base = await loadBaseRows();
      if (base !== null) {
        const rows = await getCandidatesPayload();
        const asOf = base.map(row => row.data_meta?.asOf).find((time): time is string => typeof time === "string") ?? null;
        return base.some(row => row.data_meta?.source === "sample") ? ready(base, asOf) : ready(rows, asOf);
      }
    } catch { return unavailable("invalid"); }
    return failedLoad([...candidatePaths(CSV_RESULT_FILES), ...candidatePaths(JSON_RESULT_FILES), ...candidatePaths(LEGACY_JSON_RESULT_FILES)]);
  };
  const rank = async (): Promise<PipelineAvailability> => {
    try {
      const loaded = await loadCsvRows(FULL_RANK_CSV_RESULT_FILES, false);
      if (loaded && isFreshForRun(loaded.mtimeMs, marker)) return ready(await overlayNewsResult(loaded.rows), new Date(loaded.mtimeMs).toISOString());
    } catch { return unavailable("invalid"); }
    return failedLoad(candidatePaths(FULL_RANK_CSV_RESULT_FILES, false));
  };
  const [candidateResult, rankResult] = await Promise.all([candidates(), rank()]);
  const after = await readPipelineRunMarker();
  if (!after || after.status !== marker.status || after.startedAt !== marker.startedAt || after.finishedAt !== marker.finishedAt || after.mode !== marker.mode) {
    return { candidates: unavailable("unknown"), rank: unavailable("unknown") };
  }
  return { candidates: candidateResult, rank: rankResult };
}

const MODEL_TARGET = "next_session_open_to_close";
const MODEL_OUTPUT_COLUMNS = ["ticker", "ensemble_pred_return", "prediction_target", "prediction_status", "pred_rank", "pred_pool_size", "prediction_base_date"];

function isoDate(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  const time = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : Number.NaN;
  // Date.parse accepts neither month 13 nor day 40, but rolls Feb 30 over, so require an exact round trip.
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(text) ? text : null;
}
function positiveInteger(value: string | undefined): number | null {
  const parsed = toFiniteOrNull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

type ValidatedModelRow = { ticker: string; prediction: number; rank: number };
/** One STEP2 CSV: fresh, schema-complete, and every ok row carries a finite prediction with the agreed target and date. */
function validateModelRows(records: Record<string, string>[]): { ok: ValidatedModelRow[]; baseDate: string; poolSize: number; all: number } {
  const fail = (): never => { throw new Error("Invalid model output rows."); };
  if (records.length === 0) fail();
  if (records.some(row => !/^\d{6}$/.test(row.ticker ?? "") || row.ticker === "000000")) fail();
  if (new Set(records.map(row => row.ticker)).size !== records.length) fail();
  const ok = records.filter(row => row.prediction_status === "ok");
  if (ok.length === 0) fail();
  // A row that is not ok must not claim a model rank.
  if (records.some(row => row.prediction_status !== "ok" && row.pred_rank?.trim())) fail();
  const dates = new Set(ok.map(row => isoDate(row.prediction_base_date)));
  const [baseDate] = [...dates];
  if (dates.size !== 1 || baseDate === null) fail();
  const rows = ok.map((row): ValidatedModelRow => {
    const prediction = toFiniteOrNull(row.ensemble_pred_return), rank = positiveInteger(row.pred_rank);
    if (prediction === null || rank === null || row.prediction_target !== MODEL_TARGET) return fail();
    return { ticker: row.ticker, prediction, rank };
  });
  const poolSizes = new Set(ok.map(row => positiveInteger(row.pred_pool_size)));
  return { ok: rows, baseDate: baseDate as string, poolSize: poolSizes.size === 1 ? [...poolSizes][0] ?? 0 : 0, all: records.length };
}

/**
 * Validate exact STEP2 outputs before a model-only completion marker is written. A fresh,
 * parseable CSV is not enough: the whole-rank file must contain finite ok predictions with a
 * consecutive 1..N rank, one pool size and one base date, and the selection must be the exact
 * top of that same ranking. Anything else is a failed run, never an "empty" completion.
 */
export async function validateModelOnlyOutputs(outputDir: string, startedAt: number): Promise<{ rows: number; modelSelectionRows: number }> {
  const load = async (name: string): Promise<Record<string, string>[]> => {
    const path = join(outputDir, name), text = await readFile(path, "utf8"), file = await stat(path);
    if (!file.isFile() || !Number.isFinite(file.mtimeMs) || file.mtimeMs + 1000 < startedAt) throw new Error("Model output was not updated.");
    const header = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].split(",").map(value => value.trim());
    if (!MODEL_OUTPUT_COLUMNS.every(key => header.includes(key))) throw new Error("Invalid model output schema.");
    return parseCsv(text);
  };
  const [rankRecords, selectionRecords] = await Promise.all([load("step2_all_transformer_rank.csv"), load("step2_final_top10.csv")]);
  const rank = validateModelRows(rankRecords), selection = validateModelRows(selectionRecords);
  const inconsistent = (): never => { throw new Error("Inconsistent model selection."); };
  const ranked = [...rank.ok].sort((a, b) => a.rank - b.rank);
  // Ranks are exactly 1..N in non-increasing prediction order, and N matches the declared pool size.
  if (ranked.some((row, index) => row.rank !== index + 1 || (index > 0 && row.prediction > ranked[index - 1].prediction)) || rank.poolSize !== ranked.length) inconsistent();
  if (selection.baseDate !== rank.baseDate || selection.poolSize !== rank.poolSize || selection.ok.length !== selection.all || selection.ok.length > ranked.length) inconsistent();
  const byTicker = new Map(ranked.map(row => [row.ticker, row]));
  const picked = [...selection.ok].sort((a, b) => a.rank - b.rank);
  // The selection is the top-k of the same ranking with identical raw values.
  if (picked.some((row, index) => row.rank !== index + 1 || byTicker.get(row.ticker)?.rank !== row.rank || byTicker.get(row.ticker)?.prediction !== row.prediction)) inconsistent();
  return { rows: rankRecords.length, modelSelectionRows: selectionRecords.length };
}

/**
 * Indexes pipeline rows by 6-digit ticker code for quick merge into KIS quotes.
 */
export function indexPipelineByTicker(rows: PipelineOutputRow[]): Map<string, PipelineOutputRow> {
  const map = new Map<string, PipelineOutputRow>();

  for (const row of rows) {
    const ticker = String(row.result?.ticker ?? row.input_row?.ticker ?? "").padStart(6, "0");
    if (ticker && ticker !== "000000") {
      map.set(ticker, row);
    }
  }

  return map;
}

function applyPipelineRow(stock: StockQuote, row: PipelineOutputRow | undefined): StockQuote {
  if (!row) {
    return stock;
  }

  return {
    ...stock,
    aiSummary: row.result?.summary?.trim() ? row.result.summary : stock.aiSummary,
    confidence: toFiniteOrNull(row.result?.confidence) ?? stock.confidence,
    predictedReturn: modelScoreFromInput(row.input_row),
    sentimentLabel: row.result?.label ?? stock.sentimentLabel,
    upProbability: upProbabilityFromInput(row.input_row),
  };
}

/**
 * After the Python analysis writes its output, refresh the cached dashboard in
 * place so the next dashboard reload immediately shows AI fields.
 */
export async function refreshDashboardAiFieldsFromPipelineOutput(): Promise<boolean> {
  const rows = await loadPipelineRows();
  const snapshot = await readLastSnapshot();
  if (!rows || !snapshot) {
    return false;
  }

  const byTicker = indexPipelineByTicker(rows);
  const data = {
    ...snapshot,
    stocks: snapshot.stocks.map((stock) => applyPipelineRow(stock, byTicker.get(stock.code))),
    watchlist: snapshot.watchlist.map((stock) => applyPipelineRow(stock, byTicker.get(stock.code))),
  };

  await writeDashboardSnapshot(data);
  return true;
}
