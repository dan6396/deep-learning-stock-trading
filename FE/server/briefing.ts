import type { PipelineOutputRow } from "../src/types/trading";
import { safeArticleUrl } from "../src/shared/lib/articleUrl";
import { getRankPayload, validateModelRows } from "./pipelineResults";
import { readPipelineRunMarker, type PipelineRunMarker } from "./pipelineFreshness";
import { getMarketMacro, MACRO_UNIVERSE, usMarketDate, type MarketMacro } from "./marketMacro";
import { unavailableNight } from "./kisBriefing";
import { nextKrxSession } from "./krxCalendar";
import { formatSupplyWon } from "./briefingValidation";
import { showBriefingSupply } from "./supplyVisibility";
import { modelEvidence, type ModelEvidence } from "../src/types/modelEvidence";
export { formatSupplyWon } from "./briefingValidation";
import { createNarrativeStore, briefingInputHash, templateNarrative, type BriefingNarrative } from "./briefingNarrative";
import { getBriefingComposition, buildBriefingComposition, type BriefingComposition } from "./briefingComposition";

declare const process: { env: Record<string, string | undefined> };
export type BriefingFact = { id: string; kind: "model" | "supply" | "news" | "macro" | "data"; text: string };
export type BriefingStock = {
  rank: number; code: string; name: string; rankScore: number; poolSize: number; topPercent: number;
  modelEvidence?: ModelEvidence | null;
  evidence: (BriefingFact & { kind: "model" | "supply" | "news" })[]; cautions: BriefingFact[];
  news: { status: "collected" | "collection_failed" | "not_collected";
    articles: { id: string; title: string; url: string; source: string; pubDate: string | null }[] };
};
export type BriefingInput = {
  model: { modelId: string; scoreKind: "rank_zscore"; baseDate: string; predictionTarget: string; poolSize: number; runStartedAt: string | null } | null;
  macro: MarketMacro; stocks: BriefingStock[];
};
export type BriefingPayload = BriefingInput & {
  version: 1; status: "ready" | "no_run"; narrative: BriefingNarrative; disclaimer: string;
  composition: BriefingComposition;
  data_meta: { source: "live" | "cache" | "sample"; asOf: string | null };
};
const MODEL_ID = "plain_20_120_rank_mean_v1";
const TARGET = "next_session_open_to_close";
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value
  : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const format = (value: number) => String(Number(value.toFixed(2)));

function stockFacts(row: PipelineOutputRow, macro: MarketMacro, today: string, showSupply: boolean): BriefingStock {
  const input = row.input_row, code = String(input.ticker), rank = numeric(input.pred_rank)!, poolSize = numeric(input.pred_pool_size)!;
  const topPercent = rank / poolSize * 100;
  const evidence: BriefingStock["evidence"] = [], cautions: BriefingFact[] = [];
  const addEvidence = (kind: "model" | "supply" | "news", text: string) => evidence.push({ id: `E:${code}:${evidence.length + 1}`, kind, text });
  const caution = (kind: BriefingFact["kind"], text: string) => cautions.push({ id: `C:${code}:${cautions.length + 1}`, kind, text });
  addEvidence("model", `전체 ${poolSize}개 중 ${rank}위(상위 ${format(topPercent)}%)입니다.`);
  caution("model", "순위 점수는 수익률·확률이 아닙니다.");
  const supplyStatus = input.supply_status;
  if (showSupply && (supplyStatus === "ok" || supplyStatus === "insufficient_data")) {
    const window = numeric(input.supply_window), days = numeric(input.supply_data_days);
    const foreign = numeric(input.foreign_net_buy_sum), institution = numeric(input.inst_net_buy_sum);
    if (days !== null && foreign !== null && institution !== null) {
      const measured = (name: string, amount: number, rawPositive: unknown) => {
        const count = numeric(rawPositive);
        const positive = count !== null && Number.isInteger(count) && count >= 0 && count <= days ? `(순매수 양수 ${count}일)` : "";
        return `${name} ${formatSupplyWon(Math.abs(amount))} ${amount < 0 ? "순매도" : "순매수"}${positive}`;
      };
      // One measured sentence; supply never changes the model rank.
      addEvidence("supply", `최근 ${days}거래일 ${measured("외국인", foreign, input.foreign_positive_days)}, ${measured("기관", institution, input.inst_positive_days)}입니다.`);
    }
    if (supplyStatus === "insufficient_data" && days !== null && window !== null) caution("supply", `수급 확인 기간 ${window}거래일 중 ${days}거래일만 확보했습니다.`);
  } else if (showSupply) caution("supply", "확인 가능한 수급 자료가 없습니다.");
  const status = row.data_meta?.newsStatus === "collected" ? "collected" : row.data_meta?.newsStatus === "collection_failed" ? "collection_failed" : "not_collected";
  const articles = status === "collected" ? (row.news ?? []).filter(article => article && typeof article.title === "string" && safeArticleUrl(article.url))
    .slice(0, 3).map((article, index) => ({ id: `N:${code}:${index + 1}`, title: article.title, url: safeArticleUrl(article.url)!,
      source: typeof article.source === "string" ? article.source : "", pubDate: typeof article.pub_date === "string" && Number.isFinite(Date.parse(article.pub_date)) ? new Date(article.pub_date).toISOString() : null })) : [];
  if (articles.length) addEvidence("news", `관련 기사 ${articles.length}건을 확인했습니다. 출처: ${[...new Set(articles.map(article => article.source || "출처 미상"))].join(", ")}입니다.`);
  else caution("news", status === "collection_failed" ? "관련 기사 수집에 실패했습니다." : status === "not_collected" ? "관련 기사를 수집하지 않았습니다." : "확인된 관련 기사가 없습니다.");
  if (input.prediction_base_date !== today) caution("data", `모델 기준일은 ${String(input.prediction_base_date)}이며 오늘 날짜와 다릅니다.`);
  // Keep stock-specific citation IDs stable when macro collection recovers.
  if (macro.indicators.some(indicator => indicator.status !== "ok")) caution("macro", "일부 시장 지표를 확보하지 못했습니다.");
  return { rank, code, name: row.result.company_name, rankScore: numeric(input.rank_score)!, poolSize, topPercent, modelEvidence: modelEvidence(input), evidence, cautions, news: { status, articles } };
}

