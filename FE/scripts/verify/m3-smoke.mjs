// FE: npm run build, then node scripts/verify/m3-smoke.mjs
// Existing Edge/Chrome; dist + localhost fixture APIs only. No article visits.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser, pause } from "./cdp-browser.mjs";

const require = createRequire(import.meta.url), axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const artifacts = fileURLToPath(new URL("../../artifacts/m3/", import.meta.url)); await mkdir(artifacts, { recursive: true });
const fixture = await startFixtureServer(), browser = await launchBrowser(fixture.base);
const report = { fixtureOnly: true, generatedAt: new Date().toISOString(), checks: [], axe: [], screenshots: [] };
const control = async change => { const response = await fetch(`${fixture.base}/_fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }); assert.equal(response.status, 200); };
const check = (label, value) => { assert.ok(value, label); report.checks.push(label); console.log(`PASS ${label}`); };
const text = () => browser.evaluate("document.querySelector('.stock-report')?.innerText ?? ''");
const button = async (group, label) => { const index = await browser.evaluate(`[...document.querySelectorAll(${JSON.stringify(group + " button")})].findIndex(el=>el.textContent===${JSON.stringify(label)})`); assert.ok(index >= 0); await browser.click(`${group} button:nth-child(${index + 1})`); };
async function navigate(path = "/next/stock/005930") { await browser.send("Page.navigate", { url: `${fixture.base}${path}` }); await browser.waitFor("document.querySelector('.stock-report h1')", "report mounted"); }
async function loaded(code = "005930") { await browser.waitFor(`document.querySelector('[data-report-code="${code}"]') && document.querySelector('[data-chart-code="${code}"]') && document.querySelector('[data-testid=report-price]')?.textContent !== '—' && document.querySelector('[data-membership]')?.dataset.membership !== 'pending'`, `populated ${code}`); }
async function audit(label) {
  await browser.evaluate(axe);
  const violations = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))");
  report.axe.push({ label, violations }); check(`${label}: populated axe WCAG 2.2 AA`, violations.length === 0);
  check(`${label}: no page overflow`, await browser.evaluate("document.documentElement.scrollWidth<=innerWidth"));
  const targets = await browser.evaluate("[...document.querySelectorAll('a[href],button,input,select,[tabindex=\"0\"]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<24||r.height<24)&&!(el.tagName==='A'&&getComputedStyle(el).display==='inline')}).map(el=>el.outerHTML)");
  check(`${label}: pointer targets at least 24px`, targets.length === 0);
  const headings = await browser.evaluate("[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(el=>el.getClientRects().length).map(el=>Number(el.tagName[1]))");
  check(`${label}: single first h1 and no skipped levels`, headings[0] === 1 && headings.filter(level => level === 1).length === 1 && !headings.some((level, i) => i > 0 && level > headings[i - 1] + 1));
}

try {
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.navigate", { url: `${fixture.base}/next?code=005930` });
  await browser.waitFor("document.querySelector('.briefing-report-link')", "briefing detail ready");
  check("briefing report link targets new route", await browser.evaluate("document.querySelector('.briefing-report-link').getAttribute('href')==='/next/stock/005930'"));
  await browser.click('.briefing-report-link'); await loaded();
  await browser.waitFor("document.activeElement.id==='main-content'", "report route main focused");
  check("briefing-to-report navigation focuses mounted main", await browser.evaluate("document.activeElement.dataset.routePath==='/next/stock/005930'"));
  check("report and briefing authoritative model/final rank agree", await browser.evaluate("document.querySelector('[data-testid=report-prediction]').textContent==='+3.12%' && document.querySelector('[data-testid=report-final-rank]').textContent==='1위' && document.querySelector('[data-report-signal=model] [data-signal]').dataset.signal==='positive'"));
  check("report does not expose analysis execution UI", !(await text()).includes("분석 실행"));
  await browser.send("Page.reload", { ignoreCache: true }); await loaded(); check("deeplink survives reload", await browser.evaluate("location.pathname==='/next/stock/005930'"));
  await browser.click('.report-back'); await browser.waitFor("document.querySelector('[data-detail-code=\"005930\"]')", "return briefing selection");
  check("return link preserves briefing selected code", await browser.evaluate("location.search==='?code=005930'"));
  await browser.evaluate("history.back()"); await loaded(); check("browser back restores report", await browser.evaluate("location.pathname==='/next/stock/005930'"));

  // All three old stock resources remain delayed while the actual UI selects B.
  await control({ reset: true, stockDelays: { "005930": 1800 }, quoteDelays: { "005930": 1800 }, chartDelays: { "005930": 1800 } });
  await navigate(); await browser.waitFor("document.querySelector('[data-report-code]')", "A mount"); await pause(150);
  await browser.click('.report-back'); await browser.waitFor("document.querySelector('[data-candidate-code=\"000660\"] button')", "B candidate");
  await browser.click('[data-candidate-code="000660"] button');
  const bPanel = '[data-detail-code="000660"]', bLink = `${bPanel} .briefing-report-link`;
  await browser.waitFor(`document.querySelector(${JSON.stringify(bPanel)})?.querySelector('h2')?.textContent==='SK하이닉스' && document.querySelector(${JSON.stringify(bLink)})?.getAttribute('href')==='/next/stock/000660' && location.search==='?code=000660'`, "B panel and exact report link ready");
  check("rapid selection has B panel and matching report href before mouse click", await browser.evaluate(`document.querySelector(${JSON.stringify(bLink)}).getAttribute('href')==='/next/stock/000660'`));
  await browser.click(bLink);
  await browser.waitFor("location.pathname==='/next/stock/000660'", "trusted B report click navigates");
  await loaded("000660"); await pause(1900);
  check("late A stock/quote/chart never replace B after real selection", await browser.evaluate("document.querySelector('.stock-report h1').textContent==='SK하이닉스' && document.querySelector('[data-testid=report-price]').textContent==='189,500원' && document.querySelector('[data-chart-code]').dataset.chartCode==='000660' && !document.querySelector('.stock-report').innerText.includes('삼성전자')"));

  await control({ reset: true }); await navigate(); await loaded();
  await control({ chartDelayQueue: [1600, 0] }); await button('[aria-label="가격 이력 기간"]', "1개월");
  await browser.waitFor("document.querySelector('.report-chart').innerText.includes('선택한 기간의 가격 이력을 조회')", "range pending clears old plot");
  check("range pending has no old plot", await browser.evaluate("!document.querySelector('[data-chart-range]')"));
  await button('[aria-label="가격 이력 기간"]', "3개월"); await browser.waitFor("document.querySelector('[data-chart-range]')?.dataset.chartRange==='3M'", "new range ready"); await pause(1700);
  check("late range response cannot overwrite selected range", await browser.evaluate("document.querySelector('[data-chart-range]').dataset.chartRange==='3M'"));
  await button('[aria-label="차트 표시 방식"]', "캔들"); await browser.waitFor("document.querySelector('[data-chart-mode]')?.dataset.chartMode==='candle'", "candle mode");
  check("raw OHLC permits accessible candle mode", await browser.evaluate("document.querySelector('.report-plot svg').getAttribute('aria-label').includes('캔들')"));
  const beforeExplore = await browser.evaluate("document.querySelector('.report-chart-explore p').textContent");
  await browser.click('button[aria-label="다음 가격 관측"]');
  await browser.waitFor(`document.querySelector('.report-chart-explore p').textContent!==${JSON.stringify(beforeExplore)}`, "pointer advances observation");
  const afterClickExplore = await browser.evaluate("document.querySelector('.report-chart-explore p').textContent");
  await browser.key("ArrowRight");
  await browser.waitFor(`document.querySelector('.report-chart-explore p').textContent!==${JSON.stringify(afterClickExplore)}`, "ArrowRight advances observation");
  const afterKeyExplore = await browser.evaluate("document.querySelector('.report-chart-explore p').textContent");
  report.exploration = { before: beforeExplore, afterClick: afterClickExplore, afterKey: afterKeyExplore };
  check("price exploration is keyboard operable", afterKeyExplore !== afterClickExplore && afterClickExplore !== beforeExplore && afterKeyExplore.includes("시가"));

  await control({ reset: true, candidatesDelayMs: 1600 }); await navigate();
  await browser.waitFor("document.querySelector('[data-report-signal=model] [data-signal]')", "stock loaded before candidates");
  check("pending membership does not invent non-candidate/model signal", await browser.evaluate("document.querySelector('[data-membership]').dataset.membership==='pending' && document.querySelector('[data-report-signal=model] [data-signal]').dataset.signal==='unavailable'")); await loaded();
  await control({ scenario: "error", candidatesDelayMs: 0 }); await browser.click('.report-title-row button'); await browser.waitFor("document.querySelector('[data-membership]').dataset.membership==='unknown'", "membership error");
  check("previous candidate data stays explicitly unconfirmed on error", (await text()).includes("이전 조회 결과 · 후보 갱신 실패") && await browser.evaluate("document.querySelector('[data-report-signal=model] [data-signal]').dataset.signal==='unavailable'"));
  await control({ scenario: "empty" }); await browser.click('.report-title-row button'); await browser.waitFor("document.querySelector('[data-membership]').dataset.membership==='nonCandidate'", "successful non-member"); check("successful [] confirms true non-membership", (await text()).includes("최종 후보 외 종목"));
  await control({ reset: true, negativeCandidate: true }); await navigate(); await loaded(); check("negative candidate keeps membership-positive model and blue numeric tone", await browser.evaluate("document.querySelector('[data-testid=report-prediction]').textContent==='-2.00%' && document.querySelector('[data-testid=report-prediction]').classList.contains('report-fall') && document.querySelector('[data-report-signal=model] [data-signal]').dataset.signal==='positive'"));

  await control({ reset: true, scenario: "empty", stockScenario: "null", quoteScenario: "missing" }); await navigate();
  await browser.waitFor("document.querySelector('.stock-report').innerText.includes('상세 분석 결과가 없습니다.')", "stock null");
  check("null analysis/quote preserves missing values", await browser.evaluate("document.querySelector('[data-testid=report-prediction]').textContent==='—' && document.querySelector('[data-testid=report-price]').textContent==='—'"));
  for (const scenario of ["error", "mismatch", "sample"]) {
    await control({ reset: true, scenario: "empty", stockScenario: scenario }); await navigate();
    const message = scenario === "sample" ? "예시 분석 응답은 제공하지 않습니다" : scenario === "mismatch" ? "종목 코드가 일치하지 않아 분석 응답" : "종목 분석 조회 실패";
    await browser.waitFor(`document.querySelector('.stock-report').innerText.includes(${JSON.stringify(message)})`, `stock ${scenario}`);
    check(`stock ${scenario} rejects response without prediction fabrication`, await browser.evaluate("document.querySelector('[data-testid=report-prediction]').textContent==='—'"));
  }
  await control({ reset: true }); await navigate(); await loaded(); await control({ stockScenario: "error", quoteFail: true }); await browser.click('.report-title-row button');
  await browser.waitFor("document.querySelector('.stock-report').innerText.includes('이전 조회 결과 · 분석 갱신 실패') && document.querySelector('.stock-report').innerText.includes('이전 조회 결과 · 시세 갱신 실패')", "cached failures");
  check("background error retains prior results with warnings", await browser.evaluate("document.querySelector('[data-testid=report-price]').textContent==='74,200원'"));

  for (const scenario of ["empty", "sample", "unknown", "mismatch", "error", "missingTime"]) {
    await control({ reset: true, chartScenario: scenario }); await navigate();
    const message = scenario === "sample" ? "예시 데이터이므로" : scenario === "unknown" ? "가격 이력 출처 미확인" : scenario === "mismatch" ? "종목 코드가 일치하지 않아 가격 이력" : scenario === "error" ? "가격 이력 조회 실패" : "유효한 관측 시각과 가격이 없습니다";
    await browser.waitFor(`document.querySelector('.report-chart').innerText.includes(${JSON.stringify(message)})`, `chart ${scenario}`);
    check(`chart ${scenario} never fabricates observed history`, await browser.evaluate("!document.querySelector('.report-plot svg')"));
  }
  await control({ reset: true, chartScenario: "old" }); await navigate(); await loaded(); await button('[aria-label="차트 표시 방식"]', "캔들");
  await browser.waitFor("document.querySelector('.report-chart').innerText.includes('원본 시각·시가·고가·저가·종가')", "old OHLC no candles"); check("legacy OHLC replacements cannot become verified candles", await browser.evaluate("!document.querySelector('.report-plot svg')"));
  await control({ reset: true, chartScenario: "invalid" }); await navigate(); await loaded();
  check("server-preserved raw price gap produces two disconnected paths", await browser.evaluate("document.querySelectorAll('.report-plot > svg path').length===2 && document.querySelector('.report-chart').innerText.includes('종가 1개')"));
  await control({ chartScenario: "error" }); await browser.click('button[aria-label="가격 이력 다시 조회"]'); await browser.waitFor("document.querySelector('.report-chart').innerText.includes('이전 조회 결과 · 가격 이력 갱신 실패')", "chart background failure"); check("chart background failure is explicitly stale", await browser.evaluate("document.querySelector('[data-chart-code]').dataset.chartCode==='005930'"));

  await control({ reset: true, stockScenario: "newsUnknown" }); await navigate(); await loaded();
  check("unclear article keeps original reason and safe text-only URL", (await text()).includes("감성 미확인") && (await text()).includes("원본 unclear 판정 근거") && await browser.evaluate("!document.querySelector('.report-news a[href^=\"javascript:\"]') && document.querySelector('[data-report-signal=news] [data-signal]').dataset.signal==='unavailable'"));
  await control({ reset: true }); await navigate("/next/stock/005380"); await loaded("005380");
  check("missing prediction has no fabricated summary or final rank", await browser.evaluate("document.querySelector('[data-testid=report-prediction]').textContent==='—' && document.querySelector('[data-testid=report-final-rank]').textContent.includes('원본 미제공') && !document.querySelector('.stock-report').innerText.includes('Huber 예상수익률 0.00%')"));
  const beforeInvalid = (await (await fetch(`${fixture.base}/_fixture/requests`)).json()).length; await navigate("/next/stock/garbage"); await pause(250);
  // The shared AppShell ConnectionNotice legitimately reads GET /api/backend/status on every page load; no stock-scoped or non-GET request is allowed.
  const invalidRequests = (await (await fetch(`${fixture.base}/_fixture/requests`)).json()).slice(beforeInvalid);
  check("invalid code shows validation with no stock API requests (shared status GET only)", invalidRequests.every(request => request.method === "GET" && !request.blocked && request.path === "/api/backend/status") && (await text()).includes("유효한 6자리 종목 코드"));

  await control({ reset: true });
  for (const width of [1440, 1280]) for (const theme of ["dark", "light"]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate(`localStorage.setItem('kospi-theme.v1',${JSON.stringify(theme)})`); await navigate(); await loaded(); await browser.evaluate("document.fonts.ready"); await audit(`${width}-${theme}`);
    const links = await browser.evaluate("[...document.querySelectorAll('.report-news a')].every(el=>/^https?:/.test(el.href)&&el.rel==='noopener noreferrer')"); check(`${width}-${theme}: safe original article link attributes`, links);
    const layout = await browser.send("Page.getLayoutMetrics"), capture = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(layout.cssContentSize.height), scale: 1 } });
    const name = `m3-${width}-${theme}.png`; await writeFile(resolve(artifacts, name), Buffer.from(capture.data, "base64")); report.screenshots.push({ name, width, theme, fixture: true });
  }
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 1, mobile: false }); await navigate(); await loaded(); await audit("375-light-stacked");
  await browser.settleInterceptions();
  check("zero console.error/unhandled exceptions", !browser.consoleErrors.length && !browser.exceptions.length);
  const requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json(); check("every product API call is a fixture GET", requests.every(request => request.method === "GET" && !request.blocked));
  check("no external article/API/network visits", browser.blocked.length === 0); report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; console.error(error.message); process.exitCode = 1; }
finally {
  try { await browser.settleInterceptions(); }
  catch (error) { report.passed = false; report.diagnosticFailure = error.message; process.exitCode = 1; }
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked; report.clickDiagnostics = browser.clickDiagnostics;
  report.cancelledInterceptions = browser.cancelledInterceptions; report.interceptionErrors = browser.interceptionErrors;
  try {
    report.requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
    report.page = await browser.evaluate("({url:location.href,reportCode:document.querySelector('[data-report-code]')?.dataset.reportCode,range:document.querySelector('[data-chart-range]')?.dataset.chartRange,activeElement:document.activeElement?.outerHTML,text:document.body.innerText})");
    if (!report.passed) { const capture = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await writeFile(resolve(artifacts, "failure.png"), Buffer.from(capture.data, "base64")); report.failureScreenshot = "failure.png"; }
  } catch (error) { report.diagnosticFailure = error.message; }
  await writeFile(resolve(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(artifacts, "README.md"), "# M3 fixture 브라우저 검증\n\n모든 데이터와 PNG는 localhost 검증용 fixture입니다. 실제 시장·KIS·Vercel·유료 분석을 검증하지 않았습니다. 외부 네트워크/제품 POST는 차단되며 기사는 방문하지 않습니다.\n\nFE에서 `npm run build` 후 `node scripts/verify/m3-smoke.mjs`. 기존 Edge/Chrome과 자동 할당 localhost 포트를 사용합니다. 동일 harness를 동시에 실행하지 마세요. 실패 시 report.json의 실제 요청/콘솔/포커스와 failure.png를 확인하세요.\n");
  await browser.close(); await fixture.close(); console.log(`Artifacts: FE/artifacts/m3/ · ${report.passed ? "ALL PASSED" : "FAILED"}`);
}
