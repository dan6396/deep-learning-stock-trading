import { beforeEach, describe, expect, it, vi } from "vitest";
const files = vi.hoisted(() => new Map());
vi.mock("node:fs/promises", () => {
  const item = path => { const found = files.get(path.replace(/\\/g, "/").split("/").pop()); if (!found) throw Object.assign(new Error("fixture absent"), { code: "ENOENT" }); return found; };
  const mocks = { readFile: vi.fn(async path => item(path).text), access: vi.fn(async path => { item(path); }), stat: vi.fn(async path => ({ mtimeMs: item(path).mtime, isFile: () => true })), writeFile: vi.fn(), mkdir: vi.fn() };
  return { ...mocks, default: mocks };
});
vi.mock("../../server/dashboardCache", () => ({ readLastSnapshot: vi.fn(), writeDashboardSnapshot: vi.fn() }));
import { inspectPipelineResultAvailability, validateModelOnlyOutputs, getCandidatesPayload, getRankPayload, getStockAnalysisPayload } from "../../server/pipelineResults";
import { writeFile, mkdir } from "node:fs/promises";
import { adaptCandidate } from "../entities/candidate";
import { newsSignal, supplySignal } from "../entities/signals";
const startedAt = 1791350000000;
const header = "ticker,company_name,prediction_target,ensemble_pred_return,pred_rank,pred_pool_size";
const row = "005930,Fixture,next_session_open_to_close,0.02,1,199";
const set = (name, text, mtime = startedAt + 2000) => files.set(name, { text, mtime });
const marker = (status = "completed", mode) => set(".candidate-analysis-run.json", JSON.stringify({ status, mode, startedAt, finishedAt: startedAt + 2000 }));
beforeEach(() => { files.clear(); vi.clearAllMocks(); marker(); });
describe("existing loader inspection and STEP2 completion contract", () => {
  it("distinguishes successful header-only [] from absent files without any writes", async () => {
    set("step3_final_top5.csv", `${header}\n`); set("step2_all_transformer_rank.csv", `${header}\n`);
    expect(await inspectPipelineResultAvailability()).toMatchObject({ candidates: { state: "empty", count: 0 }, rank: { state: "empty", count: 0 } });
    expect(await getCandidatesPayload()).toEqual([]); files.delete("step3_final_top5.csv");
    expect((await inspectPipelineResultAvailability()).candidates).toMatchObject({ state: "missing", count: null });
    expect(writeFile).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
  });
  it.each(["failed", "running", "absent", "malformed"])("never treats %s marker as a successful zero", async state => {
    set("step3_final_top5.csv", `${header}\n`); if (state === "absent") files.delete(".candidate-analysis-run.json"); else if (state === "malformed") set(".candidate-analysis-run.json", "{"); else marker(state);
    expect((await inspectPipelineResultAvailability()).candidates).toMatchObject({ state: "blocked", count: null });
  });
  it("rejects malformed/old output separately and preserves real rows", async () => {
    set("step3_final_top5.csv", "bad document"); set("step2_all_transformer_rank.csv", `${header}\n${row}`, startedAt - 5000);
    expect(await inspectPipelineResultAvailability()).toMatchObject({ candidates: { state: "invalid", count: null }, rank: { state: "stale", count: null } });
    set("step2_all_transformer_rank.csv", `${header}\n${row}`);
    expect((await inspectPipelineResultAvailability()).rank).toMatchObject({ state: "available", count: 1, source: "cache" });
  });
  it("model-only keeps final candidates unproduced and blocks even fresh prior news overlays", async () => {
    marker("completed", "model_only"); set("step2_final_top10.csv", `${header}\n${row}`); set("step3_final_top5.csv", `${header}\n${row}`);
    set("step2_all_transformer_rank.csv", `${header}\n${row}`);
    set("step3_final_news_event_analysis.json", JSON.stringify({ "005930": { final_score: 0.8, final_rank: 1, status: "analyzed", news: [] } }));
    expect(await getCandidatesPayload()).toEqual([]);
    const rank = await getRankPayload(), stock = await getStockAnalysisPayload("005930");
    expect(rank).toHaveLength(1); expect(stock).toEqual(rank[0]);
    const adapted = adaptCandidate(stock).data;
    expect(adapted).toMatchObject({ isFinalCandidate: false, predictedReturn: 0.02, rank: 1, finalRank: null, finalPredictedReturn: null, newsCollected: false, newsMethod: "unknown", news: [] });
    expect(newsSignal(adapted).state).toBe("unavailable");
    expect(await inspectPipelineResultAvailability()).toMatchObject({ candidates: { state: "not_produced", count: null }, rank: { state: "available", count: 1 } });
  });
});

