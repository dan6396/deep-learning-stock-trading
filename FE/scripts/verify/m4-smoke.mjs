// FE: npm run build, then node scripts/verify/m4-smoke.mjs. Run harnesses sequentially.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser, pause } from "./cdp-browser.mjs";

const require = createRequire(import.meta.url), axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const artifacts = fileURLToPath(new URL("../../artifacts/m4/", import.meta.url)); await mkdir(artifacts, { recursive: true });
const fixture = await startFixtureServer(), browser = await launchBrowser(fixture.base);
const report = { fixtureOnly: true, generatedAt: new Date().toISOString(), checks: [], axe: [], screenshots: [] };
const check = (label, value) => { assert.ok(value, label); report.checks.push(label); console.log(`PASS ${label}`); };
const control = async change => { const r = await fetch(`${fixture.base}/_fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }); assert.equal(r.status, 200); };
const bodyText = () => browser.evaluate("document.body.innerText");
const rankReady = () => browser.waitFor("document.querySelectorAll('[data-rank-code]').length===20 && document.querySelector('.rank-section-heading h2').textContent.includes('199') && !document.querySelector('[data-rank-code][data-membership=pending]')", "199-row rank ready");
async function navigate(path, selector = ".rank-page h1") { await browser.send("Page.navigate", { url: `${fixture.base}${path}` }); await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})`, `${path} mounted`); }
async function keyboard(key, code, virtual, modifiers = 0) { for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers }); }
async function fill(selector, value) {
  await browser.click(selector); await keyboard("a", "KeyA", 65, 2);
  if (value) await browser.send("Input.insertText", { text: value }); else await keyboard("Backspace", "Backspace", 8);
}
async function setFilter(value) {
  const options = ["all", "candidate", "positive", "negative", "missing"], index = options.indexOf(value); assert.ok(index >= 0);
  await browser.evaluate("document.querySelector('.rank-filter select').focus()");
  await browser.key("Home"); for (let i = 0; i < index; i++) await browser.key("ArrowDown"); await browser.key("Enter");
  await browser.waitFor(`document.querySelector('.rank-filter select').value===${JSON.stringify(value)}`, `filter ${value}`);
}
async function collectPages() {
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    await browser.waitFor(`document.querySelector('.rank-pagination span').textContent.startsWith('${page} /')`, `rank page ${page}`);
    rows.push(...await browser.evaluate("[...document.querySelectorAll('[data-rank-code]')].map(row=>({code:row.dataset.rankCode,value:row.querySelector('[data-value=predictedReturn]').textContent}))"));
    if (page < 10) await browser.click('button[aria-label="다음 순위 페이지"]');
  }
  for (let page = 9; page >= 1; page--) { await browser.click('button[aria-label="이전 순위 페이지"]'); await browser.waitFor(`document.querySelector('.rank-pagination span').textContent.startsWith('${page} /')`, `return page ${page}`); }
  return rows;
}
function sortedWithMissingLast(rows, descending) {
  const values = rows.map(row => row.value === "—" ? null : Number(row.value.replace(/[%+,]/g, "")));
  let missing = false;
  return values.every((value, i) => { if (value === null) { missing = true; return true; } return !missing && Number.isFinite(value) && (i === 0 || values[i - 1] === null || (descending ? values[i - 1] >= value : values[i - 1] <= value)); });
}
async function audit(label) {
  await browser.evaluate(axe);
  const violations = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
  report.axe.push({ label, violations }); check(`${label}: populated axe WCAG 2.2 AA`, violations.length === 0);
  check(`${label}: no page overflow`, await browser.evaluate("document.documentElement.scrollWidth<=innerWidth"));
  const targets = await browser.evaluate("[...document.querySelectorAll('a[href],button,input,select,[tabindex=\"0\"]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<24||r.height<24)&&!(el.tagName==='A'&&getComputedStyle(el).display==='inline')}).map(el=>el.outerHTML)");
  check(`${label}: pointer targets at least 24px`, targets.length === 0);
  check(`${label}: single first h1 and no skipped headings`, await browser.evaluate("(()=>{const h=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(el=>el.getClientRects().length).map(el=>Number(el.tagName[1]));return h[0]===1&&h.filter(n=>n===1).length===1&&!h.some((n,i)=>i>0&&n>h[i-1]+1)})()"));
}
async function screenshot(name, width) {
  const layout = await browser.send("Page.getLayoutMetrics"), shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(layout.cssContentSize.height), scale: 1 } });
  await writeFile(resolve(artifacts, name), Buffer.from(shot.data, "base64")); report.screenshots.push(name);
}
async function otherTabStorage(codes, expected, clear = false) {
  const { targetId } = await browser.send("Target.createTarget", { url: `${fixture.base}/_fixture/watchlist-write?value=${encodeURIComponent(JSON.stringify(codes))}${clear ? "&clear=1" : ""}`, background: true });
  try { await browser.waitFor(expected, "real cross-tab storage event"); }
  finally { await browser.send("Target.closeTarget", { targetId }); await browser.send("Page.bringToFront"); }
}
try {
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate("/rank"); await rankReady();
  check("whole rank has 199 records paginated in 20-row native table", await browser.evaluate("document.querySelectorAll('[data-rank-code]').length===20 && document.querySelector('.rank-pagination span').textContent.includes('/ 10페이지') && document.querySelector('.rank-table-scroll').getAttribute('role')==='region'"));
  check("original model rank starts ascending without fabricated screen rank", await browser.evaluate("document.querySelector('th[aria-sort=ascending] button').dataset.sort==='rank' && document.querySelector('[data-rank-code=\"005930\"] [data-value=rank]').textContent==='5' && document.querySelector('[data-rank-code=\"005930\"] [data-value=finalRank]').textContent==='1'"));
  await browser.click('button[data-sort="predictedReturn"]');
  check("first prediction sort is descending and aria-sort matches", await browser.evaluate("document.querySelector('th[aria-sort=descending] button').dataset.sort==='predictedReturn'"));
  const descending = await collectPages(); check("all 199 descending values keep measured zero/negative and missing last", descending.length === 199 && new Set(descending.map(row => row.code)).size === 199 && sortedWithMissingLast(descending, true) && descending.some(row => row.value === "0.00%") && descending.some(row => row.value.startsWith("-")));
  await browser.click('button[data-sort="predictedReturn"]'); const ascending = await collectPages(); check("all 199 ascending values keep missing last", sortedWithMissingLast(ascending, false) && ascending.length === 199);
  report.sort = { descending, ascending };
  await fill('.rank-search input', "100194"); await browser.waitFor("document.querySelectorAll('[data-rank-code]').length===1", "non-candidate full-universe search");
  check("rank search includes a stock outside five final candidates", await browser.evaluate("document.querySelector('[data-rank-code]').dataset.rankCode==='100194' && document.querySelector('[data-rank-code] a').getAttribute('href')==='/stock/100194'"));
  await fill('.rank-search input', ""); await setFilter("negative");
  check("0-or-negative filter includes actual zero and excludes missing", await browser.evaluate("document.querySelector('[data-rank-code=\"100001\"] [data-value=predictedReturn]').textContent==='0.00%' && !document.querySelector('[data-rank-code=\"100003\"]')"));
  await setFilter("candidate"); check("candidate filter is exactly five confirmed members", await browser.evaluate("document.querySelectorAll('[data-rank-code]').length===5")); await setFilter("all");
  await fill('.rank-search input', "100004");
  check("non-candidate actual LLM news is retained instead of labelled unanalysed", await browser.evaluate("document.querySelector('[data-rank-code=\"100004\"]').dataset.membership==='nonCandidate' && document.querySelector('[data-rank-code=\"100004\"] [data-rank-signal=news] [data-signal]').dataset.signal==='positive' && !document.querySelector('[data-rank-code=\"100004\"] [data-rank-signal=news]').textContent.includes('미분석')"));
  await navigate("/watchlist"); check("absent watchlist never seeds sample/default codes", (await bodyText()).includes("아직 관심 종목이 없습니다"));
  await browser.evaluate("localStorage.setItem('kospi-watchlist.v1','[]')"); await browser.send("Page.reload", { ignoreCache: true }); await browser.waitFor("document.querySelector('.rank-page h1')", "empty watch reload");
  check("legacy deliberately empty [] survives reload", (await bodyText()).includes("아직 관심 종목이 없습니다"));
  await navigate("/rank"); await rankReady(); await browser.click('[data-rank-code="005930"] [data-watch-code="005930"]');
  check("watch toggle keeps a fixed accessible name and pressed state", await browser.evaluate("document.querySelector('[data-rank-code=\"005930\"] [data-watch-code]').getAttribute('aria-label')==='삼성전자 005930 관심 종목' && document.querySelector('[data-rank-code=\"005930\"] [data-watch-code]').getAttribute('aria-pressed')==='true'"));
  await browser.click('.ds-nav a[href="/watchlist"]'); await browser.waitFor("document.querySelector('[data-rank-code=\"005930\"]')", "watch joined row");
  await browser.send("Page.reload", { ignoreCache: true }); await browser.waitFor("document.querySelector('[data-rank-code=\"005930\"] a')?.textContent.includes('삼성전자')", "watch reload preserved"); check("selected code survives real page reload", await browser.evaluate("JSON.parse(localStorage.getItem('kospi-watchlist.v1')).includes('005930')"));
  await browser.evaluate("window.dispatchEvent(new StorageEvent('storage',{key:'kospi-watchlist.v1',newValue:'[\"999999\"]',storageArea:sessionStorage}))");
  check("sessionStorage event cannot change localStorage watchlist", await browser.evaluate("!!document.querySelector('[data-rank-code=\"005930\"]') && !document.querySelector('[data-rank-code=\"999999\"]')"));
  await otherTabStorage(["005930", "999999"], "document.querySelector('[data-rank-code=\"999999\"]')");
  await browser.waitFor("document.querySelector('[data-rank-code=\"999999\"]')", "cross-tab external code");
  check("outside-universe saved code keeps unknown name, missing analysis and report link", await browser.evaluate("document.querySelector('[data-rank-code=\"999999\"]').innerText.includes('이름 미확인') && document.querySelector('[data-rank-code=\"999999\"]').innerText.includes('분석 미제공') && document.querySelector('[data-rank-code=\"999999\"] a').getAttribute('href')==='/stock/999999'"));
  await otherTabStorage([], "!document.querySelector('[data-rank-code]')"); check("real cross-tab newValue [] clears the visible watchlist", (await bodyText()).includes("아직 관심 종목이 없습니다"));
  await otherTabStorage(["005930", "999999"], "document.querySelector('[data-rank-code=\"999999\"]')");
  await otherTabStorage([], "!document.querySelector('[data-rank-code]')", true); check("real cross-tab localStorage.clear synchronizes the watchlist", (await bodyText()).includes("아직 관심 종목이 없습니다"));
  await otherTabStorage(["005930", "999999"], "document.querySelector('[data-rank-code=\"999999\"]')");
  await browser.click('[data-watch-code="999999"]'); check("outside-universe saved code can be removed", await browser.evaluate("!document.querySelector('[data-rank-code=\"999999\"]')"));
  await browser.evaluate("window.__fixtureSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='kospi-watchlist.v1')throw new DOMException('fixture quota','QuotaExceededError');return window.__fixtureSetItem.call(this,key,value)}");
  await browser.click('[data-watch-code="005930"]'); check("save failure preserves action with explicit session-only notice", (await bodyText()).includes("현재 탭에서만 유지") && (await bodyText()).includes("아직 관심 종목이 없습니다"));
  await browser.evaluate("Storage.prototype.setItem=window.__fixtureSetItem;localStorage.setItem('kospi-watchlist.v1','[\"999999\"]')");
  await control({ rankDelayMs: 1600 }); await navigate("/watchlist");
  check("watchlist pending does not assert missing analysis", await browser.evaluate("document.querySelector('[data-rank-code=\"999999\"]').innerText.includes('분석 조회 중') && !document.querySelector('[data-rank-code=\"999999\"]').innerText.includes('분석 미제공')"));
  await browser.waitFor("document.querySelector('[data-rank-code=\"999999\"]').innerText.includes('분석 미제공')", "confirmed absent code");
  await control({ rankDelayMs: 0, rankScenario: "error" }); await browser.click('.rank-title-row button'); await browser.waitFor("document.body.innerText.includes('관심 종목 분석 갱신 실패')", "watch stale error");
  check("previous watch analysis remains explicitly unconfirmed after failure", await browser.evaluate("document.querySelector('[data-rank-code=\"999999\"]').innerText.includes('현재 분석 여부 미확인')"));
  await navigate("/watchlist"); await browser.waitFor("document.body.innerText.includes('전체 순위 조회 실패')", "watch initial failure"); check("initial watch failure is unknown rather than absent analysis", await browser.evaluate("document.querySelector('[data-rank-code=\"999999\"]').innerText.includes('분석 조회 실패 · 미확인')"));
  await control({ reset: true }); await navigate("/rank"); await rankReady();
  await browser.evaluate("window.dispatchEvent(new StorageEvent('storage',{key:'kospi-watchlist.v1',newValue:'[]',storageArea:localStorage}))");
  await browser.click('button[aria-label="종목 검색"]'); await browser.waitFor("document.querySelector('.search-dialog[open] input')===document.activeElement", "search input autofocus");
  await fill('.search-dialog input', "100194"); await browser.waitFor("document.querySelector('[data-search-code=\"100194\"]')", "global non-candidate search");
  check("global search uses all rank records, preserves full-universe count", (await bodyText()).includes("전체 199종목 중 1종목 일치"));
  check("searched non-candidate link is visibly inside modal and receives pointer hit", await browser.evaluate("(()=>{const dialog=document.querySelector('.search-dialog').getBoundingClientRect(),link=document.querySelector('[data-search-code=\"100194\"] a'),r=link.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>24&&r.height>24&&r.top>=dialog.top&&r.bottom<=dialog.bottom&&r.left>=dialog.left&&r.right<=dialog.right&&!!hit&&link.contains(hit)})()"));
  await browser.click('.search-dialog [data-watch-code="100194"]'); check("search can toggle watch without closing dialog", await browser.evaluate("!!document.querySelector('.search-dialog[open]') && document.querySelector('[data-search-code=\"100194\"] [data-watch-code]').getAttribute('aria-pressed')==='true'"));
  await browser.evaluate("document.querySelector('.search-dialog [data-watch-code]').focus()"); await keyboard("Tab", "Tab", 9); check("search forward Tab wraps to modal close button", await browser.evaluate("document.activeElement.getAttribute('aria-label')==='종목 검색 닫기'"));
  await keyboard("Tab", "Tab", 9, 8); check("search reverse Tab wraps within modal", await browser.evaluate("document.activeElement.matches('.search-dialog [data-watch-code]')"));
  await keyboard("Escape", "Escape", 27); await browser.waitFor("!document.querySelector('.search-dialog')", "search escape close"); check("Escape restores actual trigger focus", await browser.evaluate("document.activeElement.matches('.search-trigger')"));
  await keyboard("k", "KeyK", 75, 2); await browser.waitFor("document.querySelector('.search-dialog[open]')", "CtrlK opens search");
  await browser.click('button[aria-label="종목 검색 닫기"]'); check("close button restores actual trigger focus", await browser.evaluate("document.activeElement.matches('.search-trigger')"));
  await browser.click('.search-trigger');
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 }); await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 });
  await browser.waitFor("!document.querySelector('.search-dialog')", "search backdrop close"); check("backdrop restores actual trigger focus", await browser.evaluate("document.activeElement.matches('.search-trigger')"));
  await fill('.rank-search input', "005930"); await keyboard("k", "KeyK", 75, 2); check("CtrlK inside an input does not intercept editing", await browser.evaluate("!document.querySelector('.search-dialog')"));
  await browser.click('.search-trigger');
  await browser.evaluate("window.__m4CompositionEvents=[]; for (const type of ['compositionstart','compositionend']) document.querySelector('.search-dialog input').addEventListener(type,event=>window.__m4CompositionEvents.push({type:event.type,data:event.data}))");
  await browser.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 }); await keyboard("Escape", "Escape", 27); check("IME Escape does not close the search modal", await browser.evaluate("!!document.querySelector('.search-dialog[open]')"));
  await browser.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
  report.imeEvents = await browser.evaluate("window.__m4CompositionEvents");
  if (report.imeEvents.some(event => event.type === "compositionend")) {
    await keyboard("Escape", "Escape", 27); await browser.waitFor("!document.querySelector('.search-dialog')", "IME ended then Escape closes");
  } else {
    report.imeLimitation = "This Edge CDP composition cancellation emits no compositionend; native OS IME completion is unverified. Composition-end guard is covered by unit tests.";
    await browser.click('button[aria-label="종목 검색 닫기"]');
  }
  await browser.click('.search-trigger'); await keyboard("Escape", "Escape", 27); await browser.waitFor("!document.querySelector('.search-dialog')", "fresh search after IME closes normally"); check("IME cancellation does not persist after closing and reopening search", true);
  await browser.click('.ds-nav a[href="/"]'); await browser.waitFor("document.querySelector('[data-candidate-code]')", "briefing route before back"); await browser.click('.search-trigger');
  await browser.evaluate("history.back()"); await browser.waitFor("location.pathname==='/rank' && !document.querySelector('.search-dialog')", "browser back closes search");
  await browser.waitFor("document.activeElement.id==='main-content'", "browser back focuses route main"); check("browser-back route transition closes modal without stealing main focus", await browser.evaluate("document.activeElement.dataset.routePath==='/rank'"));
  await browser.click('.search-trigger'); await fill('.search-dialog input', "100194"); await browser.waitFor("document.querySelector('[data-search-code=\"100194\"] a')", "non-candidate report link");
  await browser.click('[data-search-code="100194"] a'); await browser.waitFor("location.pathname==='/stock/100194' && document.querySelector('[data-report-code=\"100194\"]') && !document.querySelector('.search-dialog')", "actual search result navigation");
  await browser.waitFor("document.activeElement.id==='main-content'", "search result route main focus"); check("trusted non-candidate search click opens correct report and focuses main", await browser.evaluate("document.activeElement.dataset.routePath==='/stock/100194'"));
  await control({ rankScenario: "error" }); await navigate("/rank"); await browser.click('.search-trigger'); await browser.waitFor("document.querySelector('.search-count').textContent==='검색 자료 미확인'", "unqueried error count"); check("search initial failure never claims authoritative zero", !(await bodyText()).includes("전체 0종목 중 0종목 일치")); await keyboard("Escape", "Escape", 27);
  await control({ rankScenario: "empty" }); await navigate("/rank"); await browser.waitFor("document.body.innerText.includes('최신 전체 분석 결과가 비어 있습니다')", "authoritative empty rank"); check("empty rank is never filled with five candidates", await browser.evaluate("!document.querySelector('[data-rank-code]')"));
  await browser.click('.search-trigger'); await browser.waitFor("document.querySelector('.search-count').textContent==='전체 0종목 중 0종목 일치'", "confirmed search zero"); check("authoritative successful [] permits a real zero count", true); await keyboard("Escape", "Escape", 27);
  await control({ rankScenario: "sample" }); await navigate("/rank"); await rankReady(); check("sample rank is explicitly an example, never upgraded to actual analysis", (await bodyText()).includes("예시 데이터 · 실제 전체 분석 결과가 아닙니다"));
  await control({ rankScenario: "error" }); await browser.click('.rank-title-row button'); await browser.waitFor("document.body.innerText.includes('이전 조회 결과 · 전체 순위 갱신 실패')", "rank previous error"); check("rank background error retains rows with explicit warning", await browser.evaluate("document.querySelectorAll('[data-rank-code]').length===20"));
  await control({ reset: true, candidatesDelayMs: 1600 }); await navigate("/rank"); await browser.waitFor("document.querySelector('[data-rank-code]')", "rank before membership"); check("pending candidate membership cannot invent model signal", await browser.evaluate("document.querySelector('[data-rank-signal=model] [data-signal]').dataset.signal==='unavailable'")); await rankReady();
  await control({ scenario: "error", candidatesDelayMs: 0 }); await browser.click('.rank-title-row button'); await browser.waitFor("document.querySelector('[data-rank-code]').dataset.membership==='unknown'", "candidate membership error"); check("failed membership does not use previous final-candidate model state", await browser.evaluate("document.querySelector('[data-rank-signal=model] [data-signal]').dataset.signal==='unavailable'"));
  await control({ reset: true, chartScenario: "partial" }); await navigate("/stock/005930", ".stock-report h1"); await browser.waitFor("document.querySelector('[data-chart-range]')", "report chart ready"); check("intraday line is labelled price rather than closing price", await browser.evaluate("[...document.querySelectorAll('.report-chart-controls button')].some(button=>button.textContent==='가격선')"));
  const fiveYear = await browser.evaluate("[...document.querySelectorAll('.report-chart-controls button')].findIndex(button=>button.textContent==='5년')"); await browser.click(`.report-chart-controls > div:first-child button:nth-child(${fiveYear + 1})`);
  await browser.waitFor("document.querySelector('[data-chart-coverage=partial]')", "requested 5Y partial warning"); check("5Y request shows actual 1Y fallback coverage without inventing years", (await bodyText()).includes("1년 조회 원본을 대신 사용") && (await bodyText()).includes("전체 기간 이력이 아닙니다") && !(await bodyText()).includes("없는 기간을 다른 기간으로 자동 전환하지 않습니다"));
  await browser.click('.stock-report [data-watch-code="005930"]'); check("report watch toggle is connected", await browser.evaluate("document.querySelector('.stock-report [data-watch-code]').getAttribute('aria-pressed')==='true'"));
  await navigate("/next?code=005930", ".briefing-page h1"); await browser.waitFor("document.querySelector('[data-candidate-code=\"005930\"] [data-watch-code]')", "briefing watch toggle"); check("briefing watch toggle shares the same stored selection", await browser.evaluate("document.querySelector('[data-candidate-code=\"005930\"] [data-watch-code]').getAttribute('aria-pressed')==='true'"));
  await browser.click('[data-candidate-code="005930"] button'); const beforeArrow = await browser.evaluate("history.length"); await browser.key("ArrowDown"); await browser.waitFor("location.search==='?code=000660'", "briefing arrow selects B"); check("arrow selection replaces history instead of adding a back step", await browser.evaluate(`history.length===${beforeArrow}`));
  await control({ reset: true });
  for (const width of [1440, 1280, 375]) for (const theme of ["dark", "light"]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await browser.evaluate(`localStorage.setItem('kospi-theme.v1',${JSON.stringify(theme)})`);
    await navigate("/rank"); await rankReady(); await browser.evaluate("document.fonts.ready"); await audit(`rank-${width}-${theme}`); if (width !== 375) await screenshot(`m4-rank-${width}-${theme}.png`, width);
    await browser.click('.search-trigger'); await browser.waitFor("document.querySelector('[data-search-code]')", "populated modal"); await audit(`search-${width}-${theme}`); if (width === 1440) await screenshot(`m4-search-${width}-${theme}.png`, width); await keyboard("Escape", "Escape", 27);
    await navigate("/watchlist"); await browser.waitFor("document.querySelector('[data-rank-code=\"005930\"] a')?.textContent.includes('삼성전자')", "populated watchlist"); await audit(`watchlist-${width}-${theme}`);
  }
  await browser.settleInterceptions();
  check("zero console.error and unhandled exceptions", !browser.consoleErrors.length && !browser.exceptions.length);
  const requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json(); check("all product API calls are fixture GET, never paid analysis POST", requests.every(r => r.method === "GET" && !r.blocked)); check("zero external network/article visits", browser.blocked.length === 0); report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; console.error(error.message); process.exitCode = 1; }
