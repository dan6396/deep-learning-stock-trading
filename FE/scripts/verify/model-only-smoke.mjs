// FE: npm run build, then node scripts/verify/model-only-smoke.mjs. Run harnesses sequentially.
// Fixture-only: models the server state after a model-only run (candidates "not_produced", news-adjusted fields null).
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser } from "./cdp-browser.mjs";

const require = createRequire(import.meta.url), axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const artifacts = fileURLToPath(new URL("../../artifacts/data-display-fixes/", import.meta.url)); await mkdir(artifacts, { recursive: true });
const fixture = await startFixtureServer(), browser = await launchBrowser(fixture.base);
const report = { fixtureOnly: true, generatedAt: new Date().toISOString(), checks: [], axe: [], screenshots: [] };
const check = (label, value) => { assert.ok(value, label); report.checks.push(label); console.log(`PASS ${label}`); };
const control = async change => { const r = await fetch(`${fixture.base}/_fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }); assert.equal(r.status, 200); };
const text = () => browser.evaluate("document.body.innerText");
async function navigate(path, selector) { await browser.send("Page.navigate", { url: `${fixture.base}${path}` }); await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})`, `${path} mounted`); }
async function audit(label) {
  await browser.evaluate(axe);
  const violations = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
  report.axe.push({ label, violations }); check(`${label}: axe WCAG 2.2 AA`, violations.length === 0);
  check(`${label}: no page overflow`, await browser.evaluate("document.documentElement.scrollWidth<=innerWidth"));
}
async function screenshot(name, width) {
  const layout = await browser.send("Page.getLayoutMetrics"), shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(layout.cssContentSize.height), scale: 1 } });
  await writeFile(resolve(artifacts, name), Buffer.from(shot.data, "base64")); report.screenshots.push(name);
}
try {
  await control({ reset: true, backendScenario: "model_only" });
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.navigate", { url: `${fixture.base}/next` }); await browser.waitFor("document.querySelector('.briefing-page h1')", "briefing mounted");

  // Briefing: an empty array must not be read as "zero final candidates".
  await browser.waitFor("document.querySelector('[data-candidate-production=unproduced]')", "briefing unproduced notice");
  check("briefing says final candidates were not produced instead of 'none'", await browser.evaluate("document.querySelector('[data-candidate-production]').textContent.includes('뉴스 보정 최종 후보 미생성') && !document.body.innerText.includes('최종 후보가 없습니다.')"));
  check("briefing count is — and offers the whole-rank link", await browser.evaluate("document.querySelector('.briefing-count').textContent==='—' && document.querySelector('[data-candidate-production] a')?.getAttribute('href')==='/next/rank'"));
  check("connection notice shows model-only completion and no fabricated final candidates", await browser.evaluate("(()=>{const t=document.querySelector('.connection-notice').textContent;return t.includes('모델 분석 완료 · 뉴스 분석 미실행')&&t.includes('최종 후보: 뉴스 보정 최종 후보 미생성')})()"));
  await audit("briefing-model-only"); await screenshot("briefing-1440-dark.png", 1440);

  // Deep link: final membership stays unknown; raw model evidence remains evaluable.
  await navigate("/next?code=005930", "#briefing-detail [data-membership]");
  await browser.waitFor("document.querySelector('#briefing-detail [data-membership]').dataset.membership==='unknown'", "deeplink membership unknown");
  check("deep link is 'membership unknown', not 'non-candidate'", await browser.evaluate("!document.getElementById('briefing-detail').innerText.includes('최종 후보 외 종목') && document.getElementById('briefing-detail').innerText.includes('최종 후보 여부 미확인')"));
  check("deep link raw model signal is evaluated without claiming final membership", await browser.evaluate("document.querySelector('#briefing-detail .briefing-detail-signals [data-signal]').dataset.signal==='positive' && /%/.test(document.querySelector('.briefing-detail-stats dd').textContent)"));

  // Whole rank: filled from the model, membership unknown, news-adjusted values stay null.
  await navigate("/next/rank", ".rank-page h1");
  await browser.waitFor("document.querySelectorAll('[data-rank-code]').length===20 && !document.querySelector('[data-rank-code][data-membership=pending]')", "rank rows");
  check("rank table is filled with 199 model rows", await browser.evaluate("document.querySelector('.rank-section-heading h2').textContent.includes('199') && document.querySelectorAll('[data-rank-code]').length===20"));
  check("no rank row is claimed to be a non-candidate", await browser.evaluate("[...document.querySelectorAll('[data-rank-code]')].every(row=>row.dataset.membership==='unknown')"));
  check("available raw model values remain evaluable under unknown final membership", await browser.evaluate("document.querySelector('[data-rank-signal=model] [data-signal]').dataset.signal==='positive'"));
  check("raw model rank and prediction render", await browser.evaluate("document.querySelector('[data-rank-code=\"005930\"] [data-value=rank]').textContent==='5' && document.querySelector('[data-rank-code=\"005930\"] [data-value=predictedReturn]').textContent!=='—'"));
  check("news-adjusted rank and prediction stay empty (—), never filled from the model", await browser.evaluate("[...document.querySelectorAll('[data-rank-code]')].every(row=>row.querySelector('[data-value=finalRank]').textContent==='—' && row.querySelector('[data-value=finalPredictedReturn]').textContent==='—')"));
  check("rank page explains model-only state", (await text()).includes("모델 분석만 완료 · 뉴스 보정 최종 후보 미생성"));
  await audit("rank-model-only"); await screenshot("rank-1440-dark.png", 1440);

  // Watchlist: saved codes get raw model values, membership unknown.
  await browser.evaluate("localStorage.setItem('kospi-watchlist.v1', JSON.stringify(['005930','000660']))");
  await navigate("/next/watchlist", ".rank-page h1");
  await browser.waitFor("document.querySelectorAll('[data-rank-code]').length===2 && !document.querySelector('[data-rank-code][data-membership=pending]')", "watchlist rows");
  check("watchlist rows are unknown membership with raw model values and null final fields", await browser.evaluate("[...document.querySelectorAll('[data-rank-code]')].every(row=>row.dataset.membership==='unknown' && row.querySelector('[data-value=finalRank]').textContent==='—' && row.querySelector('[data-value=predictedReturn]').textContent!=='—')"));
  await audit("watchlist-model-only");

  // Report: raw prediction displayed, final fields absent, membership unknown.
  await navigate("/next/stock/005930", ".stock-report h1");
  await browser.waitFor("document.querySelector('.stock-report [data-membership]').dataset.membership==='unknown'", "report membership unknown");
  check("report keeps membership unknown with raw prediction and empty final fields", await browser.evaluate("(()=>{const t=document.querySelector('.stock-report [data-membership]').textContent;return t.includes('최종 후보 여부 미확인')&&!t.includes('최종 후보 외 종목')&&document.querySelector('[data-testid=report-prediction]').textContent!=='—'&&document.querySelector('[data-testid=report-final-prediction]').textContent==='—'&&document.querySelector('[data-testid=report-final-rank]').textContent.startsWith('—')})()"));
  check("report raw model signal is evaluated and news evidence is not fabricated", await browser.evaluate("document.querySelector('[data-report-signal=model] [data-signal]').dataset.signal==='positive' && document.querySelectorAll('.report-news li').length===0"));
  await audit("report-model-only");

  // History: a completed model-only run is not a completed news run, and [] is not "0 final candidates".
  await control({ analysis: "completed" });
  await navigate("/next/history", ".history-page h1");
  await browser.waitFor("document.querySelector('[data-testid=history-model-only]') && document.querySelector('[data-testid=history-candidate-count]').textContent==='미생성'", "history model-only");
  check("history shows model run completed, candidates unproduced, no official-performance claim", await browser.evaluate("(()=>{const t=document.querySelector('.history-page').innerText;return document.querySelector('[data-testid=history-status]').textContent==='모델 실행 완료'&&t.includes('공식 성과 기록이 아닙니다')&&!t.includes('현재 조회된 최종 후보가 없습니다.')&&!t.includes('최신 실행 완료')&&document.querySelector('.history-link[href=\"/next/rank\"]')!==null})()"));
  check("history stored-run card comes from the disk marker, labelled model-only, with the real rank count", await browser.evaluate("(()=>{const c=document.querySelector('[data-testid=history-saved-run]');return !!c&&c.querySelector('[data-testid=history-saved-mode]').textContent.includes('모델 전용')&&c.querySelector('[data-testid=history-saved-rank]').textContent.includes('199종목')&&c.innerText.includes('공식 / 수시 구분, 실행 식별자, 실현 성과는 제공되지 않습니다')})()"));
  await audit("history-model-only");
  check("numeric progress timestamp is shown", await browser.evaluate("document.querySelector('[data-testid=history-progress-updated]').textContent!=='미확인'"));
  check("unproduced final results have no fake saved timestamp", (await text()).includes("해당 없음 · 최종 후보 미생성"));
  check("successful analysis has no error", (await text()).includes("없음"));
  for (const width of [1440, 375]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    const gap = await browser.evaluate("document.querySelector('.history-criteria').getBoundingClientRect().top-document.querySelector('[data-testid=history-saved-run]').getBoundingClientRect().bottom");
    check(`history cards have 20px gap at ${width}px`, gap >= 20);
    await screenshot(`history-${width}.png`, width);
  }
  await control({ analysis: "idle" });

  // Full mode with a produced candidate list is unaffected.
  await control({ reset: true });
  await navigate("/next", ".briefing-page h1"); await browser.waitFor("document.querySelector('[data-candidate-code=\"005930\"]')", "populated candidates");
  check("produced candidate list still renders without any production notice", await browser.evaluate("!document.querySelector('[data-candidate-production]') && document.querySelectorAll('[data-candidate-code]').length===5"));

  // Empty list + a produced (full-mode) result is a genuine zero.
  await control({ reset: true, scenario: "empty", backendScenario: "empty" });
  await navigate("/next", ".briefing-page h1"); await browser.waitFor("document.querySelector('.briefing-empty')", "empty state");
  check("a produced empty list still says there are no final candidates", await browser.evaluate("document.querySelector('.briefing-empty').innerText.includes('최종 후보가 없습니다.') && !document.querySelector('[data-candidate-production]')"));

  // Status endpoint failure never upgrades an empty list to a confirmed zero.
  await control({ reset: true, scenario: "empty", backendScenario: "error" });
  await navigate("/next", ".briefing-page h1"); await browser.waitFor("document.querySelector('[data-candidate-production=unknown]')", "unknown production");
  check("status failure leaves the empty list unconfirmed", await browser.evaluate("!document.body.innerText.includes('최종 후보가 없습니다.')"));

  await browser.settleInterceptions();
  check("zero console.error and unhandled exceptions", !browser.consoleErrors.length && !browser.exceptions.length);
  const requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
  check("all product API calls are fixture GET, never an analysis POST", requests.every(r => r.method === "GET" && !r.blocked));
  check("analysis run endpoint was only read for status, never started", requests.filter(r => r.path === "/api/candidates/run").every(r => r.method === "GET"));
  check("zero external network/article visits", browser.blocked.length === 0); report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; console.error(error.message); process.exitCode = 1; }
