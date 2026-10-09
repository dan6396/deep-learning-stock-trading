import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { launchBrowser, pause } from "../../scripts/verify/cdp-browser.mjs";

const base = "http://127.0.0.1:5173", directory = new URL("./", import.meta.url), require = createRequire(import.meta.url);
const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8"), browser = await launchBrowser(base);
const report = { generatedAt: new Date().toISOString(), base, realData: true, checks: [], audits: [], screenshots: [], resources: [], requestAudit: [] };
const check = (label, value) => { assert.ok(value, label); report.checks.push(label); console.log(`PASS ${label}`); };
async function screenshot(name, full = false) {
  const layout = await browser.send("Page.getLayoutMetrics");
  const result = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full, ...(full ? { clip: { x: 0, y: 0, width: await browser.evaluate("innerWidth"), height: Math.ceil(layout.cssContentSize.height), scale: 1 } } : {}) });
  await writeFile(new URL(name, directory), Buffer.from(result.data, "base64")); report.screenshots.push(name);
}
async function audit(label) {
  await browser.evaluate(axe);
  const violations = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
  report.audits.push({ label, violations }); check(`${label}: axe violations zero`, violations.length === 0);
  check(`${label}: no page overflow`, await browser.evaluate("document.documentElement.scrollWidth<=innerWidth"));
  const smallText = await browser.evaluate("(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),small=[];let node;while(node=walker.nextNode()){const el=node.parentElement;if(!node.textContent.trim()||!el||el.closest('svg,[aria-hidden=true],script,style'))continue;const rect=el.getBoundingClientRect(),style=getComputedStyle(el);if(rect.width>4&&rect.height>8&&style.visibility!=='hidden'&&parseFloat(style.fontSize)<12)small.push({text:node.textContent.trim(),size:style.fontSize});}return small;})()");
  report.audits[report.audits.length - 1].smallText = smallText; check(`${label}: visible text at least 12px`, smallText.length === 0);
}
async function navigate(path, width, height, theme, condition) {
  await recordPageRequests();
  await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('kospi-theme.v1', '${theme}')` });
  await browser.send("Page.navigate", { url: `${base}${path}` });
  await pause(150);
  await browser.waitFor("document.querySelector('.ds-header')", "shell");
  await browser.waitFor(condition, path, 45000);
  await browser.evaluate("document.fonts.ready.then(()=>true)");
  await browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  report.resources.push({ path, width, theme, api: await browser.evaluate("performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname+new URL(r.name).search).filter(p=>p.startsWith('/api/'))") });
  report.resources[report.resources.length - 1].chartError = await browser.evaluate("document.querySelector('.briefing-mini-chart')?.dataset.chartError ?? null");
}
async function recordPageRequests() {
  const audit = await browser.evaluate("window.__demoAudit ? ({path:location.pathname,requests:window.__demoAudit.requests,forbiddenClicks:window.__demoAudit.forbiddenClicks}) : null");
  if (audit) report.requestAudit.push(audit);
}
async function tab(shift = false) {
  for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 });
  await pause(80);
}
async function escape() { for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); }
async function marker() { const status = await (await fetch(`${base}/api/backend/status`)).json(); return status.marker; }
const ready = "document.querySelectorAll('[data-model-code]').length===5 && !document.querySelector('.briefing-quote-cell')?.innerText.includes('조회 중') && document.querySelector('#briefing-detail h2') && !document.querySelector('.briefing-mini-chart')?.innerText.includes('조회 중') && !document.querySelector('.briefing-summary-market')?.innerText.includes('지수 조회 중')";
try {
  report.runBefore = await marker();
  // Keep the start control out of all click actions; also prevent any non-GET API
  // before fetch, independently of the CDP helper's network interception.
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__demoAudit = {requests: [], forbiddenClicks: []};
    const demoFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href), method = (options?.method || input?.method || 'GET').toUpperCase();
      if (url.pathname.startsWith('/api/')) {
        window.__demoAudit.requests.push({method, path: url.pathname + url.search});
        if (method !== 'GET') return Promise.reject(new Error('Demo verification permits GET only'));
      }
      return demoFetch(input, options);
    };
    document.addEventListener('click', event => {
      if (event.target.closest?.('.analysis-start-button')) { event.preventDefault(); event.stopImmediatePropagation(); window.__demoAudit.forbiddenClicks.push('analysis start'); }
    }, true);
  ` });
  await browser.send("Network.setBlockedURLs", { urls: ["*/api/korean-market/dashboard*", "*/api/korean-market/refresh*"] });
  await navigate("/", 1280, 720, "dark", ready);
  check("default first selection keeps URL unchanged", await browser.evaluate("location.search==='' && document.querySelector('[data-model-code]').dataset.selected==='true'"));
  check("model-only briefing has two evidence dots and no news section", await browser.evaluate("[...document.querySelectorAll('[data-model-code] .briefing-evidence-dots')].every(el=>el.children.length===2) && !document.querySelector('[data-detail-evidence=news]') && !document.querySelector('#briefing-detail').innerText.includes('대표 기사')"));
  check("fixed paper record gives capital and absolute return primary hierarchy", await browser.evaluate("document.querySelector('.briefing-paper-capital').innerText.includes('976.1만 원') && document.querySelector('.briefing-paper-capital').innerText.includes('-2.39%') && document.querySelector('.briefing-summary-paper').innerText.includes('모의투자 · 3거래일') && document.querySelector('.briefing-summary-paper').innerText.includes('고정 기록')"));
  await screenshot("briefing-1280x720-dark.png");
  report.desktopLayout = await browser.evaluate("({scrollY,rows:[...document.querySelectorAll('[data-model-code]')].map(row=>({top:row.getBoundingClientRect().top,bottom:row.getBoundingClientRect().bottom})),summary:document.querySelector('.briefing-summary-strip').getBoundingClientRect().toJSON(),detail:document.querySelector('#detail-title').getBoundingClientRect().toJSON()})");
  check("1280x720 first viewport includes summary, all five rows and detail heading without scrolling", report.desktopLayout.scrollY === 0 && report.desktopLayout.rows.every(row => row.top >= 0 && row.bottom <= 720) && report.desktopLayout.detail.y < 720);
  await audit("briefing-1280-dark");
  check("quotes requested for exactly five distinct Top-5 codes", new Set(report.resources[0].api.filter(path => path.startsWith("/api/korean-market/quote?"))).size === 5);
  const secondCode = await browser.evaluate("document.querySelectorAll('[data-model-code]')[1].dataset.modelCode");
  // All five rows are already visible; avoid changing scroll during this click.
  const secondPoint = await browser.evaluate(`(()=>{const button=document.querySelector('[data-model-code="${secondCode}"] button'),r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await browser.send("Input.dispatchMouseEvent", { type, ...secondPoint, ...(type !== "mouseMoved" ? { button: "left", clickCount: 1 } : {}) });
  await browser.waitFor(`location.search==='?code=${secondCode}' && document.querySelector('#briefing-detail').dataset.detailCode==='${secondCode}'`, "row selection URL and panel");
  check("row selection opens right panel through query string", true);
  await browser.click(".ds-analysis-trigger"); await browser.waitFor("document.querySelector('dialog.analysis-dialog')?.open", "dark analysis dialog"); await audit("analysis-dialog-dark"); await escape();
  await navigate("/", 1440, 1000, "light", ready); await audit("briefing-1440-light"); await screenshot("briefing-1440-light.png");
  await browser.click(".ds-analysis-trigger"); await browser.waitFor("document.querySelector('dialog.analysis-dialog')?.open", "analysis dialog");
  check("analysis dialog receives focus", await browser.evaluate("document.querySelector('dialog.analysis-dialog').contains(document.activeElement)"));
  check("analysis dialog locks background scrolling", await browser.evaluate("document.body.style.overflow==='hidden' && document.documentElement.style.overflow==='hidden'"));
  await browser.evaluate("document.querySelector('dialog.analysis-dialog .briefing-icon-button').focus()"); await tab();
  check("native modal Tab reaches the checked radio", await browser.evaluate("document.activeElement.matches('input[type=radio]:checked')"));
  await tab(); check("native radio group Tab skips unchecked radios", await browser.evaluate("document.activeElement.matches('input[type=checkbox]')"));
  await browser.evaluate("document.querySelector('dialog.analysis-dialog .briefing-icon-button').focus();document.addEventListener('keydown',event=>{if(event.key==='Tab')event.stopImmediatePropagation();},{capture:true,once:true})"); await tab(true);
  report.nativeBackwardBoundary = await browser.evaluate("({tag:document.activeElement.tagName,text:document.activeElement.innerText,inside:document.querySelector('dialog.analysis-dialog').contains(document.activeElement)})");
  await browser.evaluate("document.querySelector('dialog.analysis-dialog .briefing-icon-button').focus()"); await tab(true);
  check("modal Shift-Tab boundary stays inside dialog", await browser.evaluate("document.querySelector('dialog.analysis-dialog').contains(document.activeElement) && document.activeElement.tagName==='A'"));
  await tab(); check("modal Tab boundary wraps to close control", await browser.evaluate("document.activeElement===document.querySelector('dialog.analysis-dialog .briefing-icon-button')"));
  await audit("analysis-dialog-light"); await screenshot("analysis-dialog-1440-light.png");
  await escape(); await browser.waitFor("!document.querySelector('dialog.analysis-dialog')", "Escape closes dialog");
  check("analysis dialog restores header button focus", await browser.evaluate("document.activeElement===document.querySelector('.ds-analysis-trigger')"));
  check("background scrolling restored after closing", await browser.evaluate("document.body.style.overflow!=='hidden' && document.documentElement.style.overflow!=='hidden'"));
  await navigate("/", 375, 1000, "light", ready); await audit("briefing-375-light"); await screenshot("briefing-375-light.png"); await screenshot("briefing-375-light-full.png", true);
  check("mobile detail stacks below comparison table", await browser.evaluate("document.querySelector('#briefing-detail').getBoundingClientRect().top>=document.querySelector('.briefing-comparison-card').getBoundingClientRect().bottom"));
  await navigate("/rank", 1440, 1000, "light", "document.querySelectorAll('[data-rank-code]').length===20 && document.querySelector('[data-candidate-production=unproduced]')");
  check("rank hides final columns in model-only state", await browser.evaluate("!document.querySelector('[data-value=finalRank], [data-value=finalPredictedReturn], [data-rank-signal=news]')"));
  await audit("rank-1440-light"); await screenshot("rank-1440-light.png");
  await navigate("/about", 1440, 1000, "light", "document.querySelector('.about-grid')"); await audit("about-1440-light"); await screenshot("about-1440-light.png");
  const aboutHtml = await readFile(new URL("../../dist/about/index.html", import.meta.url), "utf8");
  check("static about HTML includes model Top-5 flow and feature composition", aboutHtml.includes("브리핑에서 모델 Top-5를 비교하고") && aboutHtml.includes("볼린저 밴드 3") && aboutHtml.includes("모델·수급 2개"));
  await browser.settleInterceptions(); await recordPageRequests(); report.runAfter = await marker(); report.clicks = browser.clickDiagnostics;
  check("no analysis start clicks or non-GET API attempts", report.requestAudit.every(page => page.forbiddenClicks.length === 0 && page.requests.every(request => request.method === "GET")));
  check("saved run marker unchanged during browser verification", JSON.stringify(report.runBefore) === JSON.stringify(report.runAfter));
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked;
  check("console errors and runtime exceptions zero", browser.consoleErrors.length === 0 && browser.exceptions.length === 0);
  check("no non-GET or external requests", browser.blocked.length === 0);
} catch (error) { report.failure = error.stack; await recordPageRequests(); report.runAfter = await marker(); report.clicks = browser.clickDiagnostics; report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked; await screenshot("briefing-failure.png"); throw error; }
finally { await writeFile(new URL("briefing-verification.json", directory), JSON.stringify(report, null, 2)); await browser.close(); }