finally {
  try { await browser.settleInterceptions(); }
  catch (error) { report.passed = false; report.diagnosticFailure = error.message; process.exitCode = 1; }
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked; report.clickDiagnostics = browser.clickDiagnostics;
  report.cancelledInterceptions = browser.cancelledInterceptions; report.interceptionErrors = browser.interceptionErrors;
  try {
    report.requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
    report.page = await browser.evaluate("({url:location.href,activeElement:document.activeElement?.outerHTML,text:document.body.innerText,compositionEvents:window.__m4CompositionEvents})");
    if (!report.passed) { const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await writeFile(resolve(artifacts, "failure.png"), Buffer.from(shot.data, "base64")); report.failureScreenshot = "failure.png"; }
  } catch (error) { report.diagnosticFailure = error.message; }
  await writeFile(resolve(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(artifacts, "README.md"), "# M4 fixture 브라우저 검증\n\n모든 수치와 PNG는 검증용 fixture입니다. FE에서 `npm run build` 후 `node scripts/verify/m4-smoke.mjs`. 기존 Edge/Chrome과 자동 할당 localhost 포트만 사용합니다. 다른 CDP harness와 동시에 실행하지 마세요. 외부 네트워크와 제품 POST는 차단합니다. 실제 KIS/Vercel/유료 분석/외부 기사는 검증하지 않았습니다.\n");
  await browser.close(); await fixture.close(); console.log(`Artifacts: FE/artifacts/m4/ · ${report.passed ? "ALL PASSED" : "FAILED"}`);
}
