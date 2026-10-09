import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser, pause } from "./cdp-browser.mjs";

// Production build, localhost fixtures, no Python jobs or paid provider calls.
const dir = "artifacts/design-improvements";
const fixture = await startFixtureServer(), browser = await launchBrowser(fixture.base);
const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
const report = { fixtureOnly: true, pages: [], checks: [], interactions: {} };
const routes = [["briefing", "/", ".briefing-page"], ["rank", "/rank", ".rank-page"], ["watchlist", "/watchlist", ".rank-page"], ["history", "/history", ".history-page"], ["stock", "/stock/005930", ".stock-report"], ["about", "/about", ".about-page"]];
function check(label, condition) { assert.ok(condition, label); report.checks.push(label); }
async function navigate(path, selector) {
  await browser.send("Page.navigate", { url: fixture.base + path });
  await browser.waitFor(`document.querySelector('${selector} h1')`, "page mounted");
  await browser.evaluate("document.fonts.ready");
  await pause(180);
}
async function control(change) {
  const response = await fetch(`${fixture.base}/_fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
  assert.equal(response.status, 200);
}
async function capture(name) {
  const shot = await browser.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${dir}/${name}.png`, Buffer.from(shot.data, "base64"));
}
async function tab() {
  for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await pause(40);
}
try {
  await mkdir(dir, { recursive: true });
  for (const [width, height] of [[1440, 1000], [375, 812], [667, 375]]) for (const theme of ["dark", "light"]) for (const [name, path, selector] of routes) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await navigate(path, selector);
    await browser.evaluate(`localStorage.setItem('kospi-theme.v1','${theme}');document.documentElement.dataset.theme='${theme}'`);
    await browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await browser.evaluate(axe);
    const violations = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
    const metrics = await browser.evaluate(`(() => {
      const rect=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{top:Math.round(r.top),bottom:Math.round(r.bottom),height:Math.round(r.height)}:null};
      const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
      return {overflow:document.documentElement.scrollWidth>innerWidth+1,connection:rect('.connection-notice'),launch:rect('.analysis-start-button'),candidate:rect('#candidate-heading'),
        metaSizes:[...document.querySelectorAll('.briefing-source,.briefing-table-help,.briefing-series-label,.rank-row-note,.report-footnote,.report-chart-summary')].filter(visible).map(e=>parseFloat(getComputedStyle(e).fontSize)),
        smallControls:[...document.querySelectorAll('a[href],button,input,select,summary')].filter(visible).filter(e=>!(e.tagName==='A'&&getComputedStyle(e).display==='inline')).filter(e=>{const r=e.getBoundingClientRect();return r.width<24||r.height<24}).map(e=>e.getAttribute('aria-label')||e.textContent)};
    })()`);
    const label = `${name}-${width}-${theme}`;
    report.pages.push({ label, width, height, theme, violations, ...metrics });
    if (violations.length) console.log(JSON.stringify({ label, violations }, null, 2));
    check(`${label}: no automatic WCAG A/AA violations`, violations.length === 0);
    check(`${label}: no page overflow`, !metrics.overflow);
    check(`${label}: metadata at least 12px`, metrics.metaSizes.every(size => size >= 12));
    check(`${label}: controls at least 24px`, metrics.smallControls.length === 0);
    check(`${label}: normal connection compact`, metrics.connection.height <= 60);
    if (name === "briefing" && width === 375) {
      check(`${label}: launch fully in first viewport`, metrics.launch.bottom <= height);
      check(`${label}: candidates start in first viewport`, metrics.candidate.bottom <= height);
      check(`${label}: readable Korean metadata`, await browser.evaluate("document.querySelector('.briefing-result-meta').textContent.includes('분석 기준일') && document.querySelector('.briefing-date-details summary').textContent==='시각·예측 기준 상세'"));
    }
    if ((width === 1440 && theme === "dark") || (width === 375 && theme === "light")) await capture(label);
    console.log(`PASS ${label}`);
  }

  await browser.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await navigate("/rank", ".rank-page");
  await browser.waitFor("document.querySelector('[data-rank-code]')", "rank rows ready");
  report.interactions.sticky = await browser.evaluate(`(() => {
    const s=document.querySelector('.rank-table-scroll');s.scrollLeft=450;s.scrollIntoView({block:'start',behavior:'instant'});
    const region=s.getBoundingClientRect(),cell=s.querySelector('tbody td:first-child').getBoundingClientRect(),name=s.querySelector('.rank-stock').getBoundingClientRect();
    return {regionLeft:region.left,regionRight:region.right,cellLeft:cell.left,cellRight:cell.right,nameLeft:name.left,nameRight:name.right,scrollLeft:s.scrollLeft,hintVisible:getComputedStyle(document.querySelector('.rank-scroll-hint')).display!=='none'};
  })()`);
  const sticky = report.interactions.sticky;
  check("mobile name remains fully in view after 450px horizontal scroll", sticky.nameLeft >= sticky.regionLeft - 1 && sticky.nameRight <= sticky.regionRight + 1);
  check("mobile sticky name leaves room for values", sticky.cellRight < sticky.regionRight - 100);
  check("mobile horizontal-scroll hint is visible", sticky.hintVisible);
  await capture("rank-375-scrolled");
  await browser.evaluate("document.querySelector('.rank-table-scroll').focus()");
  report.interactions.sortFocus = [];
  for (let i = 0; i < 5; i++) {
    await tab();
    const focus = await browser.evaluate(`(() => {const e=document.activeElement,r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {name:e.textContent.trim(),visible:!!hit&&(hit===e||e.contains(hit)),outline:getComputedStyle(e).outlineStyle};})()`);
    report.interactions.sortFocus.push(focus);
    check(`sort focus ${i + 1}: visible beside sticky name`, focus.visible && focus.outline !== "none");
  }

  await control({ backendScenario: "error" });
  await navigate("/", ".briefing-page");
  await browser.waitFor("document.querySelector('.connection-disclosure').open && document.querySelector('.connection-attention')", "error exposes connection details");
  check("connection errors automatically expand", true);
  check("connection errors retain retry control", await browser.evaluate("!!document.querySelector('.connection-notice-body button').getClientRects().length"));
  await capture("connection-error-375");
  await control({ reset: true });
  await navigate("/", ".briefing-page");
  await browser.click('.connection-notice-heading');
  await browser.waitFor("document.querySelector('.connection-disclosure').open", "manual connection expansion");
  check("connection details can still be opened manually", await browser.evaluate("document.querySelector('.connection-notice-body').innerText.includes('設定確認') || document.querySelector('.connection-notice-body').innerText.includes('설정 확인은 실제 조회 성공을 보장하지 않습니다')"));
  await browser.click('.connection-notice-heading');
  await browser.waitFor("!document.querySelector('.connection-disclosure').open", "manual connection collapse");
  await browser.evaluate("document.querySelector('.skip-link').focus()");
  for (let i = 0; i < 18; i++) {
    await tab();
    check(`briefing Tab ${i + 1}: focus visible`, await browser.evaluate(`(() => {const e=document.activeElement,r=e.getBoundingClientRect(),h=document.querySelector('.ds-header'),hr=h.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&(h.contains(e)||r.bottom>hr.bottom)&&getComputedStyle(e).outlineStyle!=='none'})()`));
  }
  await browser.click('.search-trigger');
  await browser.waitFor("document.querySelector('dialog[open] input')===document.activeElement", "search input focus");
  await browser.evaluate(axe);
  const modalViolations = await browser.evaluate("axe.run(document.querySelector('dialog[open]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>v.id))");
  check("mobile search accessible", modalViolations.length === 0);
  for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await browser.waitFor("!document.querySelector('dialog[open]') && document.activeElement.matches('.search-trigger')", "search close restores focus");
  check("search Escape restores focus", true);
  await browser.settleInterceptions();
  report.consoleErrors = browser.consoleErrors;
  report.exceptions = browser.exceptions;
  check("no console errors or exceptions", !report.consoleErrors.length && !report.exceptions.length);
  await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pages: report.pages.length, checks: report.checks.length, mobile: report.pages.filter(p => p.label.startsWith("briefing-375")), sticky }));
} catch (error) {
  await writeFile(`${dir}/verification-failed.json`, JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
  await fixture.close();
}
