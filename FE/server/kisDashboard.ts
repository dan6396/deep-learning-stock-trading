import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  MarketDashboardData,
  MarketDirection,
  MarketIndexSnapshot,
  PipelineOutputRow,
  StockQuote,
} from "../src/types/trading";
import { TIME_RANGES, type CandlePoint, type PricePoint, type StockChartBundle, type StockChartData, type StockSummary, type TimeRange } from "../src/types/stockChart";
import { KOSPI200_POOL } from "./kospi200Pool";
import { readDashboardSnapshot, readLastSnapshot, writeDashboardSnapshot } from "./dashboardCache";
import { indexPipelineByTicker, loadPipelineRows } from "./pipelineResults";
import { cachedDashboard } from "./snapshotMetadata";
import { pipelineOutputDir } from "./pipelineFreshness";
import { mkdir } from "node:fs/promises";

declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
};

type KisEnv = "mock" | "real";

type KisConfig = {
  appKey: string;
  appSecret: string;
  baseUrl: string;
  env: KisEnv;
  requestDelayMs: number;
};

type TokenCache = {
  accessToken: string;
  cacheKey: string;
  expiresAt: number;
};

type KisOutput = Record<string, unknown>;

const KIS_BASE_URLS: Record<KisEnv, string> = {
  mock: "https://openapivts.koreainvestment.com:29443",
  real: "https://openapi.koreainvestment.com:9443",
};

type StockSeed = Pick<StockQuote, "code" | "name" | "market">;

/**
 * Request-time fetches are sequential and rate-limited (KIS mock throttles to a
 * few calls/sec, so each quote waits `requestDelayMs`). Fetching all 200 inline
 * would take minutes and blow the request timeout, so the inline path only
 * covers the top slice; the full list is served from a pre-warmed snapshot
 * built by `refreshDashboardSnapshot` (the batch job). Override with
 * `KIS_UNIVERSE_SIZE`.
 */
const DEFAULT_INLINE_UNIVERSE_SIZE = 20;

function clampSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), KOSPI200_POOL.length);
}

/** Inline (request-time) universe size — kept small for a fast first paint. */
function resolveUniverseSize(env: Record<string, string | undefined>, fallback: number): number {
  return clampSize(Number(env.KIS_UNIVERSE_SIZE), fallback);
}

/**
 * Snapshot/batch universe size — defaults to the full KOSPI200 pool. Decoupled
 * from the inline size so the scheduled refresh (and background warm) can cover
 * every stock while the live request still paints quickly.
 */
function resolveSnapshotUniverseSize(env: Record<string, string | undefined>): number {
  return clampSize(Number(env.KIS_SNAPSHOT_UNIVERSE_SIZE), KOSPI200_POOL.length);
}

function selectUniverse(size: number): StockSeed[] {
  return KOSPI200_POOL.slice(0, size).map((entry) => ({
    code: entry.code,
    name: entry.name,
    market: entry.market,
  }));
}

const INDEX_UNIVERSE: Array<{ code: string; name: string; symbol: string; yahooSymbol: string }> = [
  { code: "0001", name: "코스피", symbol: "KOSPI", yahooSymbol: "^KS11" },
  { code: "1001", name: "코스닥", symbol: "KOSDAQ", yahooSymbol: "^KQ11" },
  { code: "2001", name: "코스피200", symbol: "KOSPI200", yahooSymbol: "^KS200" },
];

let tokenCache: TokenCache | null = null;

const stockChartCache = new Map<string, { builtAt: number; data: StockChartBundle }>();
const indexSeriesCache = new Map<string, { builtAt: number; values: number[] }>();
const DEFAULT_STOCK_CHART_CACHE_TTL_MS = 60_000;
const DEFAULT_INTRADAY_PAGE_COUNT = 14;
const DEFAULT_INDEX_SERIES_CACHE_TTL_MS = 10 * 60_000;

function getTokenCachePath(): string {
  return join(process.cwd(), ".kis-token-cache.json");
}

