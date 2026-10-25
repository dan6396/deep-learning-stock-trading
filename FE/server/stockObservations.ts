import { getDailyHistory, type DailyHistory } from "./kisDashboard";
import { readBoundedJson } from "./boundedJson";
import type { NasdaqSensitivity, Diversification } from "../src/types/stockInsight";
type Bar = { date: string; open: number; close: number };
type Pair = { date: string; previousDate: string; nasdaqDate: string; us: number; cc: number; oc: number };
export type HistoryReader = (code: string, opts: { start?: string; end?: string; allowNetwork?: boolean }) => Promise<DailyHistory | null>;
const DAY = 86_400_000;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const isoDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function bars(values: Bar[]): Bar[] {
  const grouped = new Map<string, Bar | null>();
  for (const row of values) if (isoDay(row.date)) {
    if (grouped.has(row.date)) grouped.set(row.date, null); // Ambiguous duplicates cannot be used.
    else grouped.set(row.date, positive(row.open) && positive(row.close) ? row : null);
  }
  // Keep invalid dates as explicit gaps, so the next return never spans a missing price.
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => row ?? { date, open: NaN, close: NaN });
}
function historyBars(history: DailyHistory | null): Bar[] {
  return history ? [...history.rows, ...(history.missingDates ?? []).map(date => ({ date, open: NaN, close: NaN }))] : [];
}
/** Same rule as scripts/analysis/nasdaq_kospi_conditional.py: max(US date < KR date). */
export function alignPriorSessions(korean: Bar[], american: Bar[], start: string, end: string): Pair[] {
  const kr = bars(korean), us = bars(american), result: Pair[] = [];
  let cursor = -1;
  for (let index = 1; index < kr.length; index++) {
    const row = kr[index], previous = kr[index - 1];
    while (cursor + 1 < us.length && us[cursor + 1].date < row.date) cursor++;
    if (row.date < start || row.date > end || cursor < 1 || !positive(row.open) || !positive(row.close) || !positive(previous.close)
      || !positive(us[cursor].close) || !positive(us[cursor - 1].close)) continue;
    // Missing sessions are not filled; long multi-session returns must not masquerade as daily returns.
    if (Date.parse(row.date) - Date.parse(previous.date) > 7 * DAY) continue;
    result.push({ date: row.date, previousDate: previous.date, nasdaqDate: us[cursor].date,
      us: us[cursor].close / us[cursor - 1].close - 1, cc: row.close / previous.close - 1, oc: row.close / row.open - 1 });
  }
  return result;
}
export function pairedMoments(x: number[], y: number[]): { correlation: number; beta: number } | null {
  if (x.length !== y.length || x.length < 2 || [...x, ...y].some(value => !Number.isFinite(value))) return null;
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let xx = 0, yy = 0, xy = 0;
  x.forEach((value, i) => { xx += (value - mx) ** 2; yy += (y[i] - my) ** 2; xy += (value - mx) * (y[i] - my); });
  return xx > 1e-20 && yy > 1e-20 ? { correlation: Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))), beta: xy / xx } : null;
}
export function nasdaqSensitivity(history: DailyHistory | null, us: Bar[], start: string, end: string): NasdaqSensitivity {
  const pairs = history ? alignPriorSessions(historyBars(history), us, start, end) : [];
  const base: NasdaqSensitivity = { status: "preparing", samples: pairs.length, periodStart: pairs[0]?.date ?? null, periodEnd: pairs[pairs.length - 1]?.date ?? null,
    metrics: [], conditional: null, complete: history?.complete ?? false,
    source: "KIS 종목 일봉 · Yahoo Finance 나스닥 일봉",
    note: "직전 미국 거래일을 한국 거래일에 연결한 최근 1년 과거 통계입니다. 상관·베타는 인과나 미래 성과를 뜻하지 않습니다. 같은 미국장이 한국 휴장 차이로 재사용될 수 있습니다." };
  if (pairs.length < 200) return base;
  const metrics = (["close_to_close", "open_to_close"] as const).flatMap(definition => {
    const value = pairedMoments(pairs.map(row => row.us), pairs.map(row => definition === "close_to_close" ? row.cc : row.oc));
    return value ? [{ definition, ...value, samples: pairs.length }] : [];
  });
  const up = pairs.filter(row => row.us > 0), count = up.filter(row => row.oc > 0).length, baselineCount = pairs.filter(row => row.oc > 0).length;
  return { ...base, status: metrics.length === 2 ? "ready" : "preparing", metrics,
    conditional: metrics.length === 2 && up.length >= 30 ? { count, total: up.length, ratioPct: count / up.length * 100,
      baselinePct: baselineCount / pairs.length * 100, baselineCount, baselineTotal: pairs.length } : null };
}
export function compositionObservations(codes: string[], histories: (DailyHistory | null)[], sensitivities: NasdaqSensitivity[]): Diversification {
  const returns = histories.map(history => {
    const rows = bars(historyBars(history)), result = new Map<string, { value: number; previous: string }>();
    rows.forEach((row, i) => { const prev = rows[i - 1]; if (prev && positive(row.close) && positive(prev.close)) result.set(row.date, { value: row.close / prev.close - 1, previous: prev.date }); });
    return result;
  });
  const window = [...new Set(histories.flatMap(history => historyBars(history).map(row => row.date)))].sort().slice(-60);
  // Complete-case dates with the same prior session for every stock; no pairwise sample ambiguity.
  const dates = window.filter(date => returns.every(map => map.has(date)) && new Set(returns.map(map => map.get(date)!.previous)).size === 1);
  const ready = codes.length === 5 && dates.length >= 55;
  const matrix = codes.map((_code, i) => codes.map((_other, j) => ready ? pairedMoments(dates.map(date => returns[i].get(date)!.value), dates.map(date => returns[j].get(date)!.value))?.correlation ?? null : null));
  const pairs = codes.flatMap((code, i) => codes.slice(i + 1).flatMap((other, k) => { const correlation = matrix[i][i + k + 1]; return correlation === null ? [] : [{ codes: [code, other] as [string, string], correlation }]; }));
  const highestPair = [...pairs].sort((a, b) => b.correlation - a.correlation)[0] ?? null;
  const nasdaqBetas = codes.flatMap((code, i) => {
    const cc = sensitivities[i]?.metrics.find(row => row.definition === "close_to_close"), oc = sensitivities[i]?.metrics.find(row => row.definition === "open_to_close");
    return cc && oc ? [{ code, closeToClose: cc.beta, openToClose: oc.beta, samples: cc.samples }] : [];
  });
  return { status: ready ? "ready" : "preparing", codes, samples: dates.length, periodStart: dates[0] ?? null, periodEnd: dates[dates.length - 1] ?? null,
    matrix, averageCorrelation: pairs.length ? pairs.reduce((sum, row) => sum + row.correlation, 0) / pairs.length : null, highestPair, nasdaqBetas,
    commonRisks: [], note: "최근 60거래일 중 공통 관측 55일 이상일 때 종가→종가 수익률 상관을 표시합니다. 과거 상관은 변하며 분산 효과나 미래 성과를 보장하지 않습니다." };
}
export function createObservationProvider({ history = getDailyHistory, transport = fetch, now = Date.now }: { history?: HistoryReader; transport?: typeof fetch; now?: () => number } = {}) {
  let usCache: { at: number; rows: Bar[] } | null = null, pending: Promise<Bar[]> | null = null;
  let retryAt = 0;
  const cache = new Map<string, { expires: number; fingerprint: string; value: NasdaqSensitivity }>();
  async function american(): Promise<Bar[]> {
    if (usCache && now() - usCache.at < DAY) return usCache.rows;
    if (pending) return pending;
    if (now() < retryAt) return usCache?.rows ?? [];
    pending = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await transport(`https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?period1=${Math.floor((now() - 400 * DAY) / 1000)}&period2=${Math.floor(now() / 1000)}&interval=1d`, { signal: controller.signal });
        if (!response.ok) throw new Error("history_unavailable");
        const json = await readBoundedJson(response), result = json?.chart?.result?.[0], quote = result?.indicators?.quote?.[0];
        if (!Array.isArray(result?.timestamp) || !Array.isArray(quote?.close)) throw new Error("history_unavailable");
        const rows = result.timestamp.flatMap((time: number, i: number) => Number.isFinite(time) ? [{ date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(time * 1000), open: quote.open?.[i], close: quote.close[i] }] : []);
        usCache = { at: now(), rows: bars(rows) }; return usCache.rows;
      } catch { retryAt = now() + 60_000; return usCache?.rows ?? []; }
      finally { clearTimeout(timer); pending = null; }
    })(); return pending;
  }
  return {
    async get(codes: string[]) {
      const end = new Date(now() + 9 * 3600_000).toISOString().slice(0, 10), start = new Date(Date.parse(end) - 365 * DAY).toISOString().slice(0, 10);
      // Cache-only reads keep public GET latency independent of the background KIS queue.
      const histories = await Promise.all(codes.map(code => history(code, { start: new Date(Date.parse(start) - 10 * DAY).toISOString().slice(0, 10), allowNetwork: false }).catch(() => null)));
      if (histories.some(Boolean)) void american();
      const us = usCache?.rows ?? [];
      const sensitivities = histories.map((rows, i) => {
        const fingerprint = JSON.stringify([rows?.rows, rows?.complete, us]), cached = cache.get(codes[i]);
        if (cached && cached.expires > now() && cached.fingerprint === fingerprint) return cached.value;
        const value = nasdaqSensitivity(rows, us, start, end); cache.set(codes[i], { expires: now() + DAY, fingerprint, value }); return value;
      });
      return { histories, sensitivities, diversification: compositionObservations(codes, histories, sensitivities) };
    },
  };
}
export const stockObservations = createObservationProvider();
