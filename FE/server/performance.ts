import { listRuns, updateRun, validDate } from "./runLedger";
import { fetchKisSettlementPrice, fetchKisTargetSession } from "./kisDashboard";
import type { AnalysisRecord, PerformancePayload, PerformanceRun, PerformanceSummary, PriceOutcome, RunMode } from "../src/types/performance";

declare const process: { env: Record<string, string | undefined> };
type Providers = {
  target: typeof fetchKisTargetSession; price: typeof fetchKisSettlementPrice;
  now: () => number;
};
const providers: Providers = { target: (...args) => fetchKisTargetSession(...args), price: (...args) => fetchKisSettlementPrice(...args), now: () => Date.now() };
export function sessionEligibility(record: AnalysisRecord, targetDate: string): boolean {
  if (!validDate(targetDate) || !record.baseDate || targetDate <= record.baseDate || !record.finishedAt) return false;
  const finished = Date.parse(record.finishedAt);
  // Fixed eligibility cutoff (09:00 KST); this is not a claim of the actual opening time on special sessions.
  return finished >= Date.parse(`${record.baseDate}T15:30:00+09:00`) && finished < Date.parse(`${targetDate}T09:00:00+09:00`);
}
export function runPerformance(record: AnalysisRecord, symbol?: string): PerformanceRun {
  const selected = record.predictions.filter(row => row.selected && (!symbol || row.code === symbol));
  const measured = selected.flatMap(prediction => {
    const outcome = record.outcomes.find(item => item.code === prediction.code && item.date === record.targetDate);
    return outcome ? [{ prediction, outcome }] : [];
  });
  const complete = selected.length > 0 && selected.length === measured.length;
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const { predictions, predictionHash, outcomes, ...rest } = record;
  return { ...rest, predictedCount: predictions.length, selectedCount: selected.length, measuredCount: measured.length,
    measurements: selected.map(prediction => { const outcome = measured.find(item => item.prediction.code === prediction.code)?.outcome;
      return { code: prediction.code, name: prediction.name, predictedReturn: prediction.prediction, date: outcome?.date ?? record.targetDate,
        open: outcome?.open ?? null, close: outcome?.close ?? null, actualReturn: outcome?.actualReturn ?? null }; }),
    actualReturn: complete ? mean(measured.map(item => item.outcome.actualReturn)) : null,
    predictedReturn: selected.length ? mean(selected.map(item => item.prediction)) : null,
    hitRate: complete ? mean(measured.map(item => Number(Math.sign(item.prediction.prediction) === Math.sign(item.outcome.actualReturn)))) : null };
}
export function summarizePerformance(runs: PerformanceRun[], mode: RunMode): PerformanceSummary {
  const official = runs.filter(run => run.mode === mode && run.kind === "official" && run.officialEligible === true && run.outcomeState === "complete" && run.actualReturn !== null)
    .sort((a, b) => (b.targetDate ?? "").localeCompare(a.targetDate ?? ""));
  // One equally weighted selected portfolio per day; model-only/full series are never pooled.
  const unique = [...new Map(official.map(run => [run.targetDate, run])).values()].slice(0, 20);
  return { mode, tradingDays: unique.length, measuredRuns: unique.length,
    averageReturn: unique.length ? unique.reduce((sum, run) => sum + run.actualReturn!, 0) / unique.length : null,
    cumulativeReturn: unique.length ? unique.reduce((value, run) => value * (1 + run.actualReturn!), 1) - 1 : null,
    hitRate: unique.length ? unique.reduce((sum, run) => sum + run.hitRate!, 0) / unique.length : null };
}
let collector: PerformancePayload["collector"] = { status: "idle", checkedAt: null, error: null };
let collection: Promise<void> | null = null;
export async function getPerformancePayload(env = process.env, symbol?: string): Promise<PerformancePayload> {
  const stored = await listRuns(env);
  const records = symbol ? stored.runs.filter(run => run.predictions.some(row => row.selected && row.code === symbol)) : stored.runs;
  const runs = records.map(record => runPerformance(record, symbol));
  const reasons: string[] = [];
  if (!runs.length) reasons.push("고정 저장된 실행 기록이 없습니다. 새 분석을 실행하면 식별자·분류·예측이 저장됩니다. 구현 이전 결과는 소급하여 공식 성과로 등록하지 않습니다.");
  if (!runs.some(run => run.kind === "official" && run.officialEligible === true && run.outcomeState === "complete")) reasons.push("검증된 공식 성과가 아직 없습니다. 공식 기록 선택, 예측 고정 저장, 목표 거래일 종료, KIS 실제 가격 확인이 필요합니다.");
  if (stored.invalid) reasons.push(`무결성을 확인하지 못한 기록 ${stored.invalid}건은 집계에서 제외했습니다.`);
  const times = stored.runs.map(run => run.lastCollectedAt ?? run.finishedAt ?? run.startedAt).sort();
  const asOf = times[times.length - 1] ?? null;
  return { version: 1, source: "cache", asOf, runs: runs.slice(0, 100), summaries: [summarizePerformance(runs, "model_only"), summarizePerformance(runs, "full")], reasons, collector: { ...collector } };
}
export async function collectPerformance(env = process.env, deps: Providers = providers): Promise<void> {
  const stored = await listRuns(env);
  const pending = stored.runs.filter(run => run.status === "completed" && run.outcomeState !== "complete" && run.predictions.some(row => row.selected))
    .sort((a, b) => (a.lastCollectedAt ?? "").localeCompare(b.lastCollectedAt ?? "") || a.startedAt.localeCompare(b.startedAt)).slice(0, 10);
  for (const snapshot of pending) {
    let record = snapshot;
    const checkedAt = new Date(deps.now()).toISOString();
    try {
      const targetDate = record.targetDate ?? await deps.target(record.baseDate!, env);
      if (!targetDate || !validDate(targetDate) || targetDate <= record.baseDate!) {
        await updateRun(record.runId, current => ({ ...current, outcomeState: "waiting", lastCollectedAt: checkedAt, reason: "KIS 휴장일 달력 또는 실제 코스피 거래일 기록에서 다음 거래일을 아직 확인하지 못했습니다. 달력 권한이 없으면 다음 거래일 시세가 제공된 뒤 확인·수집합니다." }), env); continue;
      }
      const eligible = record.kind === "official" && record.officialEligible !== false ? sessionEligibility(record, targetDate) : record.officialEligible === true;
      const exclusion = record.kind === "adhoc" ? "수시 실행 · 공식 집계 제외" : !eligible ? "공식 집계 제외 · 개장 전 완료 기준 미충족 또는 동일 기준일·모드 중복 실행" : "공식 집계 대상";
      record = await updateRun(record.runId, current => ({ ...current, targetDate, officialEligible: eligible, lastCollectedAt: checkedAt }), env);
      // Wait until conservatively after the close, including delayed special sessions. Do not use intraday closes.
      if (deps.now() < Date.parse(`${targetDate}T18:30:00+09:00`)) {
        await updateRun(record.runId, current => ({ ...current, outcomeState: "waiting", reason: `${exclusion} · ${targetDate} 18:30 한국시간 이후 실제 종가 수집 대기` }), env); continue;
      }
      const outcomes = [...record.outcomes]; let failed = false;
      for (const prediction of record.predictions.filter(row => row.selected)) {
        if (outcomes.some(item => item.code === prediction.code && item.date === targetDate)) continue;
        try {
          const price = await deps.price(prediction.code, targetDate, env);
          if (!price || price.date !== targetDate || !Number.isFinite(price.open) || !Number.isFinite(price.close) || price.open <= 0 || price.close <= 0 || !Number.isFinite(price.volume) || price.volume <= 0) { failed = true; continue; }
          const actualReturn = (price.close - price.open) / price.open;
          if (!Number.isFinite(actualReturn)) { failed = true; continue; }
          const outcome: PriceOutcome = { code: prediction.code, date: targetDate, open: price.open, close: price.close,
            actualReturn, source: "kis", collectedAt: checkedAt };
          outcomes.push(outcome);
        } catch { failed = true; }
      }
      const complete = !failed && record.predictions.filter(row => row.selected).every(row => outcomes.some(item => item.code === row.code && item.date === targetDate));
      await updateRun(record.runId, current => ({ ...current, outcomes, lastCollectedAt: checkedAt, outcomeState: complete ? "complete" : "unavailable",
        reason: complete ? `${exclusion} · KIS 실제 시가→종가 수익률, 비용 차감 전` : `${exclusion} · 일부 종목의 유효한 시가·종가·거래량 미확보 또는 API 조회 실패. 부분 자료는 공식 평균에 포함하지 않습니다.` }), env);
    } catch {
      await updateRun(record.runId, current => ({ ...current, outcomeState: "unavailable", lastCollectedAt: checkedAt, reason: "KIS 인증·거래일·가격 조회 실패 · 설정을 확인한 뒤 재수집하세요. 실제 가격을 추정하지 않습니다." }), env);
    }
  }
}
export function startPerformanceCollection(env = process.env): PerformancePayload["collector"] {
  if (!collection) {
    collector = { status: "running", checkedAt: new Date().toISOString(), error: null };
    collection = collectPerformance(env).then(() => { collector = { status: "completed", checkedAt: new Date().toISOString(), error: null }; })
      .catch(() => { collector = { status: "failed", checkedAt: new Date().toISOString(), error: "저장된 실행 기록 또는 수집 결과를 읽거나 저장하지 못했습니다." }; })
      .finally(() => { collection = null; });
  }
  return { ...collector };
}
/** Scheduled HTTP requests await persistence before responding, including on hosts that freeze idle invocations. */
export async function runPerformanceCollection(env = process.env): Promise<PerformancePayload["collector"]> {
  startPerformanceCollection(env); await collection; return { ...collector };
}
export function startPerformanceScheduler(env = process.env) {
  const tick = () => {
    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" }).format(new Date()));
    if (hour >= 18 || hour < 8) startPerformanceCollection(env);
  };
  const interval = setInterval(tick, 15 * 60 * 1000); tick();
  return () => clearInterval(interval);
}