function stockChartCacheTtlMs(env: Record<string, string | undefined>): number {
  const parsed = Number(env.KIS_STOCK_CHART_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STOCK_CHART_CACHE_TTL_MS;
}

function indexSeriesCacheTtlMs(env: Record<string, string | undefined>): number {
  const parsed = Number(env.KIS_INDEX_SERIES_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INDEX_SERIES_CACHE_TTL_MS;
}

function intradayPageCount(env: Record<string, string | undefined>): number {
  const parsed = Number(env.KIS_INTRADAY_PAGE_COUNT);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 20) : DEFAULT_INTRADAY_PAGE_COUNT;
}

function isFreshToken(cache: TokenCache | null, cacheKey: string): cache is TokenCache {
  return Boolean(cache && cache.cacheKey === cacheKey && cache.expiresAt - 60_000 > Date.now());
}

async function readCachedToken(cacheKey: string): Promise<TokenCache | null> {
  if (isFreshToken(tokenCache, cacheKey)) {
    return tokenCache;
  }

  try {
    const parsed = JSON.parse(await readFile(getTokenCachePath(), "utf8")) as TokenCache;
    if (isFreshToken(parsed, cacheKey)) {
      tokenCache = parsed;
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

async function writeCachedToken(cache: TokenCache): Promise<void> {
  tokenCache = cache;

  try {
    await writeFile(getTokenCachePath(), JSON.stringify(cache), "utf8");
  } catch {
    // A read-only deploy filesystem (e.g. Vercel) is fine — the in-memory copy
    // still covers warm invocations; cold ones request a fresh token.
  }
}

function getKisEnv(env: Record<string, string | undefined>): KisEnv {
  return env.KIS_ENV === "real" ? "real" : "mock";
}

function getKisConfig(env = process.env): KisConfig {
  const kisEnv = getKisEnv(env);
  const appKey =
    kisEnv === "real"
      ? env.KIS_REAL_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY
      : env.KIS_MOCK_APP_KEY ?? env.KIS_APP_KEY ?? env.APP_KEY;
  const appSecret =
    kisEnv === "real"
      ? env.KIS_REAL_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET
      : env.KIS_MOCK_APP_SECRET ?? env.KIS_APP_SECRET ?? env.APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error(
      "KIS API key is not configured. Set APP_KEY/APP_SECRET, KIS_APP_KEY/KIS_APP_SECRET, or KIS_MOCK_APP_KEY/KIS_MOCK_APP_SECRET.",
    );
  }

  return {
    appKey,
    appSecret,
    baseUrl: (env.KIS_BASE_URL ?? KIS_BASE_URLS[kisEnv]).replace(/\/$/, ""),
    env: kisEnv,
    requestDelayMs: toNumber(env.KIS_REQUEST_DELAY_MS) || (kisEnv === "mock" ? 1000 : 200),
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function pickNumber(output: KisOutput, keys: string[]): number {
  for (const key of keys) {
    if (output[key] !== undefined && output[key] !== null && output[key] !== "") {
      return toNumber(output[key]);
    }
  }

  return 0;
}

function directionFromKis(sign: unknown, changeRate: number): MarketDirection {
  const signText = String(sign ?? "");

  if (signText === "1" || signText === "2" || changeRate > 0) {
    return "up";
  }

  if (signText === "4" || signText === "5" || changeRate < 0) {
    return "down";
  }

  return "flat";
}

function signedChange(rawChange: number, direction: MarketDirection): number {
  if (direction === "down") {
    return -Math.abs(rawChange);
  }

  if (direction === "up") {
    return Math.abs(rawChange);
  }

  return 0;
}

function miniSeriesFromChange(current: number, change: number): number[] {
  const previous = current - change;
  const start = previous > 0 ? previous : current;
  const steps = 7;

  return Array.from({ length: steps + 1 }, (_, index) => {
    const ratio = index / steps;
    return Math.round(start + (current - start) * ratio);
  });
}

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

function roundIndexValue(value: number): number {
  return Math.round(value * 100) / 100;
}

async function fetchYahooIndexSeries(
  yahooSymbol: string,
  env: Record<string, string | undefined>,
): Promise<number[]> {
  if (env.KIS_INDEX_SERIES_SOURCE === "off") {
    return [];
  }

  const cached = indexSeriesCache.get(yahooSymbol);
  const ttlMs = indexSeriesCacheTtlMs(env);
  if (cached && Date.now() - cached.builtAt < ttlMs) {
    return cached.values;
  }

  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
  );
  url.searchParams.set("range", "1mo");
  url.searchParams.set("interval", "1d");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "kospi-ai-trading-dashboard/0.1",
    },
  });
  if (!response.ok) {
    throw new Error(`Yahoo index chart failed: ${response.status} ${response.statusText}`);
  }

  const parsed = (await response.json()) as YahooChartResponse;
  const closes = parsed.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const values = closes
    .map((value) => (typeof value === "number" && Number.isFinite(value) ? roundIndexValue(value) : null))
    .filter((value): value is number => value !== null)
    .slice(-24);

  if (values.length < 2) {
    throw new Error("Yahoo index chart returned too few close prices.");
  }

  indexSeriesCache.set(yahooSymbol, { builtAt: Date.now(), values });
  return values;
}

function seriesWithCurrentValue(series: number[], current: number): number[] {
  if (series.length < 2 || !Number.isFinite(current) || current <= 0) {
    return series;
  }

  const last = series[series.length - 1] ?? current;
  const differenceRate = Math.abs(current - last) / Math.max(Math.abs(last), 1);
  if (differenceRate > 0.05) {
    return [];
  }

  return [...series.slice(0, -1), roundIndexValue(current)];
}

async function indexMiniSeriesFromHistory(
  index: (typeof INDEX_UNIVERSE)[number],
  current: number,
  change: number,
  env: Record<string, string | undefined>,
): Promise<{ miniSeries: number[]; miniSeriesSource: "history" | "interpolated" }> {
  try {
    const series = await fetchYahooIndexSeries(index.yahooSymbol, env);
    const alignedSeries = seriesWithCurrentValue(series, current);
    if (alignedSeries.length >= 2) {
      return { miniSeries: alignedSeries, miniSeriesSource: "history" };
    }

    return { miniSeries: miniSeriesFromChange(current, change), miniSeriesSource: "interpolated" };
  } catch (error) {
    console.warn(
      `[kis] ${index.symbol} index history fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { miniSeries: miniSeriesFromChange(current, change), miniSeriesSource: "interpolated" };
  }
}

function sentimentFromDirection(direction: MarketDirection): StockQuote["sentimentLabel"] {
  if (direction === "up") {
    return "POSITIVE";
  }

  if (direction === "down") {
    return "NEGATIVE";
  }

  return "NEUTRAL";
}

async function parseKisBody(response: Response, apiName: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${apiName} returned a non-JSON response.`);
  }

  if (!response.ok || (body.rt_cd !== undefined && body.rt_cd !== "0")) {
    const message = typeof body.msg1 === "string" ? body.msg1 : response.statusText;
    throw new Error(`${apiName} failed: ${message}`);
  }

  return body;
}

async function parseKisResponse(response: Response, apiName: string): Promise<KisOutput> {
  const body = await parseKisBody(response, apiName);

  const output = body.output;
  if (!output || typeof output !== "object") {
    throw new Error(`${apiName} returned no output.`);
  }

  return output as KisOutput;
}

async function getAccessToken(config: KisConfig): Promise<string> {
  const cacheKey = `${config.env}:${config.baseUrl}:${config.appKey}`;
  const cached = await readCachedToken(cacheKey);

  if (cached) {
    return cached.accessToken;
  }

  const now = Date.now();
  const response = await fetch(`${config.baseUrl}/oauth2/tokenP`, {
    body: JSON.stringify({
      appkey: config.appKey,
      appsecret: config.appSecret,
      grant_type: "client_credentials",
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(20000),
  });

  const text = await response.text();
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("KIS token request returned a non-JSON response.");
  }

  if (!response.ok || typeof body.access_token !== "string") {
    const message = typeof body.error_description === "string" ? body.error_description : response.statusText;
    throw new Error(`KIS token request failed: ${message}`);
  }

  const expiresIn = toNumber(body.expires_in);
  const nextCache = {
    accessToken: body.access_token,
    cacheKey,
    expiresAt: now + Math.max(expiresIn, 60 * 30) * 1000,
  };

  await writeCachedToken(nextCache);
  return nextCache.accessToken;
}

async function requestKisOutput(
  config: KisConfig,
  accessToken: string,
  apiPath: string,
  trId: string,
  params: Record<string, string>,
): Promise<KisOutput> {
  const url = new URL(apiPath, config.baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      appkey: config.appKey,
      appsecret: config.appSecret,
      custtype: "P",
      tr_id: trId,
    },
    method: "GET",
    signal: AbortSignal.timeout(20000),
  });

  return parseKisResponse(response, trId);
}

async function requestKisBody(
  config: KisConfig,
  accessToken: string,
  apiPath: string,
  trId: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(apiPath, config.baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      appkey: config.appKey,
      appsecret: config.appSecret,
      custtype: "P",
      tr_id: trId,
    },
    method: "GET",
    signal: AbortSignal.timeout(20000),
  });

  return parseKisBody(response, trId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function requestWithRetry(
  config: KisConfig,
  accessToken: string,
  apiPath: string,
  trId: string,
  params: Record<string, string>,
): Promise<KisOutput> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await requestKisOutput(config, accessToken, apiPath, trId, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("초당 거래건수")) {
        throw error;
      }

      lastError = error;
      await sleep(config.requestDelayMs * (attempt + 2));
    }
  }

  throw lastError;
}

async function requestBodyWithRetry(
  config: KisConfig,
  accessToken: string,
  apiPath: string,
  trId: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await requestKisBody(config, accessToken, apiPath, trId, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("초당 거래건수")) {
        throw error;
      }

      lastError = error;
      await sleep(config.requestDelayMs * (attempt + 2));
    }
  }

  throw lastError;
}

async function mapSequential<T, U>(
  items: T[],
  delayMs: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];

  for (const item of items) {
    if (results.length > 0) {
      await sleep(delayMs);
    }

    results.push(await mapper(item));
  }

  return results;
}

type FetchStockOptions = {
  aiRow?: PipelineOutputRow;
  withInvestorFlow?: boolean;
};

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

function pickNullableNumber(output: KisOutput, keys: string[]): number | null {
  for (const key of keys) {
    const number = toFiniteOrNull(output[key]);
    if (number !== null) return number;
  }
  return null;
}

