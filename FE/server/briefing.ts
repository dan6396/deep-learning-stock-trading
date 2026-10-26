import type { PipelineOutputRow } from "../src/types/trading";
import { safeArticleUrl } from "../src/shared/lib/articleUrl";
import { readCompletedRank, readPendingRank, validateModelRows } from "./pipelineResults";
import { readPipelineRunMarker, type PipelineRunMarker } from "./pipelineFreshness";
import { getMarketMacro, MACRO_UNIVERSE, usMarketDate, type MarketMacro } from "./marketMacro";
import { unavailableNight } from "./kisBriefing";
import { nextKrxSession } from "./krxCalendar";
import { formatSupplyWon } from "./briefingValidation";
import { showBriefingSupply } from "./supplyVisibility";
import { modelEvidence, type ModelEvidence } from "../src/types/modelEvidence";
export { formatSupplyWon } from "./briefingValidation";
import { createNarrativeStore, briefingInputHash, templateNarrative, isTargetSessionCaution, targetSessionCautionText, type BriefingNarrative } from "./briefingNarrative";
import { getBriefingComposition, buildBriefingComposition, type BriefingComposition } from "./briefingComposition";
import { completedResultsKey, completedResults, createCompletedResultsStore, previousRunReason, sameCompletedRun, type PreviousRun } from "./completedResults";

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
export type BriefingPayload = Omit<BriefingInput, "model"> & {
  model: (NonNullable<BriefingInput["model"]> & { finishedAt: string | null; elapsedMs: number | null }) | null;
  previousRun?: PreviousRun;
  kind: "official" | "adhoc" | "unknown";
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
  if (input.prediction_base_date !== today) caution("data", targetSessionCautionText(String(input.prediction_base_date)));
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
  rank?: typeof readCompletedRank; marker?: typeof readPipelineRunMarker; macro?: typeof getMarketMacro;
  narratives?: ReturnType<typeof createNarrativeStore>; now?: () => number;
  composition?: typeof getBriefingComposition;
  snapshots?: ReturnType<typeof createCompletedResultsStore>;
};
type CaptureControl = { deadline: number; cancelled: boolean; marker: PipelineRunMarker | null; staged?: PipelineRunMarker; rows?: PipelineOutputRow[] };
export const COMPLETED_PREPARATION_TIMEOUT_MS = 1500;
export const AUTO_NARRATIVE_TIMEOUT_MS = 30_000;