/** Reject ambiguous outputs; only model pred_rank determines order. */
export function buildBriefingInput(rows: PipelineOutputRow[], marker: PipelineRunMarker | null, macro: MarketMacro, now = Date.now(), env = process.env): BriefingInput {
  macro = { ...macro, context: { usSessionDate: null, targetSessionNote: "미국 장 관측일과 모델 대상 한국 거래일을 확인할 수 없습니다." } };
  const us = macro.indicators.filter(row => row.id === "NASDAQ" || row.id === "SP500");
  const dates = us.flatMap(row => row.status === "ok" && row.asOf ? [usMarketDate(row.asOf)] : []);
  const usDate = dates.length === 2 && dates[0] === dates[1] ? dates[0] : null;
  macro.context!.usSessionDate = usDate;
  const empty: BriefingInput = { model: null, macro, stocks: [] };
  if (!marker || marker.status !== "completed" || marker.mode !== "model_only" || !Number.isFinite(marker.startedAt) || marker.startedAt <= 0
    || (marker.finishedAt !== undefined && (!Number.isFinite(marker.finishedAt) || marker.finishedAt < marker.startedAt))) return empty;
  if (!Array.isArray(rows) || rows.some(row => !row || !row.input_row || !row.result || typeof row.result.company_name !== "string")) return empty;
  try { validateModelRows(rows.map(row => Object.fromEntries(Object.entries(row.input_row).map(([key, value]) => [key, value == null ? "" : String(value)])))); }
  catch { return empty; }
  const ok = rows.filter(row => row.input_row.prediction_status === "ok");
  if (!ok.length) return empty;
  const first = ok[0].input_row, pool = numeric(first.pred_pool_size), baseDate = first.prediction_base_date;
  if (pool === null || !Number.isInteger(pool) || pool !== ok.length || !validDate(baseDate)) return empty;
  const sorted = [...ok].sort((a, b) => Number(a.input_row.pred_rank) - Number(b.input_row.pred_rank));
  if (new Set(sorted.map(row => row.input_row.ticker)).size !== sorted.length || sorted.some((row, index) => {
    const input = row.input_row, score = numeric(input.rank_score);
    return row.data_meta?.source === "sample" || !/^\d{6}$/.test(String(input.ticker)) || input.ticker === "000000"
      || input.model_id !== MODEL_ID || input.score_kind !== "rank_zscore" || input.prediction_target !== TARGET
      || input.prediction_base_date !== baseDate || numeric(input.pred_pool_size) !== pool || numeric(input.pred_rank) !== index + 1 || score === null
      || (index > 0 && score > Number(sorted[index - 1].input_row.rank_score));
  })) return empty;
  const today = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const targetSession = nextKrxSession(baseDate);
  const target = targetSession ? `${targetSession} 한국 정규장` : `기준일 ${baseDate} 다음 한국 거래일`;
  macro.context!.targetSessionNote = `${usDate ? `${usDate} 미국 ${us.every(row => row.session === "closed") ? "정규장 마감" : us.some(row => row.session === "open") ? "장중 관측" : "장 상태 미확인 관측"} 자료이며, ` : "미국 정규장 관측일을 확인할 수 없으며, "}모델 예측 대상은 ${target}의 시가→종가입니다.`;
  return { model: { modelId: MODEL_ID, scoreKind: "rank_zscore", baseDate, predictionTarget: TARGET, poolSize: pool,
    runStartedAt: new Date(marker.startedAt).toISOString() }, macro, stocks: sorted.slice(0, 5).map(row => stockFacts(row, macro, today, showBriefingSupply(env))) };
}