function nullableSigned(value: number | null, direction: MarketDirection): number | null {
  return value === null ? null : signedChange(value, direction);
}

/** Preserve upstream absence for new consumers alongside legacy numeric fields. */
function rawQuoteValues(output: KisOutput, direction: MarketDirection): NonNullable<StockQuote["rawValues"]> {
  return {
    currentPrice: pickNullableNumber(output, ["stck_prpr"]),
    change: nullableSigned(pickNullableNumber(output, ["prdy_vrss"]), direction),
    changeRate: nullableSigned(pickNullableNumber(output, ["prdy_ctrt"]), direction),
    accumulatedVolume: pickNullableNumber(output, ["acml_vol"]),
    tradingValue: pickNullableNumber(output, ["acml_tr_pbmn"]),
  };
}

function upProbabilityFromRow(aiRow: PipelineOutputRow | undefined): number | null {
  return toFiniteOrNull(aiRow?.input_row?.p_up);
}

function modelScoreFromRow(aiRow: PipelineOutputRow | undefined): number | null {
  const pUp = upProbabilityFromRow(aiRow);
  if (pUp !== null) {
    return null;
  }

  return toFiniteOrNull(aiRow?.input_row?.ensemble_pred_return) ?? toFiniteOrNull(aiRow?.input_row?.lstm_pred_return);
}

/**
 * Latest-session net buying per investor group from the KIS investor-trend
 * endpoint. The output is a daily array (newest first). Failures degrade to
 * zeros so a missing/rate-limited investor call never breaks the quote.
 */
async function fetchInvestorFlow(
  config: KisConfig,
  accessToken: string,
  code: string,
): Promise<StockQuote["investorFlow"]> {
  try {
    const output = await requestWithRetry(
      config,
      accessToken,
      "/uapi/domestic-stock/v1/quotations/inquire-investor",
      "FHKST01010900",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: code,
      },
    );

    // The daily rows arrive newest-first, but the current session's row is
    // often blank intraday (and the mock env omits investor data entirely), so
    // use the most recent row that actually carries net-buy figures.
    const rows = Array.isArray(output) ? (output as KisOutput[]) : [output];
    const hasData = (row: KisOutput) =>
      [row.prsn_ntby_qty, row.frgn_ntby_qty, row.orgn_ntby_qty].some(
        (value) => value !== undefined && value !== null && String(value).trim() !== "",
      );
    const latest = rows.find(hasData);
    if (!latest) {
      return { foreign: 0, institution: 0, personal: 0 };
    }

    return {
      personal: pickNumber(latest, ["prsn_ntby_qty"]),
      foreign: pickNumber(latest, ["frgn_ntby_qty"]),
      institution: pickNumber(latest, ["orgn_ntby_qty"]),
    };
  } catch {
    return { foreign: 0, institution: 0, personal: 0 };
  }
}

function mergeAiFields(direction: MarketDirection, aiRow: PipelineOutputRow | undefined) {
  if (!aiRow) {
    return {
      aiSummary: "KIS 현재가 API 기준 시세입니다. AI 예측값은 분석 파이프라인 결과가 연결되면 표시됩니다.",
      confidence: 0,
      predictedReturn: null as number | null,
      sentimentLabel: sentimentFromDirection(direction),
      upProbability: null as number | null,
    };
  }

  const predictedReturn = modelScoreFromRow(aiRow);

  return {
    aiSummary: aiRow.result?.summary?.trim()
      ? aiRow.result.summary
      : "KIS 현재가 API 기준 시세입니다.",
    confidence: toFiniteOrNull(aiRow.result?.confidence) ?? 0,
    predictedReturn,
    sentimentLabel: aiRow.result?.label ?? sentimentFromDirection(direction),
    upProbability: upProbabilityFromRow(aiRow),
  };
}

async function fetchStockQuote(
  config: KisConfig,
  accessToken: string,
  stock: StockSeed,
  options: FetchStockOptions = {},
): Promise<StockQuote> {
  const output = await requestWithRetry(
    config,
    accessToken,
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: stock.code,
    },
  );

  const currentPrice = pickNumber(output, ["stck_prpr"]);
  const changeRate = pickNumber(output, ["prdy_ctrt"]);
  const direction = directionFromKis(output.prdy_vrss_sign, changeRate);
  const change = signedChange(pickNumber(output, ["prdy_vrss"]), direction);
  const accumulatedVolume = pickNumber(output, ["acml_vol"]);
  const tradingValue = pickNumber(output, ["acml_tr_pbmn"]) || currentPrice * accumulatedVolume;
  const name = typeof output.hts_kor_isnm === "string" && output.hts_kor_isnm.trim() ? output.hts_kor_isnm : stock.name;

  const investorFlow = options.withInvestorFlow
    ? await (async () => {
        await sleep(config.requestDelayMs);
        return fetchInvestorFlow(config, accessToken, stock.code);
      })()
    : { foreign: 0, institution: 0, personal: 0 };

  const ai = mergeAiFields(direction, options.aiRow);

  return {
    code: stock.code,
    rawValues: rawQuoteValues(output, direction),
    name,
    market: stock.market,
    // Every live quote comes from the KOSPI200 pool, so mark membership
    // explicitly — the FE filter can't infer it for codes outside its mock set.
    isKospi200: true,
    currentPrice,
    change,
    changeRate,
    direction,
    accumulatedVolume,
    tradingValue,
    tradingValueRank: 0,
    investorFlow,
    aiSummary: ai.aiSummary,
    sentimentLabel: ai.sentimentLabel,
    confidence: ai.confidence,
    predictedReturn: ai.predictedReturn,
    upProbability: ai.upProbability,
    miniSeries: miniSeriesFromChange(currentPrice, change),
  } satisfies StockQuote;
}

async function fetchIndexSnapshot(
  config: KisConfig,
  accessToken: string,
  index: (typeof INDEX_UNIVERSE)[number],
  env: Record<string, string | undefined>,
): Promise<MarketIndexSnapshot> {
  const output = await requestWithRetry(
    config,
    accessToken,
    "/uapi/domestic-stock/v1/quotations/inquire-index-price",
    "FHPUP02100000",
    {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: index.code,
    },
  );

  const value = pickNumber(output, ["bstp_nmix_prpr", "stck_prpr"]);
  const changeRate = pickNumber(output, ["bstp_nmix_prdy_ctrt", "prdy_ctrt"]);
  const direction = directionFromKis(output.prdy_vrss_sign ?? output.bstp_nmix_prdy_vrss_sign, changeRate);
  const change = signedChange(pickNumber(output, ["bstp_nmix_prdy_vrss", "prdy_vrss"]), direction);

  return {
    symbol: index.symbol,
    rawValues: {
      value: pickNullableNumber(output, ["bstp_nmix_prpr", "stck_prpr"]),
      change: nullableSigned(pickNullableNumber(output, ["bstp_nmix_prdy_vrss", "prdy_vrss"]), direction),
      changeRate: nullableSigned(pickNullableNumber(output, ["bstp_nmix_prdy_ctrt", "prdy_ctrt"]), direction),
    },
    name: index.name,
    value,
    change,
    changeRate,
    direction,
    ...await indexMiniSeriesFromHistory(index, value, change, env),
    source: "live",
    asOf: new Date().toISOString(),
  } satisfies MarketIndexSnapshot;
}