function unavailableMarket(): MarketMacro {
  return { asOf: null, indicators: [...MACRO_UNIVERSE.map(row => ({ id: row.id, name: row.name, unit: row.unit,
    value: null, change: null, changePct: null, asOf: null, source: "yahoo" as const, status: "unavailable" as const })), unavailableNight()], reference: null };
}
function emptyBriefing(env: Record<string, string | undefined>): BriefingPayload {
  const input = buildBriefingInput([], null, unavailableMarket(), Date.now(), env);
  return { version: 1, kind: "unknown", status: "no_run", ...input, model: null, narrative: templateNarrative(input, "no_run"),
    composition: buildBriefingComposition(input), disclaimer: "모델 순위와 시장·기사 요약은 정보 제공용입니다. 순위 점수는 수익률이나 확률이 아니며 투자 판단과 책임은 이용자에게 있습니다.",
    data_meta: { source: "cache", asOf: null } };
}
export function createBriefingService({ rank = readCompletedRank, marker = readPipelineRunMarker, macro = getMarketMacro,
  narratives = createNarrativeStore(), now = Date.now, composition = getBriefingComposition, snapshots = createCompletedResultsStore() }: BriefingDependencies = {}) {
  const markets = new Map<string, MarketMacro>(), compositions = new Map<string, { hash: string; value: BriefingComposition }>();
  async function bounded<T>(promise: Promise<T>, deadline: number, fallback: () => T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise.catch(fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback()), Math.max(0, deadline - Date.now())); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async function resolve(generate = false, env = process.env, capture?: CaptureControl): Promise<BriefingPayload> {
    const deadline = capture?.deadline ?? (generate ? Date.now() + 45_000 : Infinity);
    const preparationDeadline = generate ? Math.min(deadline, Date.now() + 9_000) : deadline;
    const kisDeadline = Date.now() + 1500;
    const kisOptions = () => ({ backgroundKis: !generate || Boolean(capture?.staged), kisWaitMs: Math.max(0, kisDeadline - Date.now()) });
    const environmentKey = completedResultsKey(env);
    const previous = (run: PipelineRunMarker | null): BriefingPayload | null => {
      // Capture runs before Python and must inspect the completed disk run, independent of the next run's memory state.
      if (capture) return null;
      const saved = snapshots.get(env), reason = previousRunReason(run, env);
      return saved && reason ? { ...saved.briefing, previousRun: reason } : null;
    };
    const emptyMarket = (): MarketMacro => markets.get(environmentKey) ?? unavailableMarket();
    const within = <T>(promise: Promise<T>, budget: number, fallback: () => T) => generate || capture ? bounded(Promise.resolve(promise), budget, fallback) : Promise.resolve(promise).catch(fallback);
    const before = capture?.staged ?? await within(marker(env), preparationDeadline, () => null);
    if (capture) {
      capture.marker = before;
      const saved = snapshots.get(env);
      if (!capture.staged && saved && sameCompletedRun(saved.marker, before)) return saved.briefing;
      if (before?.status !== "completed" || before.mode !== "model_only") return saved?.briefing ?? emptyBriefing(env);
    }
    const retained = previous(before);
    if (retained) return retained;
    const marketRequest = (capture && !capture.staged ? Promise.resolve(emptyMarket()) : Promise.resolve().then(() => macro(env, kisOptions()))).then(value => { markets.set(environmentKey, value); return value; });
    const [rows, market] = await Promise.all([within(Promise.resolve().then(() => capture?.staged ? readPendingRank(capture.staged, env) : rank(env)), preparationDeadline, () => []), within(marketRequest, preparationDeadline, emptyMarket)]);
    const after = capture?.staged ?? await within(marker(env), preparationDeadline, () => null);
    const concurrent = previous(after);
    if (concurrent) return concurrent;
    const unchanged = before && after && before.startedAt === after.startedAt && before.finishedAt === after.finishedAt && before.status === after.status && before.mode === after.mode
      && before.runId === after.runId && before.kind === after.kind;
    const input = buildBriefingInput(rows, unchanged ? after : null, market, now(), env);
    const compositionKey = briefingInputHash(input);
    const compositionRequest = (capture && !capture.staged ? Promise.resolve(buildBriefingComposition(input)) : Promise.resolve().then(() => composition(input, env, kisOptions()))).then(value => { compositions.set(environmentKey, { hash: compositionKey, value }); return value; });
    const [narrative, candidateComposition] = await Promise.all([
      within(Promise.resolve().then(() => narratives.resolve(input, generate && input.model !== null, env, generate ? deadline - 50 : undefined, Boolean(capture?.staged))), deadline,
        () => templateNarrative(input, "generation_timeout", now())),
      within(compositionRequest, deadline, () => compositions.get(environmentKey)?.hash === compositionKey ? compositions.get(environmentKey)!.value : buildBriefingComposition(input)),
    ]);
    const kind = input.model && (after?.kind === "official" || after?.kind === "adhoc") ? after.kind : "unknown";
    // Change presentation after identity/cache resolution; hashed input facts stay untouched.
    const hiddenDateCaution = (fact: BriefingFact) => isTargetSessionCaution(fact, input.model?.baseDate ?? "");
    const hiddenCitations = new Set(input.stocks.flatMap(stock => stock.cautions.filter(hiddenDateCaution).map(fact => fact.id)));
    const visibleCitations = (ids: string[]) => ids.filter(id => !hiddenCitations.has(id));
    const stocks = input.stocks.map(stock => ({ ...stock, cautions: stock.cautions.filter(fact => !hiddenDateCaution(fact)) }));
    const visibleNarrative = { ...narrative, citations: visibleCitations(narrative.citations),
      stocks: narrative.stocks.map(stock => ({ ...stock, citations: visibleCitations(stock.citations) })) };
    const payload: BriefingPayload = { version: 1, status: input.model ? "ready" : "no_run", kind, ...input, stocks, narrative: visibleNarrative, composition: candidateComposition,
      model: input.model ? { ...input.model, finishedAt: after?.finishedAt !== undefined ? new Date(after.finishedAt).toISOString() : null,
        elapsedMs: after?.finishedAt !== undefined ? after.finishedAt - after.startedAt : null } : null,
      disclaimer: "모델 순위와 시장·기사 요약은 정보 제공용입니다. 순위 점수는 수익률이나 확률이 아니며 투자 판단과 책임은 이용자에게 있습니다.",
      data_meta: { source: "cache", asOf: input.model?.runStartedAt ?? market.asOf } };
    // Composition and narrative can finish after a new run begins. Do not publish that race.
    if (capture?.staged) {
      capture.rows = rows;
      return payload;
    }
    const finalMarker = await within(marker(env), deadline, () => null);
    const finalPrevious = previous(finalMarker);
    if (finalPrevious) return finalPrevious;
    if (payload.status === "ready" && sameCompletedRun(finalMarker, after)
      && (capture ? !capture.cancelled && Date.now() < capture.deadline : !previousRunReason(finalMarker, env))
      && snapshots.publish({ marker: finalMarker!, rank: rows, briefing: payload }, env)) {
      return payload;
    }
    const saved = snapshots.get(env);
    if (saved && finalMarker?.status === "completed") return saved.briefing;
    if (payload.status === "ready") {
      const empty = buildBriefingInput([], null, market, now(), env);
      return { ...payload, ...empty, model: null, status: "no_run", kind: "unknown", narrative: templateNarrative(empty, "no_run", now()),
        composition: buildBriefingComposition(empty), data_meta: { source: "cache", asOf: market.asOf } };
    }
    return payload;
  }
  const inFlight = new Map<string, Promise<BriefingPayload>>();
  const service = (generate = false, env = process.env, capture?: CaptureControl): Promise<BriefingPayload> => {
    const key = completedResultsKey(env);
    const active = previousRunReason(null, env), saved = snapshots.get(env);
    if (!capture && saved && active?.reason === "running") return Promise.resolve({ ...saved.briefing, previousRun: active });
    // Both endpoints share assembly before publishing a new pair.
    if (!generate && !capture) {
      const pending = inFlight.get(key);
      if (pending) return pending;
      const request = resolve(false, env).finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
      inFlight.set(key, request);
      return request;
    }
    return resolve(generate, env, capture);
  };
  return service;
}
let service: ReturnType<typeof createBriefingService> | undefined;
type Preparation = { promise: Promise<void>; control: CaptureControl; settled: boolean };
const preparations = new Map<string, Preparation>();
function defaultService() { return service ??= createBriefingService({ snapshots: completedResults }); }
export const getBriefing = (env = process.env) => {
  const pending = waitForCompletedPreparation(env);
  return pending ? pending.then(result => ({ ...result.briefing, ...(result.previousRun ? { previousRun: result.previousRun } : {}) })) : defaultService()(false, env);
};
export const generateBriefingNarrative = (env = process.env) => defaultService()(true, env);