finally {
  try { await browser.settleInterceptions(); }
  catch (error) { report.passed = false; report.diagnosticFailure = error.message; process.exitCode = 1; }
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked; report.clickDiagnostics = browser.clickDiagnostics;
  report.cancelledInterceptions = browser.cancelledInterceptions; report.interceptionErrors = browser.interceptionErrors;
  try {
    report.requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
    report.page = await browser.evaluate("({url:location.href,text:document.body.innerText})");
    if (!report.passed) { const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await writeFile(resolve(artifacts, "failure.png"), Buffer.from(shot.data, "base64")); report.failureScreenshot = "failure.png"; }
  } catch (error) { report.diagnosticFailure = error.message; }
  await writeFile(resolve(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(artifacts, "README.md"), "# model_only fixture 브라우저 검증\n\n모든 수치와 PNG는 검증용 fixture이며 model-only 실행 후 서버 상태(최종 후보 미생성, 뉴스 보정값 null)를 흉내 냅니다. FE에서 `npm run build` 후 `node scripts/verify/model-only-smoke.mjs`. 기존 Edge/Chrome과 자동 할당 localhost 포트만 사용하고 다른 CDP harness와 동시에 실행하지 마세요. 외부 네트워크와 제품 POST는 차단합니다. 실제 KIS/Gemini/모델 실행은 검증하지 않았습니다.\n");
  await browser.close(); await fixture.close(); console.log(`Artifacts: FE/artifacts/data-display-fixes/ · ${report.passed ? "ALL PASSED" : "FAILED"}`);
}