async function fetchIndexSnapshots(
  config: KisConfig,
  accessToken: string,
  env: Record<string, string | undefined>,
): Promise<MarketIndexSnapshot[]> {
  const indexResults = await mapSequential(INDEX_UNIVERSE, config.requestDelayMs, async (index) => {
    try {
      return await fetchIndexSnapshot(config, accessToken, index, env);
    } catch (error) {
      console.warn(
        `[kis] index ${index.symbol} fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  });

  const indices = indexResults.filter((index): index is MarketIndexSnapshot => index !== null);
  if (indices.length === 0) {
    throw new Error("KIS returned no valid market index snapshots.");
  }

  return indices;
}

/**
 * Fast index-only endpoint data. The full dashboard also fetches stock quotes,
 * which can take a while or fall back to an old snapshot; this keeps the
 * headline KOSPI200 card tied to fresh KIS index data.
 */
export async function buildKisIndices(env = process.env): Promise<MarketIndexSnapshot[]> {
  const config = getKisConfig(env);
  const accessToken = await getAccessToken(config);
  return fetchIndexSnapshots(config, accessToken, env);
}

/** Fast single-stock quote endpoint for detail headers. */
export async function buildKisStockQuote(symbol: string, env = process.env): Promise<StockQuote> {
  const code = normalizeStockCode(symbol);
  const seed = findStockSeed(code);
  const config = getKisConfig(env);
  const accessToken = await getAccessToken(config);
  const pipelineRows = await loadPipelineRows();
  const aiByTicker = pipelineRows ? indexPipelineByTicker(pipelineRows) : null;

  const quote = await fetchStockQuote(config, accessToken, seed, {
    aiRow: aiByTicker?.get(code),
    withInvestorFlow: env.KIS_QUOTE_WITH_INVESTOR_FLOW === "true",
  });
  return { ...quote, source: "live", asOf: new Date().toISOString() };
}

const RANGE_LOOKBACK_DAYS: Record<TimeRange, number> = {
  "1D": 7,
  "1M": 45,
  "3M": 120,
  "1Y": 390,
  "3Y": 365 * 3 + 45,
  "5Y": 365 * 5 + 60,
};

const RANGE_PERIOD_CODE: Record<Exclude<TimeRange, "1D">, "D" | "W" | "M"> = {
  "1M": "D",
  "3M": "D",
  "1Y": "D",
  "3Y": "W",
  "5Y": "M",
};

/**
 * Ranges actually fetched from KIS per chart build. 1M is sliced from 3M and 3Y
 * from 5Y locally (see {@link fillMissingRanges}), so we make 4 chart calls
 * instead of 6 — faster, and 3Y/1M can't end up empty just because their own
 * rate-limited call failed.
 */
const CHART_FETCH_RANGES: TimeRange[] = ["1D", "3M", "1Y", "5Y"];

const SUMMARY_FALLBACKS: Record<string, Partial<Pick<StockSummary, "dividendYield">>> = {
  "000660": {
    dividendYield: 0.1,
  },
};

function normalizeStockCode(symbol: string): string {
  const code = symbol.replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(code)) {
    throw new Error("A 6-digit KOSPI stock code is required.");
  }

  return code;
}

function findStockSeed(code: string): StockSeed {
  const entry = KOSPI200_POOL.find((stock) => stock.code === code);
  return {
    code,
    market: "KOSPI",
    name: entry?.name ?? code,
  };
}

function getKoreanDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return {
    day: part("day"),
    month: part("month"),
    year: part("year"),
  };
}

function formatKisDate(date: Date): string {
  const parts = getKoreanDateParts(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

function kisDateDaysAgo(daysAgo: number): string {
  return formatKisDate(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
}

/** ISO `YYYY-MM-DD` for N days ago — matches `CandlePoint.time` for slicing. */
function isoDateDaysAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function todayKisDate(): string {
  return formatKisDate(new Date());
}

function normalizeKisDate(value: unknown): string {
  const text = String(value ?? "").replace(/\D/g, "");
  if (text.length >= 8) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  return todayKisDate().replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
}

function normalizeKisTime(date: unknown, time: unknown): string {
  const dateText = normalizeKisDate(date);
  const timeText = String(time ?? "").replace(/\D/g, "").padStart(6, "0").slice(0, 6);

  return `${dateText}T${timeText.slice(0, 2)}:${timeText.slice(2, 4)}:${timeText.slice(4, 6)}+09:00`;
}

function rowTimeValue(row: KisOutput): string {
  return String(row.stck_cntg_hour ?? row.cntg_hour ?? "").replace(/\D/g, "").padStart(6, "0").slice(0, 6);
}

function previousMinute(timeText: string): string | null {
  if (!/^\d{6}$/.test(timeText)) {
    return null;
  }

  const hours = Number(timeText.slice(0, 2));
  const minutes = Number(timeText.slice(2, 4));
  const totalMinutes = hours * 60 + minutes - 1;
  if (!Number.isFinite(totalMinutes) || totalMinutes < 9 * 60) {
    return null;
  }

  const nextHours = Math.floor(totalMinutes / 60);
  const nextMinutes = totalMinutes % 60;
  return `${String(nextHours).padStart(2, "0")}${String(nextMinutes).padStart(2, "0")}00`;
}

function outputRows(body: Record<string, unknown>): KisOutput[] {
  const output2 = body.output2;
  if (Array.isArray(output2)) {
    return output2.filter((row): row is KisOutput => typeof row === "object" && row !== null);
  }

  const output = body.output;
  if (Array.isArray(output)) {
    return output.filter((row): row is KisOutput => typeof row === "object" && row !== null);
  }

  if (output && typeof output === "object") {
    return [output as KisOutput];
  }

  return [];
}

function uniqueSortedCandles(candles: CandlePoint[]): CandlePoint[] {
  const byTime = new Map<string, CandlePoint>();
  candles.forEach((candle) => {
    byTime.set(candle.time, candle);
  });

  return Array.from(byTime.values()).sort((left, right) => left.time.localeCompare(right.time));
}

function latestSessionCandles(candles: CandlePoint[]): CandlePoint[] {
  const sorted = uniqueSortedCandles(candles);
  const latestDate = sorted
    .map((candle) => candle.time.slice(0, 10))
    .filter(Boolean)
    .reduce((latest, value) => (value > latest ? value : latest), "");

  return latestDate ? sorted.filter((candle) => candle.time.startsWith(latestDate)) : sorted;
}

function dailyRowToCandle(row: KisOutput): CandlePoint | null {
  const close = pickNumber(row, ["stck_clpr", "stck_prpr"]);
  if (close <= 0) {
    return null;
  }

  const open = pickNumber(row, ["stck_oprc"]) || close;
  const high = pickNumber(row, ["stck_hgpr"]) || Math.max(open, close);
  const low = pickNumber(row, ["stck_lwpr"]) || Math.min(open, close);

  return {
    close,
    high,
    low,
    open,
    time: normalizeKisDate(row.stck_bsop_date ?? row.bsop_date),
    volume: pickNumber(row, ["acml_vol", "cntg_vol"]),
    rawTime: rawCandleTime(row.stck_bsop_date ?? row.bsop_date),
    rawValues: rawCandleValues(row, false),
  };
}

function timeRowToCandle(row: KisOutput): CandlePoint | null {
  const close = pickNumber(row, ["stck_prpr", "stck_clpr"]);
  if (close <= 0) {
    return null;
  }

  const open = pickNumber(row, ["stck_oprc"]) || close;
  const high = pickNumber(row, ["stck_hgpr"]) || Math.max(open, close);
  const low = pickNumber(row, ["stck_lwpr"]) || Math.min(open, close);

  return {
    close,
    high,
    low,
    open,
    time: normalizeKisTime(row.stck_bsop_date ?? row.bsop_date, row.stck_cntg_hour ?? row.cntg_hour),
    volume: pickNumber(row, ["cntg_vol", "acml_vol"]),
    rawTime: rawCandleTime(row.stck_bsop_date ?? row.bsop_date, row.stck_cntg_hour ?? row.cntg_hour, true),
    rawValues: rawCandleValues(row, true),
  };
}

function candlesToPrices(candles: CandlePoint[]): PricePoint[] {
  return candles.map((candle) => ({
    date: candle.time,
    price: candle.close,
    rawDate: candle.rawTime ?? null,
  }));
}

/** Raw same-day prices for settlement: no adjusted/fallback/synthesized OHLC. */
export async function fetchKisSettlementPrice(code: string, date: string, env = process.env): Promise<{ date: string; open: number; close: number; volume: number } | null> {
  if (!/^\d{6}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid settlement query.");
  const config = getKisConfig(env), token = await getAccessToken(config);
  const body = await requestBodyWithRetry(config, token, "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice", "FHKST03010100", {
    FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code, FID_INPUT_DATE_1: date.replace(/-/g, ""), FID_INPUT_DATE_2: date.replace(/-/g, ""),
    FID_PERIOD_DIV_CODE: "D", FID_ORG_ADJ_PRC: "1",
  });
  await sleep(config.requestDelayMs);
  const matches = outputRows(body).filter(row => String(row.stck_bsop_date) === date.replace(/-/g, ""));
  if (matches.length !== 1) return null;
  const row = matches[0], open = pickNullableNumber(row, ["stck_oprc"]), close = pickNullableNumber(row, ["stck_clpr"]), volume = pickNullableNumber(row, ["acml_vol"]);
  return open !== null && open > 0 && close !== null && close > 0 && volume !== null && volume > 0 ? { date, open, close, volume } : null;
}

type TradingCalendarCache = { fetchedDate: string; days: Record<string, boolean>; observedTargets?: Record<string, string> };
const calendarMemory = new Map<string, TradingCalendarCache>();
/** Quote-only keys may not access the account calendar. Historical KOSPI sessions still prove the next completed trading day. */
async function observedNextSession(baseDate: string, config: KisConfig): Promise<string | null> {
  const end = new Date(Math.min(Date.parse(`${baseDate}T00:00:00Z`) + 31 * 86400000, Date.now())).toISOString().slice(0, 10);
  const body = await requestBodyWithRetry(config, await getAccessToken(config), "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice", "FHKUP03500100", {
    FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "0001", FID_INPUT_DATE_1: baseDate.replace(/-/g, ""), FID_INPUT_DATE_2: end.replace(/-/g, ""), FID_PERIOD_DIV_CODE: "D",
  });
  await sleep(config.requestDelayMs);
  const dates = outputRows(body).filter(row => /^\d{8}$/.test(String(row.stck_bsop_date)) && (pickNullableNumber(row, ["bstp_nmix_prpr"]) ?? 0) > 0)
    .map(row => String(row.stck_bsop_date)).sort();
  // Presence of the base session proves the returned range has not been truncated before the next session.
  if (!dates.includes(baseDate.replace(/-/g, ""))) return null;
  const next = dates.find(date => date > baseDate.replace(/-/g, "") && date <= end.replace(/-/g, ""));
  return next ? `${next.slice(0, 4)}-${next.slice(4, 6)}-${next.slice(6, 8)}` : null;
}
/** KIS recommends one calendar request daily. Reuse the returned date range on disk across restarts. */
export async function fetchKisTargetSession(baseDate: string, env = process.env): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || !Number.isFinite(Date.parse(baseDate))) throw new Error("Invalid calendar query.");
  const config = getKisConfig(env);
  if (config.env !== "real") throw new Error("Settlement requires the real KIS calendar.");
  const path = join(pipelineOutputDir(env), ".performance-calendar.json"), today = todayKisDate();
  let cache = calendarMemory.get(path) ?? null;
  if (!cache) { try { cache = JSON.parse(await readFile(path, "utf8")) as TradingCalendarCache; } catch { cache = null; } }
  const target = (data: TradingCalendarCache | null) => {
    if (!data?.days || data.days[baseDate] !== true) return null;
    for (let day = 1; day <= 31; day++) {
      const date = new Date(Date.parse(`${baseDate}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
      if (typeof data.days[date] !== "boolean") return null;
      if (data.days[date]) return date;
    }
    return null;
  };
  const found = target(cache) ?? cache?.observedTargets?.[baseDate]; if (found) return found;
  const days: Record<string, boolean> = { ...cache?.days };
  if (cache?.fetchedDate !== today) {
    try {
      const body = await requestBodyWithRetry(config, await getAccessToken(config), "/uapi/domestic-stock/v1/quotations/chk-holiday", "CTCA0903R", {
    BASS_DT: baseDate.replace(/-/g, ""), CTX_AREA_FK: "", CTX_AREA_NK: "",
  });
      for (const row of outputRows(body)) {
    const date = String(row.bass_dt ?? "");
    if (/^\d{8}$/.test(date) && ["Y", "N"].includes(String(row.opnd_yn)) && ["Y", "N"].includes(String(row.tr_day_yn))) days[`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`] = row.opnd_yn === "Y" && row.tr_day_yn === "Y";
      }
    } catch { /* Account calendar is unavailable with some quote-only app keys. Verify observed sessions below. */ }
  }
  cache = { fetchedDate: today, days, observedTargets: { ...cache?.observedTargets } };
  const calendarTarget = target(cache);
  calendarMemory.set(path, cache);
  await mkdir(pipelineOutputDir(env), { recursive: true });
  await writeFile(path, JSON.stringify(cache), "utf8");
  if (calendarTarget) return calendarTarget;
  const observed = await observedNextSession(baseDate, config);
  if (observed) { cache.observedTargets![baseDate] = observed; await writeFile(path, JSON.stringify(cache), "utf8"); }
  return observed;
}

/** Raw observation time never inherits legacy today/midnight defaults. */
function rawCandleTime(date: unknown, time?: unknown, intraday = false): string | null {
  if (typeof date !== "string" || !/^\d{8}$/.test(date)) return null;
  const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  if (!intraday) return day;
  if (typeof time !== "string" || !/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(time)) return null;
  return `${day}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`;
}

function rawCandleValues(row: KisOutput, intraday: boolean): NonNullable<CandlePoint["rawValues"]> {
  return { open: pickNullableNumber(row, ["stck_oprc"]), high: pickNullableNumber(row, ["stck_hgpr"]), low: pickNullableNumber(row, ["stck_lwpr"]),
    close: pickNullableNumber(row, intraday ? ["stck_prpr", "stck_clpr"] : ["stck_clpr", "stck_prpr"]),
    volume: pickNullableNumber(row, intraday ? ["cntg_vol", "acml_vol"] : ["acml_vol", "cntg_vol"]) };
}

async function fetchDailyChartRange(
  config: KisConfig,
  accessToken: string,
  code: string,
  range: Exclude<TimeRange, "1D">,
  rawPrices?: { date: string | null; price: number | null }[],
): Promise<CandlePoint[]> {
  const body = await requestBodyWithRetry(
    config,
    accessToken,
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    "FHKST03010100",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_DATE_1: kisDateDaysAgo(RANGE_LOOKBACK_DAYS[range]),
      FID_INPUT_DATE_2: todayKisDate(),
      FID_INPUT_ISCD: code,
      FID_ORG_ADJ_PRC: "0",
      FID_PERIOD_DIV_CODE: RANGE_PERIOD_CODE[range],
    },
  );

  const rows = outputRows(body);
  rawPrices?.push(...rows.map(row => ({ date: rawCandleTime(row.stck_bsop_date ?? row.bsop_date), price: pickNullableNumber(row, ["stck_clpr", "stck_prpr"]) })));
  return uniqueSortedCandles(rows.map(dailyRowToCandle).filter((candle): candle is CandlePoint => candle !== null));
}

async function fetchIntradayChartRange(
  config: KisConfig,
  accessToken: string,
  code: string,
  pageCount: number,
  rawPrices?: { date: string | null; price: number | null }[],
): Promise<CandlePoint[]> {
  const candles: CandlePoint[] = [];
  let cursorTime: string | null = "153000";
  let previousOldestTime: string | null = null;

  for (let page = 0; page < pageCount && cursorTime; page += 1) {
    if (page > 0) {
      await sleep(config.requestDelayMs);
    }

    const body = await requestBodyWithRetry(
      config,
      accessToken,
      "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
      "FHKST03010200",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_ETC_CLS_CODE: "",
        FID_INPUT_HOUR_1: cursorTime,
        FID_INPUT_ISCD: code,
        FID_PW_DATA_INCU_YN: "Y",
      },
    );

    const rows = outputRows(body);
    if (rows.length === 0) {
      break;
    }

    candles.push(...rows.map(timeRowToCandle).filter((candle): candle is CandlePoint => candle !== null));
    rawPrices?.push(...rows.map(row => ({ date: rawCandleTime(row.stck_bsop_date ?? row.bsop_date, row.stck_cntg_hour ?? row.cntg_hour, true), price: pickNullableNumber(row, ["stck_prpr", "stck_clpr"]) })));

    const rowTimes = rows.map(rowTimeValue).filter((value) => /^\d{6}$/.test(value));
    if (rowTimes.length === 0) {
      break;
    }

    const oldestTime = rowTimes.reduce((oldest, value) => (value < oldest ? value : oldest));
    if (oldestTime === previousOldestTime || oldestTime <= "090000") {
      break;
    }

    previousOldestTime = oldestTime;
    cursorTime = previousMinute(oldestTime);
  }

  if (rawPrices) {
    const rawDays = rawPrices.map(point => point.date?.slice(0, 10) ?? "").sort();
    const latestRawDay = rawDays[rawDays.length - 1];
    const seen = new Set<string>();
    const latestRaw = rawPrices.filter(point => {
      if (point.date === null) return true; // Unknown position stays a gap marker, never today's observation.
      if (point.date.slice(0, 10) !== latestRawDay || seen.has(point.date)) return false;
      seen.add(point.date); return true;
    });
    rawPrices.splice(0, rawPrices.length, ...latestRaw);
  }
  return latestSessionCandles(candles);
}