/** Assemble privately while disk and public state remain running; the runner owns publication. */
export async function prepareRunBriefing(marker: PipelineRunMarker, env = process.env) {
  const control: CaptureControl = { deadline: Date.now() + AUTO_NARRATIVE_TIMEOUT_MS, cancelled: false, marker: null, staged: marker };
  const briefing = await defaultService()(true, env, control);
  if (briefing.narrative.fallbackReason) console.warn("[briefing] Automatic narrative fallback", { reason: briefing.narrative.fallbackReason });
  return { rank: control.rows ?? [], briefing };
}

/** Refresh completed disk inputs without provider calls. Expired work can never publish later. */
export function prepareCompletedResults(env = process.env): Promise<void> {
  const key = completedResultsKey(env), existing = preparations.get(key);
  if (existing && !existing.settled) return existing.promise;
  const control: CaptureControl = { deadline: Date.now() + COMPLETED_PREPARATION_TIMEOUT_MS, cancelled: false, marker: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = defaultService()(false, env, control).then(() => {}, () => {});
  const request = Promise.race([work, new Promise<void>(resolve => {
    timer = setTimeout(() => { control.cancelled = true; resolve(); }, COMPLETED_PREPARATION_TIMEOUT_MS);
  })]).finally(() => {
    const published = !control.cancelled && Date.now() < control.deadline
      && sameCompletedRun(completedResults.get(env)?.marker ?? null, control.marker);
    control.cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    const current = preparations.get(key);
    if (current?.promise === request) {
      current.settled = true;
      // Failed captures keep a retry barrier so subsequent GETs cannot retry through an unbounded read.
      if (published) preparations.delete(key);
    }
  });
  preparations.set(key, { promise: request, control, settled: false });
  return request;
}

/** Both endpoints wait for the same bounded barrier even when an older snapshot exists. */
export function waitForCompletedPreparation(env = process.env) {
  const key = completedResultsKey(env);
  let pending = preparations.get(key);
  if (!pending) return null;
  if (pending.settled) {
    void prepareCompletedResults(env);
    pending = preparations.get(key)!;
  }
  const observed = pending;
  return pending.promise.then(() => {
    const saved = completedResults.get(env);
    return { rows: saved?.rank ?? [], briefing: saved?.briefing ?? emptyBriefing(env),
      previousRun: saved ? previousRunReason(observed.control.marker, env) : undefined };
  });
}