// Real STEP2 columns (integrated_pipeline.py): both CSVs carry status, rank, pool size, base date and target.
const modelHeader = "ticker,company_name,pred_rank,pred_pool_size,ensemble_pred_return,prediction_base_date,prediction_target,prediction_status";
const modelRow = (ticker, rank, prediction, patch = {}) => {
  const v = { pool: 3, date: "2026-10-08", target: "next_session_open_to_close", status: "ok", ...patch };
  return `${ticker},Fixture ${ticker},${rank},${v.pool},${prediction},${v.date},${v.target},${v.status}`;
};
const csv = (...rows) => `${modelHeader}\n${rows.join("\n")}`;
const whole = () => csv(modelRow("005930", 1, 0.03), modelRow("000660", 2, 0.01), modelRow("035420", 3, -0.02));
const selectionOf = (...rows) => set("step2_final_top10.csv", csv(...rows));
describe("model-only completion contract (validateModelOnlyOutputs)", () => {
  beforeEach(() => { set("step2_all_transformer_rank.csv", whole()); selectionOf(modelRow("005930", 1, 0.03), modelRow("000660", 2, 0.01)); });
  it("accepts a fresh consistent whole rank and its exact top selection", async () => {
    expect(await validateModelOnlyOutputs("fixture", startedAt)).toEqual({ rows: 3, modelSelectionRows: 2 });
  });
  it("accepts failed rows that are not ok as long as they claim no model rank", async () => {
    set("step2_all_transformer_rank.csv", csv(modelRow("005930", 1, 0.03, { pool: 1 }), `000660,Fixture,,1,,,next_session_open_to_close,prediction_failed`));
    selectionOf(modelRow("005930", 1, 0.03, { pool: 1 }));
    expect(await validateModelOnlyOutputs("fixture", startedAt)).toEqual({ rows: 2, modelSelectionRows: 1 });
  });
  it("rejects an old selection file after a fresh rank", async () => {
    set("step2_final_top10.csv", csv(modelRow("005930", 1, 0.03)), startedAt - 5000);
    await expect(validateModelOnlyOutputs("fixture", startedAt)).rejects.toThrow("not updated");
  });
  it.each([
    ["not csv", "not csv"], ["header only (fake empty completion)", `${modelHeader}\n`],
    ["non-numeric ticker", csv(modelRow("abc", 1, 0.03))], ["placeholder ticker", csv(modelRow("000000", 1, 0.03))],
    ["only failed rows", csv(modelRow("005930", "", "", { status: "prediction_failed", pool: 0 }))],
    ["non-finite prediction", csv(modelRow("005930", 1, "nan", { pool: 1 }))],
    ["missing prediction", csv(modelRow("005930", 1, "", { pool: 1 }))],
    ["non-positive rank", csv(modelRow("005930", 0, 0.03, { pool: 1 }))],
    ["fractional rank", csv(modelRow("005930", 1.5, 0.03, { pool: 1 }))],
    ["wrong prediction target", csv(modelRow("005930", 1, 0.03, { pool: 1, target: "next_close" }))],
    ["invalid base date", csv(modelRow("005930", 1, 0.03, { pool: 1, date: "2026-13-40" }))],
    ["rolled-over calendar date", csv(modelRow("005930", 1, 0.03, { pool: 1, date: "2026-02-30" }))],
    ["blank base date",csv(modelRow("005930", 1, 0.03, { pool: 1, date: "" }))],
    ["duplicate ticker", csv(modelRow("005930", 1, 0.03, { pool: 2 }), modelRow("005930", 2, 0.01, { pool: 2 }))],
    ["failed row claiming a rank", csv(modelRow("005930", 1, 0.03, { pool: 1 }), modelRow("000660", 2, "", { pool: 1, status: "prediction_failed" }))],
    ["mixed base dates", csv(modelRow("005930", 1, 0.03, { pool: 2 }), modelRow("000660", 2, 0.01, { pool: 2, date: "2026-10-07" }))],
  ])("rejects an invalid whole rank: %s", async (_name, text) => {
    set("step2_all_transformer_rank.csv", text);
    await expect(validateModelOnlyOutputs("fixture", startedAt)).rejects.toThrow(/Invalid model/);
  });
  it.each([
    ["missing required column", "ticker,ensemble_pred_return,prediction_target\n005930,0.03,next_session_open_to_close"],
    ["selection without status/date columns", "ticker,pred_rank,pred_pool_size,ensemble_pred_return,prediction_target\n005930,1,3,0.03,next_session_open_to_close"],
  ])("rejects an incomplete selection schema: %s", async (_name, text) => {
    set("step2_final_top10.csv", text);
    await expect(validateModelOnlyOutputs("fixture", startedAt)).rejects.toThrow("Invalid model output schema");
  });
  it.each([
    ["rank gap", csv(modelRow("005930", 1, 0.03), modelRow("000660", 3, 0.01), modelRow("035420", 4, -0.02))],
    ["rank order disagrees with prediction", csv(modelRow("005930", 1, 0.01), modelRow("000660", 2, 0.03), modelRow("035420", 3, -0.02))],
    ["declared pool size differs from ok rows", csv(modelRow("005930", 1, 0.03, { pool: 9 }), modelRow("000660", 2, 0.01, { pool: 9 }), modelRow("035420", 3, -0.02, { pool: 9 }))],
  ])("rejects an inconsistent whole rank: %s", async (_name, text) => {
    set("step2_all_transformer_rank.csv", text);
    await expect(validateModelOnlyOutputs("fixture", startedAt)).rejects.toThrow("Inconsistent");
  });
  it.each([
    ["empty selection (fake empty completion)", []],
    ["selection ticker outside the rank", [modelRow("999999", 1, 0.03)]],
    ["selection is not the top of the rank", [modelRow("000660", 1, 0.01)]],
    ["selection raw prediction differs from the rank", [modelRow("005930", 1, 0.5)]],
    ["selection rank differs from the rank", [modelRow("005930", 2, 0.03)]],
    ["selection pool size differs", [modelRow("005930", 1, 0.03, { pool: 2 })]],
    ["selection base date differs", [modelRow("005930", 1, 0.03, { date: "2026-10-07" })]],
    ["duplicate selected ticker", [modelRow("005930", 1, 0.03), modelRow("005930", 2, 0.03)]],
  ])("rejects an inconsistent selection: %s", async (_name, rows) => {
    set("step2_final_top10.csv", rows.length ? csv(...rows) : `${modelHeader}\n`);
    await expect(validateModelOnlyOutputs("fixture", startedAt)).rejects.toThrow(/Inconsistent|Invalid model/);
  });
});