function chartCoverage(target: TimeRange, sourceRange: TimeRange, method: "requested" | "subset" | "fallback", rawPrices: { date: string | null; price: number | null }[]) {
  const dates = rawPrices.filter(point => point.date !== null && point.price !== null && point.price > 0).map(point => point.date!.slice(0, 10)).sort();
  return { requestedRange: target, sourceRange, method,
    status: !dates.length ? "empty" as const : RANGE_LOOKBACK_DAYS[sourceRange] < RANGE_LOOKBACK_DAYS[target] ? "partial" as const : "unverified" as const,
    requestedStart: target === "1D" ? null : isoDateDaysAgo(RANGE_LOOKBACK_DAYS[target]), requestedEnd: target === "1D" ? null : isoDateDaysAgo(0),
    observedStart: dates[0] ?? null, observedEnd: dates[dates.length - 1] ?? null };
}

async function fetchRangeChart(
  config: KisConfig,
  accessToken: string,
  code: string,
  range: TimeRange,
  env: Record<string, string | undefined>,
): Promise<StockChartData["ranges"][TimeRange]> {
  const rawPrices: { date: string | null; price: number | null }[] = [];
  const candles =
    range === "1D"
      ? await fetchIntradayChartRange(config, accessToken, code, intradayPageCount(env), rawPrices)
      : await fetchDailyChartRange(config, accessToken, code, range, rawPrices);

  return {
    candles,
    prices: candlesToPrices(candles),
    rawPrices,
    coverage: chartCoverage(range, range, "requested", rawPrices),
  };
}

