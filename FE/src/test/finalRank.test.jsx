import { afterEach, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateModelOnlyOutputs } from "../../server/pipelineResults";
import { freezePredictions } from "../../server/runLedger";
import { runPerformance, summarizePerformance } from "../../server/performance";
import { adaptCandidate } from "../entities/candidate";
import { modelSignal } from "../entities/signals";
import { PredictionDirection } from "../features/briefing/PredictionDirection";
import { topFiveSummary } from "../features/briefing/topFiveSummary";
import { pipelineRow } from "./dataFixtures";

afterEach(cleanup);
const header = "ticker,company_name,prediction_target,ensemble_pred_return,pred_rank,pred_pool_size,prediction_base_date,prediction_status,rank_score,score_kind,model_id";
const record = (ticker, rank, score) => `${ticker},Fixture,next_session_open_to_close,,${rank},30,2026-10-20,ok,${score},rank_zscore,plain_20_120_rank_mean_v1`;
const all = Array.from({ length: 30 }, (_, i) => record(String(100000 + i), i + 1, 1.5 - i * .1));
const csv = (rows) => `${header}\n${rows.join("\n")}\n`;

it("validates rank CSVs and rejects return contamination, missing scores and mixed models", async () => {
  const dir = await mkdtemp(join(tmpdir(), "final-rank-"));
  const write = async (rank, selection) => {
    await writeFile(join(dir, "step2_all_transformer_rank.csv"), csv(rank));
    await writeFile(join(dir, "step2_final_top10.csv"), csv(selection));
  };
  try {
    await write(all, all.slice(0, 5));
    expect(await validateModelOnlyOutputs(dir, Date.now() - 1000)).toEqual({ rows: 30, modelSelectionRows: 5 });
    await write(all, all.slice(0, 5).map(r => r.replace("plain_20_120_rank_mean_v1", "another_model")));
    await expect(validateModelOnlyOutputs(dir, 0)).rejects.toThrow(/Invalid|Inconsistent/);
    await write(all.map(r => r.replace("open_to_close,,", "open_to_close,0.5,")), all.slice(0, 5));
    await expect(validateModelOnlyOutputs(dir, 0)).rejects.toThrow("Invalid");
    await write(all.map(r => r.replace(/,ok,[^,]+,rank_zscore/, ",ok,,rank_zscore")), all.slice(0, 5));
    await expect(validateModelOnlyOutputs(dir, 0)).rejects.toThrow("Invalid");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("freezes score units and never reports rank scores as returns or direction accuracy", () => {
  const predictions = freezePredictions(csv(all), csv(all.slice(0, 5)), "model_only");
  expect(predictions[0]).toMatchObject({ prediction: 1.5, scoreKind: "rank_zscore", modelId: "plain_20_120_rank_mean_v1" });
  expect(() => freezePredictions(csv(all), csv(all.slice(0, 5)), "full")).toThrow("rank scores");
  const row = {
    predictions, outcomes: predictions.slice(0, 5).map(p => ({ code: p.code, date: "2026-10-21", open: 100, close: 101, actualReturn: .01 })),
    targetDate: "2026-10-21", baseDate: "2026-10-20", kind: "official", mode: "model_only",
    officialEligible: true, outcomeState: "complete",
  };
  const result = runPerformance(row);
  expect(result.actualReturn).toBe(.01);
  expect(result.predictedReturn).toBeNull(); expect(result.hitRate).toBeNull();
  expect(result.rankScore).toBeCloseTo(1.3);
  expect(result.measurements[0]).toMatchObject({ predictedReturn: null, rankScore: 1.5 });
  expect(summarizePerformance([result], "model_only").hitRate).toBeNull();
  const older = { ...result, targetDate: "2026-10-19", modelId: "legacy", scoreKind: "return", actualReturn: .8, hitRate: 1 };
  expect(summarizePerformance([result, older], "model_only")).toMatchObject({ tradingDays: 1, averageReturn: .01, hitRate: null });
});

it("renders a rank score without a percent or an up/down claim", () => {
  const row = pipelineRow();
  Object.assign(row.input_row, { score_kind: "rank_zscore", rank_score: -.75, ensemble_pred_return: 99, pred_rank: 25, pred_pool_size: 30 });
  const candidate = adaptCandidate(row).data;
  expect(candidate.predictedReturn).toBeNull();
  expect(candidate.rankScore).toBe(-.75);
  expect(modelSignal(candidate).state).toBe("neutral");
  render(<PredictionDirection value={candidate.predictedReturn} rankScore={candidate.rankScore} scoreKind={candidate.scoreKind} />);
  expect(screen.getByText("-0.7500")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/%|상승|하락/);
});

it("summarizes the top five as relative selection, not missing returns", () => {
  const candidate = adaptCandidate(pipelineRow()).data;
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...candidate, baseDate: "2026-10-20", predictionTarget: "next_session_open_to_close", rank: i+1, scoreKind: "rank_zscore", rankScore: 1.5-i*.1, predictedReturn: null }));
  expect(topFiveSummary(rows)).toMatchObject({ range: "상대 순위 상위 5종목" });
});
