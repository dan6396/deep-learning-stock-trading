import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { beginRun, completeRun, listRuns, loadRun, updateRun, freezePredictions, runDirectory } from "../../server/runLedger";
import { collectPerformance, getPerformancePayload, sessionEligibility, summarizePerformance } from "../../server/performance";

let directory, env;
const header = "ticker,company_name,ensemble_pred_return,pred_rank,prediction_base_date,prediction_target,prediction_status,final_pred_return";
const rankCsv = `${header}\n005930,삼성전자,0.02,1,2026-10-08,next_session_open_to_close,ok,0.03\n000660,SK하이닉스,0.01,2,2026-10-08,next_session_open_to_close,ok,0.015\n`;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "run-ledger-test-")); env = { PIPELINE_OUTPUT_DIR: directory }; });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
async function completed(kind = "official", mode = "model_only") {
  const id = randomUUID(), start = Date.parse("2026-10-08T16:00:00+09:00");
  await beginRun(id, kind, mode, start, env);
  await writeFile(join(directory, "step2_all_transformer_rank.csv"), rankCsv);
  await writeFile(join(directory, mode === "full" ? "step3_final_top5.csv" : "step2_final_top10.csv"), rankCsv);
  await completeRun(id, start, env);
  await updateRun(id, run => ({ ...run, finishedAt: "2026-10-08T07:01:00.000Z" }), env);
  return id;
}
const now = Date.parse("2026-10-12T19:00:00+09:00");
function deps(price) { return { now: () => now, target: async () => "2026-10-12", price: price ?? (async (_code, date) => ({ date, open: 100, close: 110, volume: 1000 })) }; }

describe("persistent execution identity and frozen prediction evidence", () => {
  it("keeps official/adhoc identity across reload and never modifies a completed prediction", async () => {
    const id = await completed();
    expect((await listRuns(env)).runs[0]).toMatchObject({ runId: id, kind: "official", mode: "model_only", status: "completed" });
    await expect(updateRun(id, run => ({ ...run, predictions: [] }), env)).rejects.toThrow("Frozen");
    const raw = JSON.parse(await readFile(join(runDirectory(env), `${id}.json`), "utf8")); raw.predictions[0].prediction = 999;
    await writeFile(join(runDirectory(env), `${id}.json`), JSON.stringify(raw));
    expect(await listRuns(env)).toMatchObject({ runs: [], invalid: 1 });
  });
  it("excludes duplicate official runs but keeps model/news modes separate", async () => {
    const first = await completed(), second = await completed(), news = await completed("official", "full");
    expect((await loadRun(first, env)).officialEligible).toBeNull();
    expect((await loadRun(second, env)).officialEligible).toBe(false);
    expect((await loadRun(news, env)).officialEligible).toBeNull();
  });
  it("rejects mixed dates, duplicate tickers and unknown targets", () => {
    expect(() => freezePredictions(rankCsv.replace('000660,SK하이닉스,0.01,2,2026-10-08', '000660,SK하이닉스,0.01,2,2026-10-07'), rankCsv, "model_only")).toThrow();
    expect(() => freezePredictions(rankCsv.replace('000660', '005930'), rankCsv, "model_only")).toThrow();
    expect(() => freezePredictions(rankCsv.replaceAll('next_session_open_to_close', 'unknown'), rankCsv, "model_only")).toThrow();
  });
  it("does not allow path traversal for an identifier", async () => { await expect(loadRun("../secrets", env)).rejects.toThrow("identifier"); });
});
describe("actual KIS prices joined to the frozen target session", () => {
  it("aggregates at most 20 distinct completed official trading days per mode", () => {
    const runs = Array.from({ length: 21 }, (_, index) => ({ kind: "official", mode: "model_only", officialEligible: true, outcomeState: "complete", targetDate: `2026-09-${String(index + 1).padStart(2, "0")}`, actualReturn: index === 0 ? 99 : .01, hitRate: .5 }));
    const summary = summarizePerformance([...runs, { ...runs[20], kind: "adhoc", actualReturn: 99 }, { ...runs[20], mode: "full", actualReturn: 99 }], "model_only");
    expect(summary).toMatchObject({ tradingDays: 20, averageReturn: expect.closeTo(.01), cumulativeReturn: expect.closeTo(1.01 ** 20 - 1), hitRate: .5 });
  });
  it("handles holidays via the calendar and persists complete official returns idempotently", async () => {
    const id = await completed(); let calls = 0;
    const provider = deps(async (_code, date) => { calls++; return { date, open: 100, close: 110, volume: 1000 }; });
    await collectPerformance(env, provider); await collectPerformance(env, provider);
    expect(calls).toBe(2);
    expect(await loadRun(id, env)).toMatchObject({ targetDate: "2026-10-12", outcomeState: "complete", officialEligible: true });
    const result = await getPerformancePayload(env);
    expect(result.summaries[0]).toMatchObject({ tradingDays: 1, averageReturn: .1, cumulativeReturn: expect.closeTo(.1) });
    expect(result.summaries[1].tradingDays).toBe(0);
  });
  it("waits for closing prices and makes no price calls before the conservative cutoff", async () => {
    const id = await completed(); let calls = 0;
    await collectPerformance(env, { ...deps(async () => { calls++; return null; }), now: () => Date.parse("2026-10-12T14:00:00+09:00") });
    expect(calls).toBe(0); expect((await loadRun(id, env)).outcomeState).toBe("waiting");
  });
  it("rejects wrong-day prices and partial portfolios instead of averaging available winners", async () => {
    const id = await completed();
    await collectPerformance(env, deps(async (code, date) => ({ date: code === "005930" ? date : "2026-10-13", open: 100, close: 110, volume: 1000 })));
    expect((await loadRun(id, env)).outcomeState).toBe("unavailable");
    expect((await getPerformancePayload(env)).runs[0].actualReturn).toBeNull();
    expect((await getPerformancePayload(env)).summaries[0].tradingDays).toBe(0);
  });
  it("tracks adhoc and late official runs while excluding both from official summaries", async () => {
    const official = await completed(), adhoc = await completed("adhoc");
    await updateRun(official, run => ({ ...run, finishedAt: "2026-10-12T01:00:00.000Z" }), env);
    await collectPerformance(env, deps());
    const result = await getPerformancePayload(env);
    expect(result.runs.every(run => run.actualReturn === .1)).toBe(true);
    expect(result.summaries[0].tradingDays).toBe(0);
    expect((await loadRun(adhoc, env)).kind).toBe("adhoc");
  });
  it("never uses missing or zero OHLC, or zero trading volume", async () => {
    const id = await completed();
    await collectPerformance(env, deps(async (_code, date) => ({ date, open: 0, close: 110, volume: 1000 })));
    expect((await loadRun(id, env)).outcomes).toHaveLength(0);
    await collectPerformance(env, deps(async (_code, date) => ({ date, open: 100, close: 110, volume: 0 })));
    expect((await loadRun(id, env)).outcomes).toHaveLength(0);
  });
});