function normalizeMarketCap(output: KisOutput, currentPrice: number): number {
  const rawMarketCap = pickNumber(output, ["hts_avls"]);
  if (rawMarketCap > 0) {
    return rawMarketCap < 10_000_000_000 ? rawMarketCap * 100_000_000 : rawMarketCap;
  }

  const listedShares = pickNumber(output, ["lstn_stcn", "lstn_stk_qty"]);
  return listedShares > 0 ? listedShares * currentPrice : 0;
}

function quotePreviousVolume(output: KisOutput): number {
  return pickNumber(output, [
    "prdy_vol",
    "prdy_acml_vol",
    "prdy_tvol",
    "bfdy_vol",
    "prev_vol",
    "prev_acml_vol",
  ]);
}

function quoteDividendYield(output: KisOutput): number {
  return pickNumber(output, [
    "dvd_yld",
    "dvdn_yld",
    "dvid_yld",
    "divi_yld",
    "stck_dvd_yld",
    "stck_dvdn_yld",
    "dvdn_rt",
    "dvid_rt",
    "dryy_bnf_rt",
    "bnf_rt",
  ]);
}

function previousVolumeFromDailyCandles(candles: CandlePoint[], currentPrice: number): number {
  const sorted = uniqueSortedCandles(candles).filter((candle) => (candle.volume ?? 0) > 0);
  if (sorted.length === 0) {
    return 0;
  }

  const latest = sorted[sorted.length - 1];
  const latestMatchesCurrentQuote = Math.abs(latest.close - currentPrice) <= Math.max(currentPrice * 0.0005, 1);
  const selected = latestMatchesCurrentQuote && sorted.length > 1 ? sorted[sorted.length - 2] : latest;
  return selected?.volume ?? 0;
}

