import { buildKisIndices, buildKisStockChart, buildKisStockQuote, fetchKisTargetSession, getDailyHistory } from "./kisDashboard";
import { getRankPayload } from "./pipelineResults";
import { marketCacheExpiry, marketClock } from "./marketCachePolicy";
import { kisRequestMetrics } from "./kisRateLimit";
import type { PipelineOutputRow } from "../src/types/trading";

declare const process: { env: Record<string, string | undefined> };
type Dependencies = {
  symbols(): Promise<string[]>;
  quote(code: string): Promise<unknown>;
  urgentQuote?(code: string): Promise<unknown>;
  chart(code: string): Promise<unknown>;
  history?(code: string): Promise<unknown>;
  indices(): Promise<unknown>;
  session?(baseDate: string): Promise<unknown>;
  now?: () => number;
};

/** Independent jobs prevent a cold multi-page chart from blocking the quote/index cadence. */
export function createRefreshAhead({ symbols, quote, urgentQuote = quote, chart, history, indices, session, now = Date.now }: Dependencies) {
  const pending = new Map<string, Promise<void>>(), attempted = new Map<string, number>();
  const failures = new Map<string, { count: number; retryAt: number }>();
  const urgent = new Map<string, Promise<void>>();
  let stopped = false, ticking = false, retick = false, draining = false, revision = 0;
  let targets: string[] | undefined, currentCodes: string[] = [], baseDate: string | undefined;
  const stats = { completed: 0, failed: 0 };
  function schedule(key: string, period: number, load: () => Promise<unknown>) {
    const last = attempted.get(key);
    const failed = failures.get(key);
    if (stopped || pending.has(key) || (failed ? now() < failed.retryAt : last !== undefined && now() < marketCacheExpiry(last, period))) return pending.get(key);
    attempted.set(key, now());
    const started = now();
    const task = Promise.resolve().then(load).then(value => { if (value === null) throw new Error("No observation available."); }).then(() => { stats.completed++; failures.delete(key); }, () => {
      stats.failed++;
      const count = (failures.get(key)?.count ?? 0) + 1;
      failures.set(key, { count, retryAt: now() + Math.min(600_000, 60_000 * 2 ** Math.min(count - 1, 4)) });
    }).finally(() => {
      // Space normal jobs from completion, but still finalize jobs that crossed the closing boundary.
      if (!(marketClock(started).active && !marketClock(now()).active)) attempted.set(key, now());
      pending.delete(key);
    });
    pending.set(key, task);
    return task;
  }
  const normalize = (codes: string[]) => [...new Set(codes)].filter(code => /^\d{6}$/.test(code)).slice(0, 5);
  // Keep only one expensive history/chart job running; new results replace the remainder.
  async function drain() {
    if (draining || stopped) return;
    draining = true;
    try {
      let observed: number;
      do {
        observed = revision;
        for (const code of currentCodes) {
          if (stopped || observed !== revision) break;
          await schedule(`chart:${code}`, 60_000, () => chart(code));
          if (stopped || observed !== revision) break;
          if (history) await schedule(`history:${code}`, 86_400_000, () => history(code));
        }
      } while (!stopped && observed !== revision);
    } finally { draining = false; }
  }
  const worker = {
    setTargets(codes: string[], date?: string) {
      const next = normalize(codes);
      if (JSON.stringify(next) !== JSON.stringify(targets) || date !== baseDate) revision++;
      targets = currentCodes = next; baseDate = date;
      // Old targets must not grow the schedule/backoff maps indefinitely.
      for (const key of attempted.keys()) if (!pending.has(key) && !next.some(code => key.endsWith(`:${code}`)) && key !== "indices" && key !== `session:${date}`) {
        attempted.delete(key); failures.delete(key);
      }
    },
    async warmQuotes(codes: string[], budgetMs = 6000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tasks = normalize(codes).flatMap(code => {
        let task = urgent.get(code);
        // A timed-out batch may still finish, but cannot accumulate more than five jobs.
        if (!task && urgent.size < 5) {
          task = Promise.resolve().then(() => urgentQuote(code)).then(() => {}, () => {
            console.warn("[refresh-ahead]", { reason: "quote_warmup_failed" });
          }).finally(() => urgent.delete(code));
          urgent.set(code, task);
        }
        return task ? [task] : [];
      });
      try {
        await Promise.race([Promise.all(tasks), new Promise<void>(resolve => {
          timer = setTimeout(() => { console.warn("[refresh-ahead]", { reason: "quote_warmup_timeout" }); resolve(); }, budgetMs);
        })]);
      } finally { if (timer !== undefined) clearTimeout(timer); }
    },
    async tick(): Promise<void> {
      if (stopped) return;
      if (ticking) { retick = true; return; }
      ticking = true;
      try {
        // Symbols always come from the current verified model result; no hard-coded demo list.
        const observed = revision;
        const codes = targets ?? normalize(await symbols());
        if (stopped || observed !== revision) return;
        if (JSON.stringify(codes) !== JSON.stringify(currentCodes)) revision++;
        currentCodes = codes;
        schedule("indices", 30_000, indices);
        // Quotes stay independent of slow history; cap outstanding jobs across result changes.
        for (const code of codes) if ([...pending.keys()].filter(key => key.startsWith("quote:")).length < 5) schedule(`quote:${code}`, 30_000, () => quote(code));
        const date = baseDate;
        if (session && date && ![...pending.keys()].some(key => key.startsWith("session:"))) schedule(`session:${date}`, 86_400_000, () => session(date));
        void drain();
      } finally {
        ticking = false;
        if (retick) { retick = false; void worker.tick().catch(() => {}); }
      }
    },
    async idle() { while (pending.size || draining) { await Promise.all([...pending.values()]); await Promise.resolve(); } },
    stop() { stopped = true; },
    stats() { return { ...stats, pending: pending.size }; },
  };
  return worker;
}