type BriefingDependencies = {
  rank?: typeof getRankPayload; marker?: typeof readPipelineRunMarker; macro?: typeof getMarketMacro;
  narratives?: ReturnType<typeof createNarrativeStore>; now?: () => number;
  composition?: typeof getBriefingComposition;
};
export function createBriefingService({ rank = getRankPayload, marker = readPipelineRunMarker, macro = getMarketMacro,
  narratives = createNarrativeStore(), now = Date.now, composition = getBriefingComposition }: BriefingDependencies = {}) {
  const markets = new Map<string, MarketMacro>(), compositions = new Map<string, { hash: string; value: BriefingComposition }>();
  async function bounded<T>(promise: Promise<T>, deadline: number, fallback: () => T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise.catch(fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback()), Math.max(0, deadline - Date.now())); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  return async (generate = false, env = process.env): Promise<BriefingPayload> => {
    const deadline = generate ? Date.now() + 45_000 : Infinity, preparationDeadline = generate ? Math.min(deadline, Date.now() + 9_000) : Infinity;
    const kisDeadline = Date.now() + 1500;
    const kisOptions = () => ({ backgroundKis: !generate, kisWaitMs: Math.max(0, kisDeadline - Date.now()) });
    const environmentKey = env.PIPELINE_OUTPUT_DIR ?? "default";
    const emptyMarket = (): MarketMacro => markets.get(environmentKey) ?? { asOf: null, indicators: [
      ...MACRO_UNIVERSE.map(row => ({ id: row.id, name: row.name, unit: row.unit, value: null, change: null, changePct: null, asOf: null, source: "yahoo" as const, status: "unavailable" as const })), unavailableNight()], reference: null };
    const within = <T>(promise: Promise<T>, budget: number, fallback: () => T) => generate ? bounded(promise, budget, fallback) : promise;
    const before = await within(marker(env), preparationDeadline, () => null);
    const marketRequest = macro(env, kisOptions()).then(value => { markets.set(environmentKey, value); return value; });
    const [rows, market] = await Promise.all([within(rank(env), preparationDeadline, () => []), within(marketRequest, preparationDeadline, emptyMarket)]);
    const after = await within(marker(env), preparationDeadline, () => null);
    const unchanged = before && after && before.startedAt === after.startedAt && before.finishedAt === after.finishedAt && before.status === after.status && before.mode === after.mode;
    const input = buildBriefingInput(rows, unchanged ? after : null, market, now(), env);
    const compositionKey = briefingInputHash(input);
    const compositionRequest = composition(input, env, kisOptions()).then(value => { compositions.set(environmentKey, { hash: compositionKey, value }); return value; });
    const [narrative, candidateComposition] = await Promise.all([
      within(narratives.resolve(input, generate && input.model !== null, env, generate ? deadline - 50 : undefined), deadline,
        () => templateNarrative(input, "generation_timeout", now())),
      within(compositionRequest, deadline, () => compositions.get(environmentKey)?.hash === compositionKey ? compositions.get(environmentKey)!.value : buildBriefingComposition(input)),
    ]);
    return { version: 1, status: input.model ? "ready" : "no_run", ...input, narrative, composition: candidateComposition,
      disclaimer: "모델 순위와 시장·기사 요약은 정보 제공용입니다. 순위 점수는 수익률이나 확률이 아니며 투자 판단과 책임은 이용자에게 있습니다.",
      data_meta: { source: "cache", asOf: input.model?.runStartedAt ?? market.asOf } };
  };
}
let service: ReturnType<typeof createBriefingService> | undefined;
function defaultService() { return service ??= createBriefingService(); }
export const getBriefing = (env = process.env) => defaultService()(false, env);
export const generateBriefingNarrative = (env = process.env) => defaultService()(true, env);