function quoteOutputToSummary(output: KisOutput, code: string, currentPrice: number, dailyCandles: CandlePoint[] = []): StockSummary {
  const rawDayChangeRate = pickNumber(output, ["prdy_ctrt"]);
  const dayDirection = directionFromKis(output.prdy_vrss_sign, rawDayChangeRate);
  const dayChangeAmount = signedChange(pickNumber(output, ["prdy_vrss"]), dayDirection);
  const dayChangeRate =
    dayDirection === "down" ? -Math.abs(rawDayChangeRate) : dayDirection === "up" ? Math.abs(rawDayChangeRate) : 0;
  const fallback = SUMMARY_FALLBACKS[code];
  const dividendYield = quoteDividendYield(output) || fallback?.dividendYield || 0;

  return {
    dayChangeAmount,
    dayChangeRate,
    dividendYield,
    marketCap: normalizeMarketCap(output, currentPrice),
    openingPrice: pickNumber(output, ["stck_oprc"]) || currentPrice,
    previousClose: currentPrice - dayChangeAmount,
    previousVolume: quotePreviousVolume(output) || previousVolumeFromDailyCandles(dailyCandles, currentPrice),
  };
}

function quoteOutputToSourceStock(output: KisOutput, seed: StockSeed): StockQuote {
  const currentPrice = pickNumber(output, ["stck_prpr"]);
  const rawChangeRate = pickNumber(output, ["prdy_ctrt"]);
  const direction = directionFromKis(output.prdy_vrss_sign, rawChangeRate);
  const changeRate = direction === "down" ? -Math.abs(rawChangeRate) : direction === "up" ? Math.abs(rawChangeRate) : 0;
  const change = signedChange(pickNumber(output, ["prdy_vrss"]), direction);
  const accumulatedVolume = pickNumber(output, ["acml_vol"]);
  const tradingValue = pickNumber(output, ["acml_tr_pbmn"]) || currentPrice * accumulatedVolume;

  return {
    rawValues: rawQuoteValues(output, direction),
    accumulatedVolume,
    aiSummary: "KIS 현재가 API 기준 시세입니다.",
    change,
    changeRate,
    code: seed.code,
    confidence: 0,
    currentPrice,
    direction,
    investorFlow: { foreign: 0, institution: 0, personal: 0 },
    isKospi200: Boolean(KOSPI200_POOL.find((stock) => stock.code === seed.code)),
    market: seed.market,
    miniSeries: miniSeriesFromChange(currentPrice, change),
    name: typeof output.hts_kor_isnm === "string" && output.hts_kor_isnm.trim() ? output.hts_kor_isnm : seed.name,
    predictedReturn: null,
    sentimentLabel: sentimentFromDirection(direction),
    tradingValue,
    tradingValueRank: 0,
  };
}

/**
 * Fills ranges we didn't fetch — and backfills any whose own call failed — by
 * slicing a broader series to the range's lookback window. 1M comes from 3M,
 * 3Y from 5Y; anything still empty falls back to the longest available series.
 * No extra KIS calls, so every tab stays populated even under rate limiting.
 */
function fillMissingRanges(ranges: StockChartData["ranges"]): void {
  const derive = (target: TimeRange, sourceRange: TimeRange, method: "subset" | "fallback"): void => {
    const source = ranges[sourceRange];
    if (ranges[target].candles.length > 0 || source.candles.length === 0 || (ranges[target].rawPrices?.length ?? 0) > 0) {
      return;
    }

    const cutoff = isoDateDaysAgo(RANGE_LOOKBACK_DAYS[target]);
    const candles = source.candles.filter((candle) => candle.time >= cutoff);
    if (candles.length > 0) {
      const rawPrices = source.rawPrices?.filter(point => point.date === null || point.date >= cutoff);
      ranges[target] = { candles, prices: candlesToPrices(candles), rawPrices,
        coverage: chartCoverage(target, source.coverage?.sourceRange ?? sourceRange, method, rawPrices ?? []) };
    }
  };

  derive("1M", "3M", "subset");
  derive("3Y", "5Y", "subset");

  // Last resort: backfill any still-empty range from the longest history we have
  // (earliest first candle), so a tab is never blank when some data exists.
  const longest = TIME_RANGES.filter((range) => range !== "1D" && ranges[range].candles.length > 0)
    .sort((left, right) => (ranges[left].candles[0]?.time ?? "").localeCompare(ranges[right].candles[0]?.time ?? ""))[0];

  if (longest) {
    for (const range of TIME_RANGES) {
      if (range === "1D") {
        continue; // 1D is intraday; never backfill it from daily candles.
      }
      derive(range, longest, "fallback");
    }
  }
}

/**
 * Builds the full chart bundle for one stock — quote + EVERY time range in a
 * single request. The client fetches this once when the detail modal opens, so
 * switching 1D/1M/3M/1Y/3Y/5Y is instant (no per-click refetch/loading). Ranges
 * are fetched best-effort: a single failing range leaves the others intact, and
 * the call only throws if every range came back empty.
 */
export async function buildKisStockChart(symbol: string, env = process.env): Promise<StockChartBundle> {
  const code = normalizeStockCode(symbol);
  const seed = findStockSeed(code);
  const config = getKisConfig(env);
  const cacheKey = `${config.env}:${code}:ALL`;
  const cached = stockChartCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < stockChartCacheTtlMs(env)) {
    return { ...cached.data, source: "cache", sourceStock: { ...cached.data.sourceStock, source: "cache" } };
  }

  const accessToken = await getAccessToken(config);

  const quoteOutput = await requestWithRetry(
    config,
    accessToken,
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
    },
  );

  const sourceStock = quoteOutputToSourceStock(quoteOutput, seed);
  const ranges = TIME_RANGES.reduce<StockChartData["ranges"]>((accumulator, range) => {
    accumulator[range] = { candles: [], prices: [] };
    return accumulator;
  }, {} as StockChartData["ranges"]);
  let firstError: unknown = null;
  let anySuccess = false;

  for (const range of CHART_FETCH_RANGES) {
    await sleep(config.requestDelayMs);

    try {
      const rangeData = await fetchRangeChart(config, accessToken, code, range, env);
      ranges[range] = rangeData;
      if (rangeData.candles.length > 0) {
        anySuccess = true;
      }
    } catch (error) {
      firstError = firstError ?? error;
      console.warn(`[kis] ${code} ${range} chart range failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (!anySuccess) {
    throw new Error(firstError instanceof Error ? firstError.message : "KIS chart request failed.");
  }

  // Derive 1M/3Y (and backfill any failed range) from the broader series — no
  // extra KIS calls, and 3Y can't be blank just because its weekly call failed.
  fillMissingRanges(ranges);

  let summaryDailyCandles = ranges["1M"].candles;
  if (quotePreviousVolume(quoteOutput) <= 0 && summaryDailyCandles.length === 0) {
    try {
      await sleep(config.requestDelayMs);
      summaryDailyCandles = await fetchDailyChartRange(config, accessToken, code, "1M");
    } catch (error) {
      console.warn(`[kis] ${code} summary daily volume failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  const data: StockChartBundle = {
    source: "live",
    asOf: new Date().toISOString(),
    chartData: {
      code,
      currentPrice: sourceStock.currentPrice,
      name: sourceStock.name,
      ranges,
      symbol: code,
    },
    sourceStock,
    summary: quoteOutputToSummary(quoteOutput, code, sourceStock.currentPrice, summaryDailyCandles),
  };

  stockChartCache.set(cacheKey, { builtAt: Date.now(), data });
  return data;
}

function buildSessionLabel(generatedAt: string, env: KisEnv): string {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  });
  const environmentLabel = env === "real" ? "실전" : "모의";

  return `${formatter.format(new Date(generatedAt))} KRX ${environmentLabel} 시세`;
}