export function topFiveRows(rows: PipelineOutputRow[]): PipelineOutputRow[] {
  return rows.filter(row => Number(row.data_meta?.rawModelRank ?? row.input_row.pred_rank) > 0)
    .sort((a, b) => Number(a.data_meta?.rawModelRank ?? a.input_row.pred_rank) - Number(b.data_meta?.rawModelRank ?? b.input_row.pred_rank)).slice(0, 5);
}
const codesFor = (rows: PipelineOutputRow[]) => topFiveRows(rows).map(row => String(row.result?.ticker ?? row.input_row.ticker ?? "").padStart(6, "0"));
const scope = globalThis as typeof globalThis & { __top5RefreshAhead?: () => void; __top5RefreshWorker?: ReturnType<typeof createRefreshAhead> };
function refreshWorker(env: Record<string, string | undefined>) {
  if (scope.__top5RefreshWorker) return scope.__top5RefreshWorker;
  const background = { ...env, KIS_REQUEST_PRIORITY: "background" };
  return scope.__top5RefreshWorker = createRefreshAhead({
    symbols: async () => codesFor(await getRankPayload(env)),
    quote: code => buildKisStockQuote(code, background, true),
    urgentQuote: code => buildKisStockQuote(code, { ...env, KIS_REQUEST_PRIORITY: "user" }, true),
    history: code => getDailyHistory(code, { allowNetwork: true }, background),
    chart: code => buildKisStockChart(code, background, true),
    indices: () => buildKisIndices(background, true),
    session: date => fetchKisTargetSession(date, background),
  });
}
/** Bounded user-facing preparation stays enabled even when periodic background refresh is disabled. */
export async function warmCompletedQuotes(rows: PipelineOutputRow[] | (() => Promise<PipelineOutputRow[]>), env = process.env): Promise<PipelineOutputRow[]> {
  const deadline = Date.now() + 6000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let selected: PipelineOutputRow[];
  try {
    // A recovery disk read shares the same six-second budget; a late read has no side effects.
    selected = typeof rows === "function" ? await Promise.race([Promise.resolve().then(rows), new Promise<PipelineOutputRow[]>(resolve => {
      timer = setTimeout(() => { console.warn("[refresh-ahead]", { reason: "quote_preparation_timeout" }); resolve([]); }, 6000);
    })]) : rows;
  } finally { if (timer !== undefined) clearTimeout(timer); }
  const remaining = deadline - Date.now();
  if (selected.length && remaining > 0) await refreshWorker(env).warmQuotes(codesFor(selected), remaining);
  return selected;
}
export function refreshCompletedTopFive(rows: PipelineOutputRow[], env = process.env) {
  if (env.REFRESH_AHEAD === "0" || !rows.length) return;
  const worker = refreshWorker(env), top = topFiveRows(rows);
  worker.setTargets(codesFor(top), top[0]?.input_row.prediction_base_date);
  void worker.tick().catch(() => { console.warn("[refresh-ahead]", { reason: "completed_warmup_failed" }); });
}
export function startRefreshAhead(env = process.env): () => void {
  if (env.REFRESH_AHEAD === "0" || env.VITEST || env.NODE_ENV === "test") return () => {};
  if (scope.__top5RefreshAhead) return () => {};
  const worker = refreshWorker(env);
  let loggedAt = Date.now(), previous = { ...kisRequestMetrics };
  function tick() {
    void worker.tick().catch(() => {});
    if (Date.now() - loggedAt >= 60_000) {
      // Counts only: no URLs, configuration, token, key, or provider response bodies.
      console.log("[refresh-ahead]", JSON.stringify({ windowMs: Date.now() - loggedAt,
        userCalls: kisRequestMetrics.user - previous.user, backgroundCalls: kisRequestMetrics.background - previous.background,
        EGW00201: kisRequestMetrics.rateLimitErrors - previous.rateLimitErrors, ...worker.stats() }));
      previous = { ...kisRequestMetrics }; loggedAt = Date.now();
    }
  }
  const timer = setInterval(tick, 5000);
  (timer as unknown as { unref?: () => void }).unref?.();
  const stop = () => { worker.stop(); clearInterval(timer); if (scope.__top5RefreshAhead === stop) { delete scope.__top5RefreshAhead; delete scope.__top5RefreshWorker; } };
  scope.__top5RefreshAhead = stop;
  tick();
  return stop;
}
