import { buildKisIndices, buildKisStockChart, buildKisStockQuote, getDailyHistory } from "./kisDashboard";
import { getRankPayload } from "./pipelineResults";
import { marketCacheExpiry, marketClock } from "./marketCachePolicy";
import { kisRequestMetrics } from "./kisRateLimit";

declare const process: { env: Record<string, string | undefined> };
type Dependencies = {
  symbols(): Promise<string[]>;
  quote(code: string): Promise<unknown>;
  chart(code: string): Promise<unknown>;
  history?(code: string): Promise<unknown>;
  indices(): Promise<unknown>;
  now?: () => number;
};

/** Independent jobs prevent a cold multi-page chart from blocking the quote/index cadence. */
export function createRefreshAhead({ symbols, quote, chart, history, indices, now = Date.now }: Dependencies) {
  const pending = new Map<string, Promise<void>>(), attempted = new Map<string, number>();
  const failures = new Map<string, { count: number; retryAt: number }>();
  let stopped = false, ticking = false;
  const stats = { completed: 0, failed: 0 };
  function schedule(key: string, period: number, load: () => Promise<unknown>) {
    const last = attempted.get(key);
    const failed = failures.get(key);
    if (stopped || pending.has(key) || (failed ? now() < failed.retryAt : last !== undefined && now() < marketCacheExpiry(last, period))) return;
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
  }
  return {
    async tick() {
      if (stopped || ticking) return;
      ticking = true;
      try {
        // Symbols always come from the current verified model result; no hard-coded demo list.
        const codes = [...new Set(await symbols())].filter(code => /^\d{6}$/.test(code)).slice(0, 5);
        schedule("indices", 30_000, indices);
        for (const code of codes) schedule(`quote:${code}`, 30_000, () => quote(code));
        if (history) for (const code of codes) schedule(`history:${code}`, 86_400_000, () => history(code));
        for (const code of codes) schedule(`chart:${code}`, 60_000, () => chart(code));
      } finally { ticking = false; }
    },
    async idle() { await Promise.all([...pending.values()]); },
    stop() { stopped = true; },
    stats() { return { ...stats, pending: pending.size }; },
  };
}

const scope = globalThis as typeof globalThis & { __top5RefreshAhead?: () => void };
export function startRefreshAhead(env = process.env): () => void {
  if (env.REFRESH_AHEAD === "0" || env.VITEST || env.NODE_ENV === "test") return () => {};
  if (scope.__top5RefreshAhead) return () => {};
  const background = { ...env, KIS_REQUEST_PRIORITY: "background" };
  const worker = createRefreshAhead({
    symbols: async () => (await getRankPayload(env)).filter(row => Number(row.data_meta?.rawModelRank ?? row.input_row.pred_rank) > 0)
      .sort((a, b) => Number(a.data_meta?.rawModelRank ?? a.input_row.pred_rank) - Number(b.data_meta?.rawModelRank ?? b.input_row.pred_rank))
      .slice(0, 5).map(row => String(row.result?.ticker ?? row.input_row.ticker ?? "").padStart(6, "0")),
    quote: code => buildKisStockQuote(code, background, true),
    history: code => getDailyHistory(code, { allowNetwork: true }),
    chart: code => buildKisStockChart(code, background, true),
    indices: () => buildKisIndices(background, true),
  });
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
  const stop = () => { worker.stop(); clearInterval(timer); if (scope.__top5RefreshAhead === stop) delete scope.__top5RefreshAhead; };
  scope.__top5RefreshAhead = stop;
  tick();
  return stop;
}
