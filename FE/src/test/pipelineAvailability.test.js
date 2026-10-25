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
const header = "ticker,company_name,prediction_target,ensemble_pred_return,pred_rank,pred_pool_size,prediction_base_date,prediction_status,rank_score,score_kind,model_id";
const row = (rank = 1, score = 1.5) => `${100000+rank},Fixture,next_session_open_to_close,,${rank},30,2026-10-08,ok,${score},rank_zscore,plain_20_120_rank_mean_v1`;
const csv = rows => `${header}\n${rows.join("\n")}\n`;
const set = (name, text, mtime = startedAt + 2000) => files.set(name, { text, mtime });
const marker = (status = "completed", mode = "model_only") => set(".candidate-analysis-run.json", JSON.stringify({ status, mode, startedAt, finishedAt: startedAt + 2000 }));
beforeEach(() => { files.clear(); vi.clearAllMocks(); marker(); });

it("reports current ranks separately from the unused news-final candidate endpoint", async () => {
  set("step2_all_transformer_rank.csv", csv([row()]));
  expect(await getCandidatesPayload()).toEqual([]);
  expect(await inspectPipelineResultAvailability()).toMatchObject({ candidates: { state: "not_produced" }, rank: { state: "available", count: 1 } });
  const rank = await getRankPayload();
  expect(rank[0].input_row).toMatchObject({ rank_score: 1.5, score_kind: "rank_zscore" });
  expect(rank[0].input_row.ensemble_pred_return).toBeUndefined();
  expect(await getStockAnalysisPayload("100001")).toEqual(rank[0]);
  expect(writeFile).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
});
it.each(["running", "failed", "absent"])("blocks %s outputs", async status => {
  set("step2_all_transformer_rank.csv", csv([row()]));
  if (status === "absent") files.delete(".candidate-analysis-run.json"); else marker(status);
  expect(await getRankPayload()).toEqual([]);
  expect((await inspectPipelineResultAvailability()).rank.state).toBe("blocked");
});
it("rejects retired runs and old model CSVs even if the file is fresh", async () => {
  set("step2_all_transformer_rank.csv", csv([row()])); marker("completed", "full");
  expect(await getRankPayload()).toEqual([]);
  marker(); set("step2_all_transformer_rank.csv", csv([row().replace("rank_zscore", "return")]));
  expect(await getRankPayload()).toEqual([]);
  set("step2_all_transformer_rank.csv", csv([row().replace("plain_20_120_rank_mean_v1", "old_model")]));
  expect(await getRankPayload()).toEqual([]);
});
it("distinguishes missing, stale and empty rank output", async () => {
  expect((await inspectPipelineResultAvailability()).rank.state).toBe("missing");
  set("step2_all_transformer_rank.csv", csv([row()]), startedAt - 5000);
  expect((await inspectPipelineResultAvailability()).rank.state).toBe("stale");
  expect(await getRankPayload()).toEqual([]);
  set("step2_all_transformer_rank.csv", csv([]));
  expect((await inspectPipelineResultAvailability()).rank).toMatchObject({ state: "empty", count: 0 });
});
it("validates the whole final ranking and its exact Top5", async () => {
  const all = Array.from({ length: 30 }, (_, i) => row(i+1, 1.5-i*.1));
  set("step2_all_transformer_rank.csv", csv(all)); set("step2_final_top10.csv", csv(all.slice(0, 5)));
  expect(await validateModelOnlyOutputs("fixture", startedAt)).toEqual({ rows: 30, modelSelectionRows: 5 });
  set("step2_final_top10.csv", csv(all.slice(1, 6)));
  await expect(validateModelOnlyOutputs("fixture", startedAt)).rejects.toThrow("Inconsistent");
});
it("prevents retired news files from modifying model ranks", async () => {
  set("step2_all_transformer_rank.csv", csv([row()]));
  set("step3_final_top5.csv", csv([row(25, -1)]));
  set("news_gemini_result.json", JSON.stringify({ "100001": { final_score: -999 } }));
  const rank = await getRankPayload(); expect(rank[0].input_row.rank_score).toBe(1.5);
  expect(rank[0].news).toEqual([]); expect(adaptCandidate(rank[0]).data.finalPredictedReturn).toBeNull();
});
it("does not apply supply belonging to another model", async () => {
  set("step2_all_transformer_rank.csv", csv([row()]));
  set("step2_supply_checked.csv", csv([row().replace("plain_20_120_rank_mean_v1", "another_model")]));
  const rank = await getRankPayload({ BRIEFING_SHOW_SUPPLY: "true" }); expect(rank[0].input_row.supply_status).toBeUndefined();
});
it("does not publish supply from either CSV unless explicitly enabled, including stock detail", async () => {
  set("step2_all_transformer_rank.csv", `${header},supply_status,foreign_net_buy_sum,inst_net_buy_sum,supply_data_days\n${row()},ok,1473000000,-10000000,5\n`);
  const hidden = await getRankPayload({});
  expect(JSON.stringify(hidden)).not.toMatch(/foreign_|inst_|supply_|1473000000|수급|Supply/);
  expect(await getStockAnalysisPayload("100001", {})).toEqual(hidden[0]);
  const visible = await getRankPayload({ BRIEFING_SHOW_SUPPLY: "true" });
  expect(visible[0].input_row.foreign_net_buy_sum).toBe("1473000000");
  expect(hidden[0].input_row.rank_score).toBe(visible[0].input_row.rank_score);
});
