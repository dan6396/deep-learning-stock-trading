// Current production build + localhost fixtures only. Run after npm run build.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser, pause } from "./cdp-browser.mjs";

const require = createRequire(import.meta.url), axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const artifacts = fileURLToPath(new URL("../../artifacts/site/", import.meta.url)); await mkdir(artifacts, { recursive: true });
const fixture = await startFixtureServer(), browser = await launchBrowser(fixture.base);
const report = { fixtureOnly: true, fixtureBase: fixture.base, generatedAt: new Date().toISOString(), checks: [], axe: [], screenshots: [] };
const check = (label, value) => { assert.ok(value, label); report.checks.push(label); console.log(`PASS ${label}`); };
const control = async change => { const response = await fetch(`${fixture.base}/_fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }); assert.equal(response.status, 200); };
const mainText = () => browser.evaluate("document.querySelector('#main-content')?.innerText ?? ''");
async function navigate(path, selector, staticOnly = false) {
  await browser.send("Page.navigate", { url: `${fixture.base}${path}` });
  await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})`, `${path} mounted`);
  if (!staticOnly && !path.startsWith("/legacy")) await browser.waitFor("document.querySelector('.ds-header') && document.querySelector('#main-content')?.dataset.routePath===location.pathname", `${path} interactive shell mounted`);
}
async function key(key, virtual) { for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual }); }
async function audit(label) {
  await browser.evaluate(axe);
  const result = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(result=>({violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))}))");
  report.axe.push({ label, ...result }); check(`${label}: WCAG 2.2 AA automated rules`, result.violations.length === 0);
  check(`${label}: no page overflow`, await browser.evaluate("document.documentElement.scrollWidth <= innerWidth+1"));
  check(`${label}: one main and one h1`, await browser.evaluate("document.querySelectorAll('main').length===1 && document.querySelectorAll('h1').length===1"));
}
async function capture(label, width) {
  const metrics = await browser.send("Page.getLayoutMetrics");
  const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
  const name = `${label}.png`; await writeFile(resolve(artifacts, name), Buffer.from(shot.data, "base64")); report.screenshots.push(name);
}
try {
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate("/", ".briefing-page h1"); await browser.waitFor("document.querySelector('[data-candidate-code]')", "root candidates");
  check("root opens rebuilt briefing without legacy chunks", await browser.evaluate("document.querySelector('h1').textContent==='오늘의 브리핑' && !performance.getEntriesByType('resource').some(e=>['LandingPage-','DashboardPage-','StockDetailPage-'].some(name=>e.name.includes(name)))"));
  await audit("root-preflight-1440-dark");
  for (const [path, selector] of [["/rank", ".rank-page h1"], ["/watchlist", ".rank-page h1"], ["/history", ".history-page h1"]]) {
    await browser.click(`.ds-nav a[href='${path}']`); await browser.waitFor(`document.querySelector(${JSON.stringify(selector)}) && location.pathname===${JSON.stringify(path)}`, `menu ${path}`);
    await browser.waitFor("document.activeElement.id==='main-content'", `${path} content focus`);
    check(`${path}: active navigation and route focus`, await browser.evaluate(`document.querySelector('.ds-nav a[aria-current="page"]').getAttribute('href')===${JSON.stringify(path)} && document.activeElement.dataset.routePath===${JSON.stringify(path)}`));
  }
  await browser.waitFor("document.querySelector('[data-testid=history-status]').textContent==='실행 중인 분석 없음'", "history idle");
  check("history distinguishes latest status, results and unavailable official records", (await mainText()).includes("공식 / 수시 구분") && (await mainText()).includes("현재 분석 결과") && (await mainText()).includes("20거래일 실현 성과") && await browser.evaluate("!document.querySelector('.history-page table') && document.querySelector('[data-testid=history-progress-updated]').textContent!=='미확인'"));
  await control({ analysis: "failed" }); await browser.click('.history-title button'); await browser.waitFor("document.querySelector('[data-testid=history-status]').textContent==='최신 실행 실패'", "history failed");
  check("failed run keeps separate stored candidate results", await browser.evaluate("document.querySelector('[data-testid=history-candidate-count]').textContent==='5개'"));
  await control({ analysis: "running" }); await browser.click('.history-title button'); await browser.waitFor("document.querySelector('[data-testid=history-status]').textContent==='분석 진행 중'", "history running");
  const beforePoll = (await (await fetch(`${fixture.base}/_fixture/requests`)).json()).filter(r => r.path === "/api/candidates/run").length;
  await pause(5300);
  const afterPoll = (await (await fetch(`${fixture.base}/_fixture/requests`)).json()).filter(r => r.path === "/api/candidates/run").length;
  check("history polls an active run using GET", afterPoll > beforePoll);
  await control({ reset: true });
  await browser.click('.ds-footer a[href="/about"]'); await browser.waitFor("document.querySelector('.about-page h1')", "about navigation");
  check("about links reach briefing and rank", await browser.evaluate("document.querySelector('.about-actions a').getAttribute('href')==='/' && document.querySelector('.about-actions a:nth-child(2)').getAttribute('href')==='/rank'"));
  await browser.click('.about-actions a:nth-child(2)'); await browser.waitFor("document.querySelector('.rank-page h1')", "about rank CTA");
  await navigate("/dashboard?code=005930&sort=model#market-table", ".briefing-page h1");
  check("dashboard alias preserves query and adapts section hash", await browser.evaluate("location.pathname==='/' && location.search==='?code=005930&sort=model' && location.hash==='#candidate-heading'"));
  await browser.waitFor("scrollY>0 && document.querySelector('#candidate-heading').getBoundingClientRect().top >= document.querySelector('.ds-header').getBoundingClientRect().bottom && document.querySelector('#candidate-heading').getBoundingClientRect().bottom <= innerHeight", "hash target actually scrolls clear of sticky header");
  report.hashPosition = await browser.evaluate("({scrollY,targetTop:document.querySelector('#candidate-heading').getBoundingClientRect().top,headerBottom:document.querySelector('.ds-header').getBoundingClientRect().bottom})");
  check("dashboard hash scrolls the mounted target below sticky header", true);
  for (const [path, selector] of [["/next", ".briefing-page h1"], ["/next/rank", ".rank-page h1"], ["/next/watchlist", ".rank-page h1"], ["/next/history", ".history-page h1"], ["/next/about", ".about-page h1"], ["/stock/005930", ".stock-report h1"], ["/next/stock/005930", ".stock-report h1"]]) {
    await navigate(path, selector); await browser.send("Page.reload", { ignoreCache: true }); await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})`, `reload ${path}`);
    check(`${path}: direct visit and reload`, await browser.evaluate(`location.pathname===${JSON.stringify(path)}`));
  }
  for (const path of ["/missing", "/next/missing"]) {
    await navigate(path, ".ds-main h1"); check(`${path}: site 404 with correct home`, await browser.evaluate(`document.querySelector('h1').textContent==='페이지를 찾을 수 없습니다' && [...document.querySelectorAll('a')].some(a=>a.textContent==='브리핑으로 돌아가기' && a.getAttribute('href')===${JSON.stringify(path.startsWith("/next") ? "/next" : "/")})`));
    check(`${path}: soft 404 is noindex`, await browser.evaluate("document.querySelector('meta[name=robots]')?.content==='noindex'"));
    await browser.click('.ds-main a'); await browser.waitFor("document.querySelector('.briefing-page h1')", "404 home recovery");
    check(`${path}: noindex is removed on normal route`, await browser.evaluate("!document.querySelector('meta[name=robots]')"));
  }
  // Search lives in the real shell, using fixture data and the real keyboard path.
  await navigate("/", ".briefing-page h1"); await browser.click('.search-trigger');
  await browser.waitFor("document.querySelector('dialog[open] input')===document.activeElement", "search input focus");
  await browser.waitFor("document.querySelector('[data-search-code=\"005930\"] a')", "search results ready");
  check("search results are visible inside the modal", await browser.evaluate("(()=>{const dialog=document.querySelector('dialog[open]').getBoundingClientRect(),first=document.querySelector('[data-search-code=\"005930\"] a').getBoundingClientRect();return first.top>=dialog.top&&first.bottom<=dialog.bottom})()"));
  await audit("search-dialog-1440-dark");
  await capture("search-dialog-1440-dark", 1440);
  await key("Escape", 27); await browser.waitFor("!document.querySelector('dialog[open]') && document.activeElement.classList.contains('search-trigger')", "search Escape restores focus");
  check("search Escape restores trigger focus after dialog closes", true);
  await browser.click('.search-trigger'); await browser.waitFor("document.querySelector('[data-search-code=\"005930\"] a')", "search stock result");
  await browser.click('.search-close'); await browser.waitFor("!document.querySelector('dialog[open]') && document.activeElement.classList.contains('search-trigger')", "search close button restores focus");
  check("search close button restores trigger focus", true);
  await browser.click('.search-trigger'); await browser.waitFor("document.querySelector('[data-search-code=\"005930\"] a')", "search reopened");
  await browser.click('[data-search-code="005930"] a'); await browser.waitFor("location.pathname==='/stock/005930' && document.querySelector('.stock-report h1')", "search result report"); check("search navigates to root stock report", true);
  for (const path of ["/legacy", "/legacy/dashboard", "/legacy/stock/005930"]) { await navigate(path, "#main-content"); check(`${path}: legacy remains mounted`, await browser.evaluate("!document.querySelector('.ds-root')")); }
  await navigate("/", ".briefing-page h1");
  await browser.click('.ds-theme-button'); await browser.waitFor("document.documentElement.dataset.theme==='light'", "theme button switches to light");
  check("theme button persists the chosen palette", await browser.evaluate("localStorage.getItem('kospi-theme.v1')==='light'"));
  await browser.send("Page.reload", { ignoreCache: true }); await browser.waitFor("document.querySelector('.ds-header') && document.documentElement.dataset.theme==='light'", "theme survives reload");
  check("chosen theme survives direct reload", true);
  const pages = [["briefing", "/", ".briefing-page h1"], ["rank", "/rank", ".rank-page h1"], ["watchlist", "/watchlist", ".rank-page h1"], ["history", "/history", ".history-page h1"], ["about", "/about", ".about-page h1"]];
  for (const [width, height] of [[1440,1000], [1280,900], [375,900], [667,375]]) for (const theme of ["dark", "light"]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const [name, path, selector] of pages) {
      await navigate(path, selector); await browser.evaluate(`localStorage.setItem('kospi-theme.v1',${JSON.stringify(theme)});document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await browser.evaluate("document.fonts.ready"); await pause(150);
      const label = `${name}-${width}-${theme}`; await audit(label);
      check(`${label}: header targets at least 24px`, await browser.evaluate("[...document.querySelectorAll('.ds-header a,.ds-header button')].every(el=>{const r=el.getBoundingClientRect();return r.width>=24&&r.height>=24})"));
      if (name === "history" || name === "about" || name === "briefing") await capture(label, width);
    }
  }
  await navigate("/about", ".about-page h1"); await browser.evaluate("window.scrollTo(0,0);document.querySelector('.ds-brand').focus()");
  for (let i = 0; i < 10; i++) {
    await key("Tab", 9);
    check(`keyboard focus ${i+1} remains visible`, await browser.evaluate("(()=>{const el=document.activeElement,r=el.getBoundingClientRect(),head=document.querySelector('.ds-header').getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&(!!el.closest('.ds-header')||r.top>=head.bottom-1)})()"));
  }
  const staticHtml = await (await fetch(`${fixture.base}/about`)).text();
  check("about response contains readable static content and metadata", staticHtml.includes('class="about-page"') && staticHtml.includes("서비스 소개 · KOSPI AI Desk") && staticHtml.includes("일치도는 승률이나 수익 확률이 아닙니다"));
  check("static about loads only shared and about styles", !/(?:HistoryPage|StockReportPage|RankTable|briefing)-[^" ]+\.css/.test(staticHtml));
  await browser.send("Emulation.setScriptExecutionDisabled", { value: true }); await navigate("/about", ".about-page h1", true);
  await browser.waitFor("document.readyState==='complete'", "static introduction fully loaded");
  check("introduction is readable with application JavaScript disabled", await browser.evaluate("document.querySelector('.about-page h1').textContent.includes('판단을 위한 근거') && !document.querySelector('.ds-header')"));
  // Axe needs timers. Re-enable inspection after the disabled scripts were skipped.
  await browser.send("Emulation.setScriptExecutionDisabled", { value: false });
  await pause(150);
  check("static snapshot remains without the application shell", await browser.evaluate("!document.querySelector('.ds-header') && !document.querySelector('#main-content').dataset.routePath"));
  for (const theme of ["dark", "light"]) { await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await browser.evaluate("document.fonts.ready"); await pause(100); await audit(`about-nojs-${theme}`); await capture(`about-nojs-${theme}`, 667); }
  await browser.settleInterceptions();
  check("zero console errors and unhandled exceptions", browser.consoleErrors.length===0 && browser.exceptions.length===0);
  const requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json(); check("zero product POST requests", requests.every(r=>r.method==='GET'&&!r.blocked));
  check("zero external network requests", browser.blocked.length===0); report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; console.error(error.message); process.exitCode = 1; }
finally {
  try { await browser.settleInterceptions(); }
  catch (error) { report.passed = false; report.diagnosticFailure = error.message; process.exitCode = 1; }
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked;
  report.cancelledInterceptions = browser.cancelledInterceptions; report.interceptionErrors = browser.interceptionErrors;
  try { report.requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json(); report.page = await browser.evaluate("({url:location.href,active:document.activeElement?.outerHTML,text:document.body.innerText})"); if (!report.passed) { const shot=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(resolve(artifacts,'failure.png'),Buffer.from(shot.data,'base64')); } } catch (error) { report.diagnosticFailure = error.message; }
  try { await browser.close(); } finally { await fixture.close(); }
  report.fixtureClosed = !fixture.server.listening;
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifacts, "report.json"), JSON.stringify(report,null,2));
  console.log(`Fixture port ${new URL(fixture.base).port}: ${report.fixtureClosed ? 'closed' : 'OPEN'}`);
  console.log(`Artifacts: FE/artifacts/site/ · ${report.passed ? 'ALL PASSED' : 'FAILED'}`);
}
