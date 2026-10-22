import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PipelineInputRow, PipelineOutputRow } from "../src/types/trading";
import { isFreshForRun, readPipelineRunMarker, type PipelineRunMarker } from "./pipelineFreshness";
import type { PipelineAvailability } from "../src/types/backendStatus";
import { attachRelatedNews, RELATED_NEWS_FILE, type RelatedNewsSnapshot } from "./relatedNews";

declare const process: { cwd: () => string; env: Record<string, string | undefined> };
const FULL_RANK_CSV_RESULT_FILES = ["step2_all_transformer_rank.csv"];
const MODEL_ID = "plain_20_120_rank_mean_v1";
type LoadedRows = { mtimeMs: number; rows: PipelineOutputRow[] };

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

function stringValue(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function ensembleCsvToPipelineRow(record: Record<string, string>): PipelineOutputRow | null {
  if (record.score_kind !== "rank_zscore" || record.model_id !== MODEL_ID) return null;
  const ticker = stringValue(record.ticker ?? record["종목코드"]).padStart(6, "0");
  if (!ticker || ticker === "000000") {
    return null;
  }

  const companyName = stringValue(record.company_name ?? record["종목명"], ticker);
  const rankScore = toFiniteOrNull(record.rank_score);
  const predRank = toFiniteOrNull(record.pred_rank);
  const supplyPass = boolFromCsv(record.supply_pass);
  const supplyStatus = stringValue(record.supply_status);
  const supplyChecked = supplyStatus !== "" && supplyStatus !== "not_checked";
  const label = "NEUTRAL" as const;
  const modelDescription = rankScore === null ? "순위 점수 없음" : `20일·120일 앙상블 순위 점수 ${rankScore.toFixed(6)} (수익률·상승확률 아님)`;
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
    p_up: undefined,
    pred_rank: predRank ?? undefined,
    prediction_status: status,
    ticker,
    // CSV columns spread above arrive as strings; the detail page calls
    // `formatRate(...).toFixed` on these, so coerce to number | undefined.

    ensemble_pred_return: undefined,
    rank_score: rankScore ?? undefined,
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
      label_ko: "중립",
      negative_factors: [
        supplyChecked && !supplyPass ? "최근 수급 조건을 충족하지 못했습니다." : undefined,
      ].filter((value): value is string => Boolean(value)),
      positive_factors: [
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

async function loadCsvRows(
  fileNames: string[] = FULL_RANK_CSV_RESULT_FILES,
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

function withFileMeta(row: PipelineOutputRow, mtimeMs: number): PipelineOutputRow {
  return { ...row, data_meta: { ...row.data_meta, source: row.data_meta?.source === "sample" ? "sample" : "cache", asOf: new Date(mtimeMs).toISOString() } };
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
  const rankModel = input.score_kind === "rank_zscore";
  if (rankModel && (record.score_kind !== input.score_kind || record.model_id !== input.model_id)) return row;
  const rank = toFiniteOrNull(input.pred_rank), prediction = toFiniteOrNull(rankModel ? input.rank_score : input.ensemble_pred_return);
  const baseDate = isoDate(record.prediction_base_date);
  if (record.ticker !== ticker || record.prediction_status !== "ok" || record.prediction_target !== MODEL_TARGET || input.prediction_target !== MODEL_TARGET ||
    baseDate === null || baseDate !== input.prediction_base_date || rank === null || positiveInteger(record.pred_rank) !== rank ||
    prediction === null || toFiniteOrNull(rankModel ? record.rank_score : record.ensemble_pred_return) !== prediction) return row;
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

/** Current model-only result: related RSS articles never alter rank scores. */
export async function loadPipelineRows(): Promise<PipelineOutputRow[] | null> {
  const rows = await getRankPayload();
  return rows.length ? rows : null;
}

/** No separately learned news-final candidate list exists for this model. */
export async function getCandidatesPayload(): Promise<PipelineOutputRow[]> { return []; }

export async function getStockAnalysisPayload(ticker: string): Promise<PipelineOutputRow | null> {
  const normalized = String(ticker ?? "").replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (!/^\d{6}$/.test(normalized) || normalized === "000000") throw new Error("A valid 6-digit ticker is required.");
  return (await getRankPayload()).find(row => tickerFromRow(row) === normalized) ?? null;
}

export async function getRankPayload(): Promise<PipelineOutputRow[]> {
  const marker = await readPipelineRunMarker();
  if ((!marker && process.env.PIPELINE_ALLOW_UNMARKED_RESULTS !== "true") || (marker && (marker.status !== "completed" || marker.mode !== "model_only"))) return [];
  const rank = await loadCsvRows(FULL_RANK_CSV_RESULT_FILES, false);
  if (!rank || !markerAllowsLoadedFile(marker, rank.mtimeMs)) return [];
  let related: RelatedNewsSnapshot | null = null;
  for (const path of candidatePaths([RELATED_NEWS_FILE], false)) {
    try {
      const snapshot = JSON.parse(await readFile(path, "utf8")) as RelatedNewsSnapshot;
      if (snapshot?.version === 1 && snapshot.startedAt === marker?.startedAt) { related = snapshot; break; }
    } catch { /* no current article cache */ }
  }
  // Model rank remains exactly as written by the verified STEP2 run.
  const supply = marker?.mode === "model_only" ? await loadModelOnlySupply(marker) : new Map<string, Record<string, string>>();
  const after = await readPipelineRunMarker();
  if (marker && (!after || after.status !== marker.status || after.startedAt !== marker.startedAt || after.finishedAt !== marker.finishedAt || after.mode !== marker.mode)) return [];
  const rows = rank.rows.map(row => applyModelSupply(marker?.mode === "model_only" ? { ...row,
    data_meta: { ...row.data_meta, rawFinalPrediction: null, rawFinalRank: null },
    input_row: { ...row.input_row, final_pred_return: null, news_adjustment: null, news_applied: false } } : row, supply.get(tickerFromRow(row))));
  return attachRelatedNews(rows, related, marker?.startedAt);
}

export async function inspectPipelineResultAvailability(): Promise<{ candidates: PipelineAvailability; rank: PipelineAvailability }> {
  const unavailable = (state: PipelineAvailability["state"]): PipelineAvailability => ({ state, count: null, source: "unknown", asOf: null });
  const marker = await readPipelineRunMarker();
  if (!marker || marker.status !== "completed" || marker.mode !== "model_only") return { candidates: unavailable("blocked"), rank: unavailable("blocked") };
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
  const candidates = async (): Promise<PipelineAvailability> => unavailable("not_produced");
  const rank = async (): Promise<PipelineAvailability> => {
    try {
      const loaded = await loadCsvRows(FULL_RANK_CSV_RESULT_FILES, false);
      if (loaded && isFreshForRun(loaded.mtimeMs, marker)) return ready(loaded.rows, new Date(loaded.mtimeMs).toISOString());
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

type ValidatedModelRow = { ticker: string; prediction: number; rank: number; kind: string; model: string };
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
    const kind = row.score_kind;
    if (kind !== "rank_zscore" || row.model_id !== MODEL_ID) return fail();
    if (kind === "rank_zscore" && (!row.model_id || toFiniteOrNull(row.ensemble_pred_return) !== null)) return fail();
    const prediction = toFiniteOrNull(kind === "rank_zscore" ? row.rank_score : row.ensemble_pred_return), rank = positiveInteger(row.pred_rank);
    if (prediction === null || rank === null || row.prediction_target !== MODEL_TARGET) return fail();
    return { ticker: row.ticker, prediction, rank, kind, model: row.model_id || "legacy" };
  });
  if (new Set(rows.map(row => `${row.kind}:${row.model}`)).size !== 1) fail();
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
  if (picked.some((row, index) => row.rank !== index + 1 || byTicker.get(row.ticker)?.rank !== row.rank || byTicker.get(row.ticker)?.prediction !== row.prediction || byTicker.get(row.ticker)?.kind !== row.kind || byTicker.get(row.ticker)?.model !== row.model)) inconsistent();
  return { rows: rankRecords.length, modelSelectionRows: selectionRecords.length };
}

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
