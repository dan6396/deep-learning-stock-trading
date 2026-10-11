// Product requests stay on localhost; this does not start analysis or call a news provider.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startFixtureServer, candidateFixture, fixtureCodes } from "./fixture-server.mjs";
import { launchBrowser } from "./cdp-browser.mjs";

const artifacts = fileURLToPath(new URL("../../artifacts/top-five/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const require = createRequire(import.meta.url), axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const fixture = await startFixtureServer(), browser = await launchBrowser(fixture.base);
const report = { fixtureOnly: true, checks: [], screenshots: [], axe: [], storedRank: null };
const check = (label, condition) => { assert.ok(condition, label); report.checks.push(label); console.log(`PASS ${label}`); };
async function control(change) {
  const response = await fetch(`${fixture.base}/_fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
  assert.equal(response.status, 200);
}
async function navigate(path = "/next") {
  await browser.send("Page.navigate", { url: `${fixture.base}${path}` });
  await browser.waitFor("document.querySelector('.briefing-dashboard') && document.querySelector('#main-content')?.dataset.routePath===location.pathname", "briefing mounted");
}
async function capture(name, width, theme) {
  await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}; window.scrollTo(0,0)`);
  await browser.waitFor("document.fonts.status==='loaded'", "fonts ready");
  check(`${name}: no horizontal page overflow`, await browser.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
  await browser.evaluate(axe);
  const violations = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(result=>result.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})))");
  report.axe.push({ name, violations });
  await writeFile(`${artifacts}browser-report.json`, JSON.stringify(report, null, 2));
  if (violations.length) console.log(JSON.stringify(violations));
  check(`${name}: automated accessibility`, violations.length === 0);
  const metrics = await browser.send("Page.getLayoutMetrics");
  const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
  await writeFile(`${artifacts}${name}.png`, Buffer.from(shot.data, "base64")); report.screenshots.push(`${name}.png`);
}

try {
  const rows = fixtureCodes.map((code, index) => {
    const row = candidateFixture(code);
    row.input_row.pred_rank = index + 1; row.input_row.ensemble_pred_return = [.0312, .025, .01, 0, null][index];
    row.input_row.final_pred_return = null; row.data_meta.source = "sample";
    row.data_meta.newsStatus = index === 1 ? "collection_failed" : index === 3 ? "not_collected" : "collected";
    row.data_meta.newsCollected = row.data_meta.newsStatus === "collected";
    row.data_meta.newsMethod = "unknown"; row.data_meta.newsTally = null;
    row.news = index === 0 || index === 4 ? [{ index: 1, title: `${row.result.company_name} 실적 발표`, source: "검증용 매체", pub_date: "2026-10-10T10:30:00Z", url: "https://news.google.com/rss/articles/fixture" }] : [];
    return row;
  });
  rows[3].input_row.prediction_target = "unknown";
  await control({ rankRows: rows, backendScenario: "model_only", quoteFail: true });
  await navigate(); await browser.waitFor("document.querySelectorAll('[data-model-code]').length===5", "five rows");
  check("raw rank selects five stocks", await browser.evaluate("[...document.querySelectorAll('[data-model-code]')].map(el=>el.dataset.modelCode).join(',')==='005930,000660,267250,035420,005380'"));
  check("fraction mapping, missing value and unknown period", await browser.evaluate("document.querySelector('[data-model-code=\"267250\"] .briefing-top-prediction').innerText.includes('+1.00%') && document.querySelector('[data-model-code=\"005380\"] .briefing-top-prediction').innerText.includes('원본 예측값 없음') && document.querySelector('[data-model-code=\"035420\"] .briefing-top-prediction').innerText.includes('예측 기간 미확인')"));
  check("collection failure, successful zero and no cache are distinct", await browser.evaluate("document.querySelector('[data-model-code=\"000660\"]').innerText.includes('기사 수집 실패') && document.querySelector('[data-model-code=\"267250\"]').innerText.includes('관련 기사 0건') && document.querySelector('[data-model-code=\"035420\"]').innerText.includes('기사 수집 기록 없음')"));
  check("publisher, timestamp, safe article link and Google intermediary are visible", await browser.evaluate("document.querySelector('[data-model-code=\"005930\"] .briefing-related-news').innerText.includes('검증용 매체') && document.querySelector('[data-model-code=\"005930\"] .briefing-related-news').innerText.includes('19:30') && document.querySelector('[data-model-code=\"005930\"] .briefing-related-news').innerText.includes('Google News 경유') && document.querySelector('[data-model-code=\"005930\"] .briefing-related-news a').rel.includes('noopener')"));
  await capture("briefing-1440-dark", 1440, "dark");
  await capture("briefing-375-light", 375, "light");
  await browser.click('[data-model-code="005930"] [data-watch-code]');
  check("watchlist remains usable", await browser.evaluate("localStorage.getItem('kospi-watchlist.v1').includes('005930')"));
  await browser.click('[data-model-code="000660"] .briefing-stock-button');
  await browser.waitFor("document.querySelector('#briefing-detail').dataset.detailCode==='000660'", "selection works");
  await browser.click(".ds-analysis-trigger");
  await browser.waitFor("document.querySelector('dialog[open]')", "analysis dialog open");
  check("analysis dialog has no news/Gemini mode options", await browser.evaluate("!document.querySelector('dialog input[type=radio]') && !document.querySelector('dialog').innerText.includes('Gemini') && document.querySelector('dialog').innerText.includes('관련 기사를 수집')"));
  await browser.click('button[aria-label="분석 실행 대화상자 닫기"]');
  const requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
  check("briefing performs no candidate fetch or news-analysis launch", !requests.some(request => request.path === "/api/candidates" || request.path === "/api/stock-analysis/run" || request.method === "POST"));
  // An actual local read-only API snapshot is kept separate from the sample rows above.
  const stored = JSON.parse(await readFile(`${artifacts}stored-rank.json`, "utf8"));
  report.storedRank = { rows: stored.length, source: "read-only localhost /api/rank snapshot" };
  await control({ rankRows: stored }); await navigate();
  if (!stored.length) await browser.waitFor("document.querySelector('.briefing-empty')?.innerText.includes('표시할 모델 예측이 없습니다')", "honest empty stored result");
  await capture("stored-result-1440-light", 1440, "light");
  await browser.settleInterceptions();
  check("browser has no script exceptions", browser.exceptions.length === 0);
  report.exceptions = browser.exceptions; report.consoleErrors = browser.consoleErrors;
  await writeFile(`${artifacts}browser-report.json`, JSON.stringify(report, null, 2));
} finally { await browser.close(); await fixture.close(); }
