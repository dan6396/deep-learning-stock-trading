// Local-only test server: dist assets + deterministic fixtures. Never imports FE/server.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const fixtureCodes = ["005930", "000660", "267250", "035420", "005380"];
export const fixtureNames = ["삼성전자", "SK하이닉스", "HD현대", "NAVER", "현대차"];
const observedAt = "2026-10-07T09:00:00Z";
export function backendStatusFixture(scenario = "configured") {
  const availability = (state = "available", count = 5) => ({ state, count: state === "available" ? count : state === "empty" ? 0 : null, source: ["available", "empty"].includes(state) ? "cache" : "unknown", asOf: ["available", "empty"].includes(state) ? observedAt : null });
  const state = ["missing", "invalid", "stale", "empty", "unknown"].includes(scenario) ? scenario : "available";
  const status = { version: 1, analysisMode: scenario === "model_only" ? "model_only" : "full", checkedAt: observedAt, source: "unknown", asOf: null,
    market: { configuration: scenario === "unconfigured" ? "not_configured" : "configured", verification: "unverified" },
    news: { configuration: scenario === "unconfigured" ? "not_configured" : "configured", collectionConfiguration: scenario === "news_ready" ? "configured" : "not_configured", verification: "unverified" },
    runtime: { state: scenario === "running" ? "running" : "idle", startedAt: scenario === "running" ? observedAt : null, finishedAt: null },
    marker: { state: scenario === "failed" ? "failed" : scenario === "absent" ? "absent" : scenario === "invalid" ? "invalid" : scenario === "running" ? "running" : "completed", mode: scenario === "model_only" ? "model_only" : "full", startedAt: observedAt, finishedAt: observedAt, source: "cache", asOf: observedAt },
    results: { candidates: availability(state), rank: availability(state, 199) } };
  if (["failed", "absent"].includes(scenario)) status.results = { candidates: availability("blocked"), rank: availability("blocked") };
  if (scenario === "model_only") status.results.candidates = availability("not_produced");
  return status;
}
export function candidateFixture(code, version = 1) {
  const i = fixtureCodes.indexOf(code), offset = i < 0 ? 0 : i;
  return {
    input_row: { ticker: code, company_name: fixtureNames[offset], prediction_target: "next_session_open_to_close",
      prediction_base_date: "2026-10-07", ensemble_pred_return: offset === 4 ? null : (3.12 - offset * 0.68 + (version - 1)) / 100,
      final_pred_return: offset === 4 ? null : (3.42 - offset * .68 + (version - 1)) / 100,
      pred_rank: offset === 3 ? null : 5 + offset * 3, pred_pool_size: 199,
      foreign_net_buy_sum: offset === 4 ? null : 1350000000 - offset * 380000000, inst_net_buy_sum: 450000000 - offset * 200000000,
      foreign_positive_days: 3, inst_positive_days: 2, supply_window: 5, supply_data_days: 5, supply_data_enough: true, supply_status: "ok" },
    result: { ticker: code, company_name: fixtureNames[offset], summary: `${fixtureNames[offset]}의 모델 예측과 뉴스 근거를 함께 확인하세요. ${version > 1 ? "갱신 후 결과" : "저장된 분석 결과"}입니다.`,
      trading_insight: "상대 순위는 미래 수익을 보장하지 않습니다.", key_data_points: [], confidence: 0, sentiment_score: 0, label: "NEUTRAL" },
    news: offset === 4 ? [] : [
      { title: `${fixtureNames[offset]} 사업 현황 점검`, source: "검증용 기사", pub_date: observedAt, sentiment: offset === 1 ? "NEGATIVE" : "POSITIVE", sentiment_reason: "fixture 판정", index: 1 },
      { title: `${fixtureNames[offset]} 산업 동향과 불확실성`, source: "검증용 기사", pub_date: observedAt, sentiment: "NEUTRAL", index: 2 },
    ],
    data_meta: { source: "cache", asOf: observedAt, rawFinalRank: offset === 4 ? null : offset + 1, newsCollected: offset !== 4, newsMethod: "llm", newsStatus: offset === 4 ? "api_budget_reached" : "analyzed" },
  };
}
/** What the server returns after a model-only run: raw model values only, no news-adjusted finals or news evidence. */
export function modelOnlyRow(row) {
  return { ...row, news: [], input_row: { ...row.input_row, final_pred_return: null, news_adjustment: null, news_applied: false },
    data_meta: { ...row.data_meta, rawFinalPrediction: null, rawFinalRank: null, newsCollected: false, newsMethod: "unknown", newsStatus: "skipped", newsTally: null } };
}
export function indexFixtures() {
  return [
    { symbol: "KOSPI", name: "코스피", value: 2748.32, change: 11.24, changeRate: 0.41, source: "cache", asOf: observedAt, miniSeriesSource: "history", miniSeries: [2712, 2703, 2720, 2728, 2719, 2734, 2748.32] },
    { symbol: "KOSPI200", name: "코스피 200", value: 367.84, change: 2.30, changeRate: 0.63, source: "cache", asOf: observedAt, miniSeriesSource: "interpolated", miniSeries: [365.54, 366.1, 366.5, 367, 367.4, 367.84] },
    { symbol: "KOSDAQ", name: "코스닥", value: 821.17, change: -3.41, changeRate: -0.41, source: "sample", asOf: observedAt, miniSeriesSource: "interpolated", miniSeries: [825, 824, 823, 822, 821.17] },
  ];
}
export function rankFixtures(version = 1) {
  return [...fixtureCodes.map(code => candidateFixture(code, version)), ...Array.from({ length: 194 }, (_, index) => {
    const code = String(100001 + index), name = `검증종목${String(index + 1).padStart(3, "0")}`, row = candidateFixture(code, version);
    row.result.company_name = name; row.input_row.company_name = name;
    row.input_row.ensemble_pred_return = index === 0 ? 0 : index === 1 ? -.01 : index === 2 ? null : (194 - index) / 10000;
    row.input_row.final_pred_return = null; row.input_row.pred_rank = index + 6;
    row.input_row.foreign_net_buy_sum = null; row.input_row.inst_net_buy_sum = null;
    row.data_meta.rawFinalRank = null;
    if (index !== 3) { row.news = []; row.data_meta.newsCollected = false; row.data_meta.newsMethod = "unknown"; row.data_meta.newsStatus = "pending"; }
    return row;
  })];
}
export function chartFixture(code = "005930", version = 1) {
  const basePrice = (code === "005930" ? 72000 : 180000) + (version - 1) * 5000;
  const ranges = Object.fromEntries(["1D", "1M", "3M", "1Y", "3Y", "5Y"].map((range, index) => {
    const candles = Array.from({ length: 18 }, (_, i) => {
      const time = range === "1D" ? `2026-10-07T${String(9 + Math.floor(i / 3)).padStart(2, "0")}:${String(i % 3 * 20).padStart(2, "0")}:00+09:00`
        : new Date(Date.UTC(2026, 9, 7) - (17 - i) * [0, 1, 4, 15, 45, 90][index] * 86400000).toISOString().slice(0, 10);
      const close = basePrice + i * 110 + Math.round(Math.sin(i * .8) * 850), open = close - (i % 2 ? -190 : 160), high = Math.max(open, close) + 260, low = Math.min(open, close) - 310, volume = i === 0 ? 0 : 90000 + i * 1200;
      return { time, rawTime: time, open, high, low, close, volume, rawValues: { open, high, low, close, volume } };
    });
    return [range, { candles, prices: candles.map(point => ({ date: point.time, rawDate: point.rawTime, price: point.close })), rawPrices: candles.map(point => ({ date: point.rawTime, price: point.close })) }];
  }));
  return { source: "cache", asOf: observedAt, chartData: { code, symbol: code, name: fixtureNames[fixtureCodes.indexOf(code)] ?? code, currentPrice: basePrice, ranges }, sourceStock: { code } };
}
export async function startFixtureServer({ port = 0 } = {}) {
  const dist = resolve(fileURLToPath(new URL("../../dist/", import.meta.url)));
  const initial = () => ({ scenario: "populated", rankScenario: "populated", rankDelayMs: 0, version: 1, analysis: "idle", candidatesDelayMs: 0, stockDelays: {}, quoteDelays: {}, chartDelays: {}, chartDelayQueue: [], stockScenario: "populated", chartScenario: "populated", quoteScenario: "populated", indicesFail: false, quoteFail: false, lazyDelayMs: 0 });
  let state = initial();
  const requests = [];
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const json = (data, status = 200, source = "cache") => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-data-source": source, "x-data-as-of": observedAt }); response.end(JSON.stringify(data)); };
    try {
      if (url.pathname === "/_fixture/control" && request.method === "POST") {
        let raw = ""; for await (const chunk of request) raw += chunk;
        const change = JSON.parse(raw || "{}");
        if (change.reset) state = initial();
        state = { ...state, ...change }; json(state); return;
      }
      if (url.pathname === "/_fixture/requests" && request.method === "GET") { json(requests); return; }
      if (url.pathname === "/_fixture/watchlist-write" && request.method === "GET") {
        const value = JSON.parse(url.searchParams.get("value") ?? "[]");
        if (!Array.isArray(value) || !value.every(code => typeof code === "string" && /^\d{6}$/.test(code))) { json({ error: "Invalid fixture watchlist" }, 400); return; }
        const script = url.searchParams.has("clear") ? "localStorage.clear()" : `localStorage.setItem('kospi-watchlist.v1',${JSON.stringify(JSON.stringify(value))})`;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(`<!doctype html><html lang="ko"><title>Local fixture storage writer</title><script>${script}</script><body>Fixture only; no application or external scripts.</body></html>`); return;
      }
      if (request.method !== "GET") { requests.push({ method: request.method, path: url.pathname, blocked: true }); json({ error: "Fixture server blocks non-GET product requests" }, 403); return; }
      if (url.pathname.startsWith("/api/")) {
        requests.push({ method: request.method, path: url.pathname, query: url.search, at: Date.now() });
        const snapshot = structuredClone(state);
        const code = url.searchParams.get("ticker") ?? url.searchParams.get("symbol") ?? "005930";
        if (url.pathname === "/api/performance") {
          json({ version: 1, source: "cache", asOf: observedAt, runs: [], summaries: ["model_only", "full"].map(mode => ({ mode, tradingDays: 0, measuredRuns: 0, averageReturn: null, cumulativeReturn: null, hitRate: null })), reasons: ["검증된 공식 성과가 아직 없습니다. 공식 기록 선택, 예측 고정 저장, 목표 거래일 종료, KIS 실제 가격 확인이 필요합니다."], collector: { status: "idle", checkedAt: null, error: null } });
        } else if (url.pathname === "/api/backend/status") {
          if (snapshot.backendScenario === "error") json({ error: "Fixture status unavailable" }, 502, "unknown");
          else json(backendStatusFixture(snapshot.backendScenario), 200, "unknown");
        } else if (url.pathname === "/api/rank") {
          const rows = rankFixtures(snapshot.version).map(row => snapshot.backendScenario === "model_only" ? modelOnlyRow(row) : row);
          if (snapshot.rankScenario === "sample") rows.forEach(row => { row.data_meta.source = "sample"; });
          if (snapshot.rankDelayMs) await new Promise(resolve => setTimeout(resolve, snapshot.rankDelayMs));
          if (snapshot.rankScenario === "error") json({ error: "fixture rank failure" }, 502);
          else json(snapshot.rankScenario === "empty" ? [] : rows, 200, snapshot.rankScenario === "sample" ? "sample" : "cache");
        } else if (url.pathname === "/api/candidates") {
          // Model-only: the news-adjusted final list was never produced, so the array is [] (not "zero finals").
          const rows = snapshot.backendScenario === "model_only" ? [] : fixtureCodes.map(code => candidateFixture(code, snapshot.version));
          if (snapshot.scenario === "sample") rows.forEach(row => { row.data_meta.source = "sample"; });
          if (snapshot.negativeCandidate) rows[0].input_row.ensemble_pred_return = -.02;
          if (snapshot.candidatesDelayMs) await new Promise(resolve => setTimeout(resolve, snapshot.candidatesDelayMs));
          if (snapshot.scenario === "error") json({ error: "fixture failure" }, 502);
          else json(snapshot.scenario === "empty" ? [] : rows, 200, snapshot.scenario === "sample" ? "sample" : "cache");
        } else if (url.pathname === "/api/korean-market/indices") {
          if (snapshot.indicesFail) json({ error: "fixture indices failure" }, 502); else json(indexFixtures(), 200, "sample");
        } else if (url.pathname === "/api/korean-market/dashboard") {
          json({ generatedAt: observedAt, source: "cache", indices: indexFixtures(), stocks: [] });
        } else if (url.pathname === "/api/stock-analysis") {
          if (snapshot.stockDelays[code]) await new Promise(resolve => setTimeout(resolve, snapshot.stockDelays[code]));
          let row = candidateFixture(snapshot.scenario === "mismatch" || snapshot.stockScenario === "mismatch" ? "000660" : code, snapshot.version);
          if (snapshot.backendScenario === "model_only") row = modelOnlyRow(row);
          if (snapshot.stockScenario === "sample") row.data_meta.source = "sample";
          if (snapshot.stockScenario === "newsUnknown") { row.news[0].sentiment = "unclear"; row.news[0].sentiment_reason = "원본 unclear 판정 근거"; row.news[0].url = "javascript:alert(1)"; row.news[0].description = "원본 기사 설명"; }
          row.news.forEach((article, index) => { article.url ??= index ? "//invalid.invalid/article" : "https://fixture-news.invalid/article"; article.sentiment_reason ??= "원본 LLM 근거"; });
          if (snapshot.stockScenario === "error") json({ error: "fixture analysis failure" }, 502);
          else json(snapshot.stockScenario === "null" ? null : row);
        } else if (url.pathname === "/api/korean-market/quote") {
          if (snapshot.quoteDelays[code]) await new Promise(resolve => setTimeout(resolve, snapshot.quoteDelays[code]));
          if (snapshot.quoteFail) json({ error: "fixture quote failure" }, 502);
          else json({ code: snapshot.quoteScenario === "mismatch" ? "000660" : code, name: fixtureNames[fixtureCodes.indexOf(code)] ?? "조회 종목", market: "KOSPI", currentPrice: snapshot.quoteScenario === "missing" ? null : code === "005930" ? 74200 : 189500, change: 500, changeRate: 0.68, accumulatedVolume: snapshot.quoteScenario === "zero" ? 0 : 1200045, tradingValue: snapshot.quoteScenario === "zero" ? 0 : 84000000000, source: snapshot.quoteScenario === "sample" ? "sample" : "cache", asOf: observedAt });
        } else if (url.pathname === "/api/korean-market/stock-chart") {
          const delay = state.chartDelayQueue.shift() ?? snapshot.chartDelays[code] ?? 0;
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          const bundle = chartFixture(snapshot.chartScenario === "mismatch" ? "000660" : code, snapshot.version);
          if (["sample", "unknown"].includes(snapshot.chartScenario)) bundle.source = snapshot.chartScenario;
          for (const range of Object.values(bundle.chartData.ranges)) {
            if (snapshot.chartScenario === "empty") { range.prices = []; range.candles = []; range.rawPrices = []; }
            if (snapshot.chartScenario === "old") range.candles.forEach(point => { delete point.rawValues; });
            if (snapshot.chartScenario === "missingTime") { range.rawPrices.forEach(point => { point.date = null; }); range.prices.forEach(point => { point.rawDate = null; }); range.candles.forEach(point => { point.rawTime = null; }); }
            if (snapshot.chartScenario === "invalid") { range.prices.splice(2, 1); range.rawPrices[2].price = null; range.candles[2].rawValues.open = null; }
          }
          if (snapshot.chartScenario === "partial") bundle.chartData.ranges["5Y"] = { ...bundle.chartData.ranges["1Y"], coverage: { requestedRange: "5Y", sourceRange: "1Y", method: "fallback", status: "partial", requestedStart: "2021-10-07", requestedEnd: "2026-10-07", observedStart: "2026-01-25", observedEnd: "2026-10-07" } };
          if (snapshot.chartScenario === "error") json({ error: "fixture chart failure" }, 502); else json(bundle, 200, bundle.source);
        } else if (url.pathname === "/api/candidates/run") {
          json({ source: "live", asOf: observedAt, status: snapshot.analysis, elapsedMs: 20000, progress: { updatedAt: Date.parse(observedAt) + snapshot.version, message: "검증용 분석 상태" }, result: snapshot.analysis === "completed" ? { rows: snapshot.backendScenario === "model_only" ? 199 : 5, elapsedMs: 20000, status: "completed", ...(snapshot.backendScenario === "model_only" ? { mode: "model_only", candidateKind: "not_produced", newsRows: 0 } : {}) } : null }, 200, "live");
        } else json({ error: "Unknown fixture API" }, 404);
        return;
      }
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = resolve(dist, relative || "index.html");
      if (file !== dist && !file.startsWith(`${dist}${sep}`)) { json({ error: "Invalid path" }, 400); return; }
      if (state.lazyDelayMs && /(?:PlaceholderPage|RankPage)-.*\.js$/.test(file)) await new Promise(resolve => setTimeout(resolve, state.lazyDelayMs));
      let body, servedFile = file;
      try { body = await readFile(file); } catch {
        if (extname(file)) { json({ error: "Asset not found" }, 404); return; }
        servedFile = resolve(file, "index.html");
        try { body = await readFile(servedFile); } catch { servedFile = resolve(dist, "index.html"); body = await readFile(servedFile); }
      }
      response.writeHead(200, { "content-type": types[extname(servedFile)] ?? "application/octet-stream", "cache-control": "no-store" }); response.end(body);
    } catch (error) { if (!response.headersSent) json({ error: error.message }, 500); else response.end(); }
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await startFixtureServer({ port: Number(process.argv[2] ?? 4173) });
  console.log(`Fixture-only dist server: ${fixture.base}`);
}