// Real step2_supply_checked.csv columns. Only a measured row may reach the page; not_checked rows hold placeholder zeros.
const supplyHeader = `${modelHeader},foreign_net_buy_sum,inst_net_buy_sum,total_supply_net_buy,foreign_positive_days,inst_positive_days,supply_score,supply_pass,supply_window,supply_data_days,supply_data_enough,supply_base_start_date,supply_base_end_date,supply_status,supply_error`;
const supplyRow = (ticker, rank, prediction, patch = {}) => {
  const v = { pool: 3, foreign: "-425000000.0", inst: "-452000000.0", fDays: 2, iDays: 0, window: 5, days: 5, enough: "True", status: "ok", date: "2026-10-08", target: "next_session_open_to_close", pStatus: "ok", ticker, rank, prediction, ...patch };
  return `${v.ticker},Fixture ${ticker},${v.rank},${v.pool},${v.prediction},${v.date},${v.target},${v.pStatus},${v.foreign},${v.inst},,${v.fDays},${v.iDays},,False,${v.window},${v.days},${v.enough},2026-10-01,2026-10-08,${v.status},`;
};
const notChecked = (ticker, rank, prediction) => supplyRow(ticker, rank, prediction, { foreign: "", inst: "", fDays: 0, iDays: 0, days: 0, enough: "False", status: "not_checked" });
const supplyCsv = (...rows) => `${supplyHeader}\n${rows.join("\n")}`;
const rankRow = async (ticker = "005930") => (await getRankPayload()).find(row => row.input_row.ticker === ticker);
describe("model-only supply overlay (step2_supply_checked.csv)", () => {
  it("copies the measured combined-positive-day field and enables the supply signal", async () => {
    marker("completed", "model_only"); set("step2_all_transformer_rank.csv", whole());
    set("step2_supply_checked.csv", `${supplyHeader},combined_positive_days\n${supplyRow("005930", 1, 0.03)},1`);
    const candidate = adaptCandidate(await rankRow()).data;
    expect(candidate.supply.combinedPositiveDays).toBe(1);
    expect(supplySignal(candidate).state).toBe("negative");
  });
  beforeEach(() => {
    marker("completed", "model_only"); set("step2_all_transformer_rank.csv", whole());
    set("step2_supply_checked.csv", supplyCsv(supplyRow("005930", 1, 0.03), notChecked("000660", 2, 0.01), notChecked("035420", 3, -0.02)));
  });
  it("copies measured supply originals onto the whole-rank row and the stock row without deriving anything", async () => {
    const adapted = adaptCandidate(await rankRow()).data, stock = adaptCandidate(await getStockAnalysisPayload("005930")).data;
    for (const candidate of [adapted, stock]) {
      expect(candidate.supply).toEqual({ foreignNetBuy: -425000000, institutionNetBuy: -452000000, combinedNetBuy: -877000000, foreignPositiveDays: 2, institutionPositiveDays: 0,
        combinedPositiveDays: null, window: 5, dataDays: 5, enough: true, status: "ok" });
      expect(candidate).toMatchObject({ predictedReturn: 0.03, rank: 1, finalRank: null, finalPredictedReturn: null, newsCollected: false, news: [], isFinalCandidate: false });
    }
    // combined_positive_days is not in the source and is never inferred, so the rule stays honestly unavailable.
    expect(supplySignal(adapted)).toMatchObject({ state: "unavailable", reason: expect.stringContaining("합산 순매수 일수") });
    expect(await getCandidatesPayload()).toEqual([]);
  });
  it("never promotes not_checked placeholder zeros to measured zero", async () => {
    const row = await rankRow("000660"), candidate = adaptCandidate(row).data;
    expect(row.input_row).not.toHaveProperty("supply_status"); expect(row.input_row).not.toHaveProperty("foreign_positive_days");
    expect(candidate.supply).toEqual({ foreignNetBuy: null, institutionNetBuy: null, combinedNetBuy: null, foreignPositiveDays: null, institutionPositiveDays: null,
      combinedPositiveDays: null, window: null, dataDays: null, enough: null, status: null });
  });
  it("keeps a partial measured window as not enough instead of dropping or completing it", async () => {
    set("step2_supply_checked.csv", supplyCsv(supplyRow("005930", 1, 0.03, { days: 3, enough: "False", status: "insufficient_data", fDays: 3, iDays: 1 })));
    const candidate = adaptCandidate(await rankRow()).data;
    expect(candidate.supply).toMatchObject({ dataDays: 3, window: 5, enough: false, status: "insufficient_data", foreignPositiveDays: 3, combinedPositiveDays: null });
    expect(supplySignal(candidate).state).toBe("unavailable");
  });
  it.each([
    ["a different base date", { date: "2026-10-07" }], ["a different rank", { rank: 2 }], ["a different prediction", { prediction: 0.031 }],
    ["a non-padded ticker", { ticker: "5930" }], ["a different target", { target: "next_close" }], ["a non-ok prediction", { pStatus: "prediction_failed" }],
    ["fetch_failed supply", { status: "fetch_failed", days: 0, enough: "False", foreign: "", inst: "" }],
    ["a zero-day window with otherwise valid fields", { status: "insufficient_data", days: 0, enough: "False", fDays: 0, iDays: 0 }],
    ["a not_checked status even with plausible partial values", { status: "not_checked", days: 3, enough: "False", fDays: 1, iDays: 1 }],
    ["a fetch_failed status even with plausible partial values", { status: "fetch_failed", days: 3, enough: "False", fDays: 1, iDays: 1 }],
    ["an enough flag contradicting the days", { enough: "False" }], ["ok status with too few days", { days: 3 }], ["positive days above the data days", { fDays: 6 }],
    ["a blank foreign sum", { foreign: "" }], ["a non-finite institution sum", { inst: "nan" }], ["a fractional day count", { fDays: 1.5 }],
  ])("keeps supply missing for %s", async (_name, patch) => {
    set("step2_supply_checked.csv", supplyCsv(supplyRow("005930", 1, 0.03, patch)));
    const row = await rankRow();
    expect(row.input_row).not.toHaveProperty("supply_status"); expect(adaptCandidate(row).data.supply.foreignNetBuy).toBeNull();
    expect(adaptCandidate(row).data).toMatchObject({ predictedReturn: 0.03, rank: 1, finalRank: null });
  });
  it("keeps supply missing when the file is absent, stale, or the ticker is duplicated", async () => {
    files.delete("step2_supply_checked.csv");
    expect(adaptCandidate(await rankRow()).data.supply.status).toBeNull();
    set("step2_supply_checked.csv", supplyCsv(supplyRow("005930", 1, 0.03)), startedAt - 5000);
    expect(adaptCandidate(await rankRow()).data.supply.status).toBeNull();
    set("step2_supply_checked.csv", supplyCsv(supplyRow("005930", 1, 0.03), supplyRow("005930", 1, 0.03)));
    expect(adaptCandidate(await rankRow()).data.supply.status).toBeNull();
  });
  it.each([
    ["a new start time", { startedAt: startedAt + 1 }], ["a new finish time", { finishedAt: startedAt + 2500 }],
    ["a switch to full mode", { mode: undefined }], ["a failed status", { status: "failed" }],
  ])("does not use supply read while the run marker changes (%s)", async (_name, change) => {
    const text = supplyCsv(supplyRow("005930", 1, 0.03));
    files.set("step2_supply_checked.csv", { get text() { set(".candidate-analysis-run.json", JSON.stringify({ status: "completed", mode: "model_only", startedAt, finishedAt: startedAt + 2000, ...change })); return text; }, mtime: startedAt + 2000 });
    expect(adaptCandidate(await rankRow()).data.supply.status).toBeNull();
  });
  it("does not expose raw supply errors or extra supply columns", async () => {
    set("step2_supply_checked.csv", supplyCsv(supplyRow("005930", 1, 0.03)).replace(/,ok,$/m, ",ok,PRIVATE-TOKEN-ERROR"));
    expect(JSON.stringify(await rankRow())).not.toMatch(/PRIVATE-TOKEN-ERROR|supply_error|supply_score|total_supply_net_buy|supply_pass/);
  });
  it("leaves a full-mode rank untouched by the supply file", async () => {
    marker("completed");
    expect((await rankRow()).input_row).not.toHaveProperty("supply_status");
  });
});
