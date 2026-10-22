// Current final-model UI fixtures only. No provider, account or analysis calls.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const observedAt = "2026-10-21T07:00:00.000Z";
const codes = ["005930", "000660", "035420", "005380", "000270", ...Array.from({ length: 25 }, (_, i) => String(100000+i))];
const names = ["삼성전자", "SK하이닉스", "NAVER", "현대차", "기아"];
function modelRows() {
  return codes.map((code, i) => ({
    input_row: { ticker: code, company_name: names[i] ?? `검증 종목 ${i+1}`, model_id: "plain_20_120_rank_mean_v1",
      score_kind: "rank_zscore", rank_score: 1.5-i*.1, pred_rank: i+1, pred_pool_size: 30,
      prediction_base_date: "2026-10-21", prediction_target: "next_session_open_to_close", prediction_status: "ok" },
    result: { ticker: code, company_name: names[i] ?? `검증 종목 ${i+1}`, label: "NEUTRAL", label_ko: "중립", confidence: 0,
      summary: "20일·120일 모델의 동일 비중 상대 순위입니다.", key_data_points: [] },
    news: i < 5 ? [{ index: 1, title: `${names[i]} 실적 발표`, source: "검증용 매체", pub_date: observedAt, url: "https://news.google.com/rss/articles/fixture" }] : [],
    data_meta: { source: "cache", asOf: observedAt, newsCollected: true, newsStatus: "collected", newsMethod: "unknown" },
  }));
}
function chart(code) {
  const dates = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const rawPrices = dates.map((date, i) => ({ date, price: 70000+i*1000 }));
  const candles = dates.map((date, i) => ({ time: date, rawTime: date, open: 69800+i*1000, high: 71000+i*1000, low: 69000+i*1000, close: 70000+i*1000,
    rawValues: { open: 69800+i*1000, high: 71000+i*1000, low: 69000+i*1000, close: 70000+i*1000, volume: 100000 } }));
  return { source: "cache", asOf: observedAt, chartData: { code, ranges: Object.fromEntries(["1D", "1W", "1M", "3M", "1Y"].map(range => [range, { prices: rawPrices, rawPrices, candles }])) } };
}

export async function startFixtureServer() {
  const root = resolve(fileURLToPath(new URL("../../dist/", import.meta.url)));
  const requests = [], rows = modelRows();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const json = (body, status = 200) => {
      response.writeHead(status, { "content-type": "application/json", "X-Data-Source": "cache", "X-Data-As-Of": observedAt });
      response.end(JSON.stringify(body));
    };
    requests.push({ path: url.pathname, method: request.method });
    if (request.method !== "GET") return json({ error: "Read-only fixture" }, 403);
    if (url.pathname.startsWith("/api/")) {
      const code = url.searchParams.get("ticker") ?? url.searchParams.get("symbol") ?? codes[0];
      const availability = { state: "available", count: 30, source: "cache", asOf: observedAt };
      if (url.pathname === "/api/backend/status") return json({ version: 1, source: "unknown", asOf: null, analysisMode: "model_only", checkedAt: observedAt,
        market: { configuration: "configured", verification: "unverified" }, news: { configuration: "not_configured", collectionConfiguration: "not_configured", verification: "unverified" },
        runtime: { state: "idle", startedAt: null, finishedAt: null }, marker: { state: "completed", mode: "model_only", source: "cache", asOf: observedAt, startedAt: observedAt, finishedAt: observedAt },
        results: { candidates: { state: "not_produced", count: null, source: "unknown", asOf: null }, rank: availability } });
      if (url.pathname === "/api/rank") return json(rows);
      if (url.pathname === "/api/candidates") return json([]);
      if (url.pathname === "/api/stock-analysis") return json(rows.find(row => row.input_row.ticker === code) ?? null);
      if (url.pathname === "/api/candidates/run") return json({ status: "idle", mode: "model_only" });
      if (url.pathname === "/api/korean-market/next-session") return json({ nextSession: "2026-10-22" });
      if (url.pathname === "/api/korean-market/indices") return json(["KOSPI", "KOSPI200"].map(symbol => ({ symbol, name: symbol, value: 300, change: 1, changeRate: .3, miniSeries: [298,299,300], miniSeriesSource: "history", source: "cache", asOf: observedAt })));
      if (url.pathname === "/api/korean-market/quote") return json({ code, name: names[codes.indexOf(code)] ?? "검증 종목", currentPrice: 74000, change: 1000, changeRate: 1.37, accumulatedVolume: 100000, tradingValue: 7400000000 });
      if (url.pathname === "/api/korean-market/stock-chart") return json(chart(code));
      if (url.pathname === "/api/performance") return json({ version: 1, source: "cache", asOf: observedAt, runs: [], summaries: ["model_only", "full"].map(mode => ({ mode, tradingDays: 0, measuredRuns: 0, averageReturn: null, cumulativeReturn: null, hitRate: null })), reasons: ["검증용 빈 성과 기록"], collector: { status: "idle", checkedAt: null, error: null } });
      return json({ error: "Unknown fixture route" }, 404);
    }
    try {
      const requested = resolve(root, "."+decodeURIComponent(url.pathname));
      if (requested !== root && !requested.startsWith(root+sep)) return json({ error: "Invalid path" }, 400);
      const file = extname(requested) ? requested : resolve(root, "index.html");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" })[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch { json({ error: "Fixture asset missing; run npm run build first" }, 404); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}