function buildEvents(stocks: StockQuote[], indices: MarketIndexSnapshot[], env: KisEnv): MarketDashboardData["events"] {
  const topStock = stocks[0];
  const kospi = indices.find((index) => index.symbol === "KOSPI");
  const environmentLabel = env === "real" ? "실전" : "모의";

  return [
    {
      timeLabel: "KIS",
      title: `${environmentLabel} KIS API에서 국내 지수 ${indices.length}개와 종목 ${stocks.length}개를 갱신했습니다.`,
    },
    {
      timeLabel: "지수",
      title: kospi ? `${kospi.name} ${kospi.value.toLocaleString("ko-KR")} (${kospi.changeRate.toFixed(2)}%)` : "지수 응답을 확인했습니다.",
    },
    {
      timeLabel: "거래대금",
      title: topStock
        ? `${topStock.name} 거래대금 ${Math.round(topStock.tradingValue / 100000000).toLocaleString("ko-KR")}억원`
        : "종목 거래대금 응답이 없습니다.",
    },
  ];
}

type BuildOptions = {
  universeSize?: number;
  withInvestorFlow?: boolean;
};

/**
 * Fetches quotes for the requested universe directly from KIS, merging in the
 * Python pipeline's AI fields (sentiment/confidence/predicted return) keyed by
 * ticker. This is the slow path; callers control how many stocks via
 * `universeSize`.
 */
async function buildLiveDashboard(
  env: Record<string, string | undefined>,
  options: BuildOptions = {},
): Promise<MarketDashboardData> {
  const config = getKisConfig(env);
  const accessToken = await getAccessToken(config);

  const universeSize = options.universeSize ?? resolveUniverseSize(env, DEFAULT_INLINE_UNIVERSE_SIZE);
  const universe = selectUniverse(universeSize);

  const pipelineRows = await loadPipelineRows();
  const aiByTicker = pipelineRows ? indexPipelineByTicker(pipelineRows) : null;

  await sleep(config.requestDelayMs);

  const indices = await fetchIndexSnapshots(config, accessToken, env);
  // Per-stock failures must not abort the whole batch — a single bad quote
  // among 200 would otherwise discard every other result. Skip and continue.
  const stockResults = await mapSequential(universe, config.requestDelayMs, async (stock) => {
    try {
      return await fetchStockQuote(config, accessToken, stock, {
        aiRow: aiByTicker?.get(stock.code),
        withInvestorFlow: options.withInvestorFlow,
      });
    } catch {
      return null;
    }
  });

  const stocks = stockResults
    .filter((stock): stock is StockQuote => stock !== null && stock.currentPrice > 0)
    .sort((left, right) => right.tradingValue - left.tradingValue)
    .map((stock, index) => ({
      ...stock,
      tradingValueRank: index + 1,
    }));

  if (stocks.length === 0) {
    throw new Error("KIS returned no valid stock quotes.");
  }

  const generatedAt = new Date().toISOString();

  return {
    events: buildEvents(stocks, indices, config.env),
    source: "live",
    asOf: generatedAt,
    focusedStockCode: stocks[0].code,
    generatedAt,
    indices,
    sessionLabel: buildSessionLabel(generatedAt, config.env),
    stocks: stocks.map(stock => ({ ...stock, source: "live", asOf: generatedAt })),
    watchlist: stocks.slice(0, 8).map(stock => ({ ...stock, source: "live", asOf: generatedAt })),
  };
}

/** Guards against firing overlapping background warm jobs. */
let snapshotWarmInFlight: Promise<unknown> | null = null;

/**
 * After the first (small) inline build, fetch the full universe in the
 * background so the next load serves the complete KOSPI200 list with investor
 * flow — without making the first visitor wait for hundreds of calls. Skipped
 * when the configured universe already equals the inline size.
 */
function warmFullSnapshotInBackground(env: Record<string, string | undefined>): void {
  if (snapshotWarmInFlight) {
    return;
  }

  if (env.KIS_AUTO_WARM === "false") {
    return;
  }

  const fullSize = resolveSnapshotUniverseSize(env);
  const inlineSize = resolveUniverseSize(env, DEFAULT_INLINE_UNIVERSE_SIZE);
  if (fullSize <= inlineSize) {
    return;
  }

  // Let the inline fetch's request burst clear the KIS rate-limit window before
  // hammering it with the full-universe warm.
  snapshotWarmInFlight = sleep(3000)
    .then(() => refreshDashboardSnapshot(env))
    .then((data) => console.log(`[kis] background snapshot warmed: ${data.stocks.length} stocks`))
    .catch((error) =>
      console.warn(`[kis] background snapshot warm failed: ${error instanceof Error ? error.message : error}`),
    )
    .finally(() => {
      snapshotWarmInFlight = null;
    });
}

/**
 * Request-time entry point. Serves a pre-warmed snapshot when one is fresh so
 * the full KOSPI200 list loads instantly; otherwise builds a small inline slice
 * (with investor flow) live, caches it, and kicks off a background full-universe
 * warm. `refreshDashboardSnapshot` can also be driven directly by a scheduler.
 */
export async function buildKisDashboard(env = process.env): Promise<MarketDashboardData> {
  const snapshot = await readDashboardSnapshot();
  if (snapshot) {
    return cachedDashboard(snapshot);
  }

  // No FRESH snapshot. If a stale one exists, keep serving its full breadth and
  // refresh in the background — never downgrade the served list to the tiny
  // inline slice just because the snapshot aged past its TTL.
  const stale = await readLastSnapshot();
  if (stale) {
    warmFullSnapshotInBackground(env);
    return cachedDashboard(stale);
  }

  // True cold start (no snapshot at all): build a small inline slice for a fast
  // first paint, cache it, and warm the full universe in the background.
  const data = await buildLiveDashboard(env, { withInvestorFlow: true });
  await writeDashboardSnapshot(data);
  warmFullSnapshotInBackground(env);
  return data;
}

/** Explicit user refresh: bypass stale snapshots and rebuild the fast inline dashboard now. */
export async function buildFreshKisDashboard(env = process.env): Promise<MarketDashboardData> {
  const data = await buildLiveDashboard(env, { withInvestorFlow: true });
  await writeDashboardSnapshot(data);
  warmFullSnapshotInBackground(env);
  return data;
}

/**
 * Batch job: fetch the full configured universe (with investor flow) and write
 * the snapshot the request handler serves. Defaults to the entire KOSPI200 pool
 * unless `KIS_UNIVERSE_SIZE` narrows it.
 */
export async function refreshDashboardSnapshot(env = process.env): Promise<MarketDashboardData> {
  const data = await buildLiveDashboard(env, {
    universeSize: resolveSnapshotUniverseSize(env),
    withInvestorFlow: env.KIS_WITH_INVESTOR_FLOW !== "false",
  });
  await writeDashboardSnapshot(data);
  return data;
}
