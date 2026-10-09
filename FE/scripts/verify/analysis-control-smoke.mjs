import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser } from "./cdp-browser.mjs";

// All requests use a local fixture. This never starts Python or a paid API call.
const fixture = await startFixtureServer();
const handlers = fixture.server.listeners("request");
let launches = 0;
const launchModes = [];
async function control(change) {
  const response = await fetch(`${fixture.base}/_fixture/control`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change),
  });
  assert.equal(response.status, 200);
}
fixture.server.removeAllListeners("request");
fixture.server.on("request", (request, response) => {
  const url = new URL(request.url, fixture.base);
  if (request.method === "GET" && url.pathname === "/_fixture/analysis-launch") {
    launches++;
    const mode = url.searchParams.get("mode");
    launchModes.push(mode);
    void control({ analysis: "running" }).then(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "running", mode, elapsedMs: 0, progress: { progressPercent: 12, message: "검증용 분석 시작" } }));
    });
    return;
  }
  for (const handler of handlers) handler.call(fixture.server, request, response);
});
const browser = await launchBrowser(fixture.base);
const artifactDir = "artifacts/analysis-modes";
const report = { checks: [], launches: 0, consoleErrors: [], exceptions: [], accessibility: [] };
function check(label, result) { assert.ok(result, label); report.checks.push(label); }
try {
  await mkdir(artifactDir, { recursive: true });
  // The shared browser blocks every product POST. Map only the launch intent to
  // a fixture GET, keeping its external-network and non-GET guards intact.
  // Component tests separately assert the production POST method and path.
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const fixtureFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/candidates/run' && init?.method === 'POST') {
        return fixtureFetch('/_fixture/analysis-launch'+url.search, {...init, method:'GET'});
      }
      return fixtureFetch(input, init);
    };
  ` });
  await control({ backendScenario: "model_only", analysis: "idle" });
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.navigate", { url: fixture.base });
  await browser.waitFor("document.querySelector('.analysis-start-button') && !document.querySelector('.analysis-start-button').disabled", "launch ready");
  check("mount never launches analysis", launches === 0);
  await browser.click('input[value="full"]');
  check("missing news settings disables launch", await browser.evaluate("document.querySelector('.analysis-start-button').disabled"));
  check("selecting a mode does not launch", launches === 0);
  await browser.evaluate('document.querySelector(\'input[value="full"]\').focus()');
  await browser.key("ArrowUp");
  check("keyboard changes mode", await browser.evaluate('document.querySelector(\'input[value="model_only"]\').checked'));
  await browser.evaluate("document.querySelector('.analysis-start-button').focus()");
  check("launch button receives keyboard focus", await browser.evaluate("document.activeElement.matches('.analysis-start-button')"));
  await browser.key("Enter");
  await browser.waitFor("document.querySelector('.analysis-start-button').textContent.includes('분석 진행 중')", "analysis running");
  check("keyboard activation launches exactly once", launches === 1);
  check("model mode is transmitted", launchModes[0] === "model_only");
  check("mode selection is locked while running", await browser.evaluate("document.querySelector('.analysis-mode-picker').disabled"));
  check("running launch is disabled", await browser.evaluate("document.querySelector('.analysis-start-button').disabled"));
  await control({ analysis: "completed", version: 2 });
  await browser.waitFor("document.querySelector('.analysis-control-status').textContent.includes('모델 분석 완료')", "poll completion");
  check("model-only completion links to whole rank", await browser.evaluate("document.querySelector('.analysis-control-links a[href=\"/rank\"]') !== null"));
  await browser.send("Runtime.evaluate", { expression: await readFile("node_modules/axe-core/axe.min.js", "utf8") });
  for (const [theme, width, height] of [["dark", 1440, 1000], ["light", 375, 812]]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    await browser.evaluate("document.querySelector('.analysis-control').scrollIntoView({block:'center',behavior:'instant'})");
    const layout = await browser.evaluate("(() => {const card=document.querySelector('.analysis-control').getBoundingClientRect(), button=document.querySelector('.analysis-start-button').getBoundingClientRect(); return {card:{left:card.left,right:card.right},button:{left:button.left,right:button.right,height:button.height},width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth, reduced: getComputedStyle(document.querySelector('.analysis-spinner') || document.querySelector('.analysis-start-button')).animationName}})()");
    check(`${theme} ${width}px: no horizontal overflow`, !layout.overflow && layout.card.left >= 0 && layout.card.right <= width);
    check(`${theme} ${width}px: accessible button size`, layout.button.height >= 44 && layout.button.right <= layout.card.right);
    const accessibility = await browser.evaluate("(async () => (await axe.run(document.querySelector('.analysis-control'), {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})))()");
    report.accessibility.push({ theme, width, violations: accessibility });
    check(`${theme} ${width}px: axe WCAG A/AA`, accessibility.length === 0);
    const screenshot = await browser.send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${artifactDir}/${theme}-${width}.png`, Buffer.from(screenshot.data, "base64"));
  }
  await control({ backendScenario: "news_ready", analysis: "idle" });
  await browser.send("Page.navigate", { url: `${fixture.base}/next` });
  await browser.waitFor("document.querySelector('.analysis-control-description')?.textContent.includes('Gemini 유료')", "paid mode description");
  await browser.evaluate("document.documentElement.dataset.theme = 'light'");
  check("full mode displays paid-call notice before launch", launches === 1);
  check("preview alias preserves history link", await browser.evaluate("document.querySelector('.analysis-control-links a[href=\"/next/history\"]') !== null"));
  await browser.click('input[value="model_only"]');
  check("server full default can be overridden", await browser.evaluate('document.querySelector(\'input[value="model_only"]\').checked'));
  await browser.click('input[value="full"]');
  await browser.send("Runtime.evaluate", { expression: await readFile("node_modules/axe-core/axe.min.js", "utf8") });
  const newsA11y = await browser.evaluate("(async () => (await axe.run(document.querySelector('.analysis-control'), {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id))()");
  check("news selection passes accessibility checks", newsA11y.length === 0);
  const newsScreenshot = await browser.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${artifactDir}/news-light-375.png`, Buffer.from(newsScreenshot.data, "base64"));
  await browser.click('.analysis-start-button');
  await browser.waitFor("document.querySelector('.analysis-start-button').textContent.includes('분석 진행 중')", "news running");
  check("news mode is transmitted exactly once", launches === 2 && launchModes[1] === "full");
  await browser.settleInterceptions();
  check("no browser exceptions", browser.exceptions.length === 0);
  check("no console errors", browser.consoleErrors.length === 0);
  report.launches = launches;
  report.launchModes = launchModes;
  report.consoleErrors = browser.consoleErrors;
  report.exceptions = browser.exceptions;
  await writeFile(`${artifactDir}/verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await fixture.close();
}
