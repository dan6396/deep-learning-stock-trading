import { mkdir, readFile, readdir, rename, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipelineOutputDir } from "./pipelineFreshness";
import { parseCsv } from "./pipelineResults";
import type { AnalysisRecord, FrozenPrediction, RunKind, RunMode } from "../src/types/performance";

declare const process: { env: Record<string, string | undefined> };
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function runDirectory(env = process.env) { return join(pipelineOutputDir(env), "analysis-runs"); }
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export function predictionHash(rows: FrozenPrediction[]) { return createHash("sha256").update(JSON.stringify(rows)).digest("hex"); }
let queue: Promise<unknown> = Promise.resolve();
export function ledgerTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation); queue = result.catch(() => {}); return result;
}
async function save(record: AnalysisRecord, env = process.env) {
  if (!validId(record.runId)) throw new Error("Invalid run identifier.");
  const directory = runDirectory(env); await mkdir(directory, { recursive: true });
  const temporary = join(directory, `${record.runId}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(record), "utf8");
  await rename(temporary, join(directory, `${record.runId}.json`));
}
export async function loadRun(runId: string, env = process.env): Promise<AnalysisRecord> {
  if (!validId(runId)) throw new Error("Invalid run identifier.");
  const record = JSON.parse(await readFile(join(runDirectory(env), `${runId}.json`), "utf8")) as AnalysisRecord;
  if (record.version !== 1 || record.runId !== runId || !["official", "adhoc"].includes(record.kind) || !["model_only", "full"].includes(record.mode)
    || !["running", "completed", "failed"].includes(record.status) || !Array.isArray(record.predictions) || !Array.isArray(record.outcomes)
    || !Number.isFinite(Date.parse(record.startedAt)) || (record.status === "completed" && typeof record.predictionHash !== "string")
    || (record.predictionHash !== null && predictionHash(record.predictions) !== record.predictionHash)
    || record.outcomes.some(item => item.source !== "kis" || !validDate(item.date) || !/^\d{6}$/.test(item.code) || !Number.isFinite(item.open) || item.open <= 0 || !Number.isFinite(item.close) || item.close <= 0
      || !Number.isFinite(item.actualReturn) || Math.abs(item.actualReturn - (item.close - item.open) / item.open) > 1e-10)) throw new Error("Run record is invalid.");
  return record;
}
export async function listRuns(env = process.env): Promise<{ runs: AnalysisRecord[]; invalid: number }> {
  let files: string[];
  try { files = await readdir(runDirectory(env)); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return { runs: [], invalid: 0 }; throw error; }
  const runs: AnalysisRecord[] = []; let invalid = 0;
  for (const file of files.filter(file => validId(file.replace(/\.json$/, "")) && file.endsWith(".json"))) {
    try { runs.push(await loadRun(file.slice(0, -5), env)); } catch { invalid++; }
  }
  return { runs: runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)), invalid };
}
export async function beginRun(runId: string, kind: RunKind, mode: RunMode, startedAt: number, env = process.env) {
  const record: AnalysisRecord = { version: 1, runId, kind, mode, status: "running", startedAt: new Date(startedAt).toISOString(), finishedAt: null,
    baseDate: null, targetDate: null, predictions: [], predictionHash: null, officialEligible: null, reason: "분석 진행 중 · 예측 결과 고정 저장 대기", error: null,
    outcomes: [], outcomeState: "waiting", lastCollectedAt: null };
  await ledgerTransaction(() => save(record, env)); return record;
}
export async function updateRun(runId: string, update: (record: AnalysisRecord) => AnalysisRecord, env = process.env) {
  return ledgerTransaction(async () => {
    const current = await loadRun(runId, env), next = update(current);
    // Outcomes can change; a completed prediction snapshot cannot.
    if (current.predictionHash && (next.predictionHash !== current.predictionHash || predictionHash(next.predictions) !== current.predictionHash)) throw new Error("Frozen predictions cannot change.");
    await save(next, env); return next;
  });
}
function number(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function freezePredictions(rankCsv: string, selectionCsv: string, mode: RunMode): FrozenPrediction[] {
  const selection = parseCsv(selectionCsv), selected = new Map(selection.map(row => [row.ticker, row]));
  if (selected.size !== selection.length) throw new Error("Duplicate selected predictions.");
  const rows: FrozenPrediction[] = [], codes = new Set<string>();
  for (const row of parseCsv(rankCsv)) {
    if (row.prediction_status !== "ok") continue;
    const prediction = number(row.ensemble_pred_return), rank = number(row.pred_rank);
    if (!/^\d{6}$/.test(row.ticker) || !validDate(row.prediction_base_date) || row.prediction_target !== "next_session_open_to_close" || prediction === null || rank === null || !Number.isInteger(rank) || rank < 1 || codes.has(row.ticker)) throw new Error("Invalid prediction snapshot.");
    codes.add(row.ticker);
    const final = selected.get(row.ticker), finalPrediction = mode === "full" && final ? number(final.final_pred_return) : prediction;
    if (final && (final.prediction_base_date !== row.prediction_base_date || finalPrediction === null)) throw new Error("Selected prediction is inconsistent.");
    rows.push({ code: row.ticker, name: row.company_name || row.ticker, baseDate: row.prediction_base_date, prediction: finalPrediction!, rank, selected: !!final });
  }
  if (!rows.length || new Set(rows.map(row => row.baseDate)).size !== 1 || selection.some(row => !codes.has(row.ticker))) throw new Error("A single verified prediction base date is required.");
  return rows.sort((a, b) => a.rank - b.rank);
}
export async function completeRun(runId: string, startedAt: number, env = process.env) {
  const record = await loadRun(runId, env), directory = pipelineOutputDir(env);
  const files = ["step2_all_transformer_rank.csv", record.mode === "full" ? "step3_final_top5.csv" : "step2_final_top10.csv"];
  const texts: string[] = [];
  for (const file of files) {
    const path = join(directory, file);
    if ((await stat(path)).mtimeMs + 1000 < startedAt) throw new Error("Prediction snapshot was not updated.");
    texts.push(await readFile(path, "utf8"));
  }
  const predictions = freezePredictions(texts[0], texts[1], record.mode), baseDate = predictions[0].baseDate;
  let eligible: boolean | null = record.kind === "official" ? null : false;
  let reason = record.kind === "official" ? "예측 고정 저장 완료 · 목표 거래일 및 개장 전 완료 여부 확인 대기" : "수시 실행 · 공식 성과 집계에서 제외, 실제 가격은 별도 추적";
  if (record.kind === "official") {
    try {
      await writeFile(join(runDirectory(env), `official-${record.mode}-${baseDate}.json`), JSON.stringify({ runId }), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      eligible = false; reason = "같은 예측 기준일·모드의 공식 실행이 이미 고정되어 중복 집계에서 제외";
    }
  }
  return updateRun(runId, current => ({ ...current, status: "completed", finishedAt: new Date().toISOString(), baseDate, predictions,
    predictionHash: predictionHash(predictions), officialEligible: eligible, reason,
    outcomeState: predictions.some(row => row.selected) ? "waiting" : "unavailable",
    ...(predictions.some(row => row.selected) ? {} : { reason: "선별 결과 0개 · 성과를 계산할 대상 종목이 없습니다." }) }), env);
}
export async function failRun(runId: string, reason: string, env = process.env) {
  return updateRun(runId, record => ({ ...record, status: "failed", finishedAt: new Date().toISOString(), reason: "분석 실패 · 예측 고정 저장 또는 성과 계산 불가", error: reason, outcomeState: "unavailable" }), env);
}
