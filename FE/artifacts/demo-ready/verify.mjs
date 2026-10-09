import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../../scripts/verify/cdp-browser.mjs";

const base = "http://127.0.0.1:5173", artifacts = fileURLToPath(new URL("./", import.meta.url));
const require = createRequire(import.meta.url), axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const report = { base, realData: true, generatedAt: new Date().toISOString(), checks: [], screenshots: [], audits: [] };
const check = (label, value) => { assert.ok(value, label); report.checks.push(label); console.log(`PASS ${label}`); };
const [rankResponse, statusResponse, candidateResponse] = await Promise.all(["/api/rank", "/api/backend/status", "/api/candidates"].map(path => fetch(`${base}${path}`)));
assert.ok([rankResponse, statusResponse, candidateResponse].every(response => response.ok));
const rank = await rankResponse.json(), status = await statusResponse.json(), candidates = await candidateResponse.json();
check("live model-only results are available, final candidates unproduced", status.analysisMode === "model_only" && status.results.rank.state === "available" && status.results.candidates.state === "not_produced" && candidates.length === 0);
const rawRank = row => Object.hasOwn(row.data_meta ?? {}, "rawModelRank") ? row.data_meta.rawModelRank : row.input_row.pred_rank;
const expected = rank.filter(row => Number.isInteger(Number(rawRank(row))) && Number(rawRank(row)) >= 1).sort((left, right) => Number(rawRank(left)) - Number(rawRank(right))).slice(0, 5);
report.rankCount = rank.length;
report.originalTopFive = expected.map(row => ({ code: row.input_row.ticker, rank: rawRank(row), pool: row.input_row.pred_pool_size, predictedReturn: row.input_row.ensemble_pred_return, baseDate: row.input_row.prediction_base_date, modelId: row.input_row.model_id }));
report.savedAt = status.results.rank.asOf;
const browser = await launchBrowser(base);
async function navigate(path, condition) {
  await browser.send("Page.navigate", { url: `${base}${path}` });
  await browser.waitFor(condition, path);
  await browser.evaluate("document.fonts.ready.then(()=>true)");
  await browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
}
async function audit(label) {
  check(`${label}: no page overflow`, await browser.evaluate("document.documentElement.scrollWidth<=innerWidth"));
  await browser.evaluate(axe);
  const violations = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
  report.audits.push({ label, violations }); check(`${label}: axe WCAG AA`, violations.length === 0);
}
async function screenshot(name, full = false) {
  const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full,
    ...(full ? { clip: { x: 0, y: 0, width: await browser.evaluate("innerWidth"), height: Math.ceil((await browser.send("Page.getLayoutMetrics")).cssContentSize.height), scale: 1 } } : {}) });
  await writeFile(`${artifacts}${name}`, Buffer.from(shot.data, "base64")); report.screenshots.push(name);
}
try {
  await browser.send("Network.setBlockedURLs", { urls: ["*/api/korean-market/dashboard*", "*/api/korean-market/refresh*"] });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('kospi-theme.v1','light');" });
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate("/", "document.querySelectorAll('[data-model-code]').length===5 && document.querySelector('.connection-notice-heading').textContent.includes('모델 결과 저장됨')");
  check("briefing displays original Top-5, unchanged ranks and pool", await browser.evaluate(`JSON.stringify([...document.querySelectorAll('[data-model-code]')].map(row=>({code:row.dataset.modelCode,rank:row.querySelector('[data-value=rank]').textContent})))===${JSON.stringify(JSON.stringify(expected.map(row => ({ code: row.input_row.ticker, rank: `${rawRank(row)}/${row.input_row.pred_pool_size}` }))))}`));
  check("normal connection details are collapsed", await browser.evaluate("!document.querySelector('.connection-disclosure').open"));
  check("briefing uses rank source and base date", await browser.evaluate("document.querySelector('.briefing-result-meta').innerText.includes('2026. 10. 08.') && document.querySelector('.briefing-result-meta').innerText.includes('저장 시각')"));
  await audit("briefing-1440-light"); await screenshot("briefing-1440-light-start.png"); await screenshot("briefing-1440-light-full.png", true);
  await browser.evaluate("window.scrollTo({top:document.querySelector('[aria-labelledby=candidate-heading]').getBoundingClientRect().top+scrollY-84,behavior:'instant'})");
  await screenshot("briefing-1440-light.png");
  await navigate("/rank", "document.querySelectorAll('[data-rank-code]').length===20 && document.querySelector('[data-candidate-production=unproduced]')");
  check("rank hides unused columns, membership labels and filter", await browser.evaluate("!document.querySelector('[data-value=finalRank], [data-value=finalPredictedReturn], [data-rank-signal=news], option[value=candidate]') && !document.querySelector('.rank-table').innerText.includes('최종 후보 미확인')"));
  check("rank preserves real population", await browser.evaluate(`document.querySelector('.rank-section-heading h2').textContent.includes('${rank.length}종목')`));
  await audit("rank-1440-light"); await screenshot("rank-1440-light.png");
  await navigate("/about", "document.querySelector('.about-grid')?.innerText.includes('seed 42·43·44')");
  check("about explains feature count and Top-5 selection", await browser.evaluate("document.querySelector('.about-grid').innerText.includes('OHLCV 파생 5개, RSI 1개, MACD 2개, 볼린저 밴드 3개') && document.querySelector('.about-grid').innerText.includes('상위 5종목을 선정')"));
  await audit("about-1440-light"); await screenshot("about-1440-light.png");
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate("/", "document.querySelectorAll('[data-model-code]').length===5");
  check("mobile Top-5 fits without table overflow", await browser.evaluate("document.querySelector('.briefing-model-table').getBoundingClientRect().width<=document.querySelector('.briefing-table-scroll').clientWidth"));
  await audit("briefing-375-light"); await screenshot("briefing-375-light-start.png"); await screenshot("briefing-375-light-full.png", true);
  await browser.evaluate("window.scrollTo({top:document.querySelector('[aria-labelledby=candidate-heading]').getBoundingClientRect().top+scrollY-84,behavior:'instant'})");
  await screenshot("briefing-375-light.png");
  await browser.click('[data-model-code] a');
  await browser.waitFor(`location.pathname==='/stock/${expected[0].input_row.ticker}' && document.querySelector('.stock-report h1')`, "Top-5 opens stock report");
  check("native Top-5 link opens stock report", true);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('kospi-theme.v1','dark');" });
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const [path, selector] of [["/", "document.querySelectorAll('[data-model-code]').length===5"], ["/rank", "document.querySelector('[data-candidate-production=unproduced]')"], ["/about", "document.querySelector('.about-grid')"]]) { await navigate(path, selector); await audit(`${path}-1440-dark`); }
  const aboutHtml = await readFile(new URL("../../dist/about/index.html", import.meta.url), "utf8");
  check("built static about HTML contains shared model summary and features", aboutHtml.includes("seed 42·43·44") && aboutHtml.includes("OHLCV 파생 5개") && aboutHtml.includes("상위 5종목을 선정"));
  await browser.settleInterceptions();
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked;
  check("console error count is zero", browser.consoleErrors.length === 0);
  check("runtime exception count is zero", browser.exceptions.length === 0);
  check("no non-GET or external network requests attempted", browser.blocked.length === 0);
} catch (error) {
  report.failure = error.stack; report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions;
  await screenshot("failure.png"); throw error;
} finally {
  await writeFile(`${artifacts}verification.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
