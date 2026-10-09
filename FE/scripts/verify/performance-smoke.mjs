import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser } from "./cdp-browser.mjs";
const live = process.argv.includes("--live"), fixture = live ? null : await startFixtureServer();
const base = fixture?.base ?? "http://127.0.0.1:5173", browser = await launchBrowser(base);
const directory = fileURLToPath(new URL("../../artifacts/performance/", import.meta.url));
await mkdir(directory, { recursive: true });
const axe = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const report = { live, generatedAt: new Date().toISOString(), checks: [], axe: [], screenshots: [] };
function check(label, result) { assert.ok(result, label); report.checks.push(label); console.log(`PASS ${label}`); }
try {
  for (const [width, theme] of [[1440, "dark"], [375, "light"]]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.send("Page.navigate", { url: base });
    await browser.waitFor("document.querySelector('.analysis-control')", "analysis control");
    await browser.evaluate(`localStorage.setItem('kospi-theme.v1',${JSON.stringify(theme)});document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)})`);
    for (const path of ["/", "/history", "/rank"]) {
      await browser.send("Page.navigate", { url: `${base}${path}` });
      await browser.waitFor("document.querySelector('#main-content')?.dataset.routePath===location.pathname", "route hydrated");
      if (path !== "/rank") await browser.waitFor("document.querySelector('.performance-reason')", "performance response");
      else await browser.waitFor("document.querySelector('tbody tr')", "rank response");
      check(`${path} ${width}: no horizontal overflow`, await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
      if (path === "/") check(`${width}: explicit official intent checkbox`, await browser.evaluate("Array.from(document.querySelectorAll('label')).some(el=>el.textContent.includes('공식 성과 기록 요청')&&el.querySelector('input[type=checkbox]'))"));
      if (path === "/history") {
        check(`${width}: collection button and truthful missing-results reason`, await browser.evaluate("document.querySelector('.performance-collect')?.textContent.includes('실제 가격 수집')&&document.querySelector('.performance-reason')?.textContent.length>10"));
        if (live) check(`${width}: persistent run identifier shown`, await browser.evaluate("document.querySelector('.performance-run-id')?.textContent.includes('실행 식별자')"));
        await browser.evaluate(axe);
        const audit = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
        report.axe.push({ width, theme, violations: audit }); check(`${width}: history automated WCAG AA`, audit.length === 0);
      }
      const metrics = await browser.send("Page.getLayoutMetrics"), name = `${path === "/" ? "briefing" : path.slice(1)}-${width}-${theme}.png`;
      const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
      await writeFile(`${directory}/${name}`, Buffer.from(shot.data, "base64")); report.screenshots.push(name);
    }
  }
  await browser.settleInterceptions();
  check("no browser exceptions", browser.exceptions.length === 0);
  check("no console errors", browser.consoleErrors.length === 0);
  check("no intercepted write requests", browser.blocked.filter(row => row.reason === "non-GET API").length === 0);
} finally {
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions;
  await writeFile(`${directory}/verification.json`, JSON.stringify(report, null, 2));
  await browser.close(); await fixture?.close();
}
