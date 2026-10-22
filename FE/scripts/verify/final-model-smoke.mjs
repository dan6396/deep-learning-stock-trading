// Exercise only the current UI using local rank-score fixtures. No live APIs.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser } from "./cdp-browser.mjs";

const output = fileURLToPath(new URL("../../../outputs/ui-verification/final-model/", import.meta.url));
await mkdir(output, { recursive: true });
const fixture = await startFixtureServer();
const browser = await launchBrowser(fixture.base);
const report = { fixtureOnly: true, passed: false, checks: [], screenshots: [] };
const check = (label, condition) => { assert.ok(condition, label); report.checks.push(label); console.log(`PASS ${label}`); };
try {
  for (const [path, selector, width, theme, name] of [
    ["/", ".briefing-dashboard", 1440, "dark", "briefing-desktop"],
    ["/", ".briefing-dashboard", 375, "light", "briefing-mobile"],
    ["/rank", ".rank-page", 1440, "light", "rank-desktop"],
    ["/stock/005930", ".stock-report", 1440, "light", "stock-desktop"],
    ["/history", ".history-page", 1440, "dark", "history-desktop"],
    ["/about", ".about-page", 375, "light", "about-mobile"],
  ]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.send("Page.navigate", { url: fixture.base+path });
    await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})`, `${name} mounted`);
    await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await browser.waitFor("document.fonts.status === 'loaded'", "fonts ready");
    if (path === "/") {
      await browser.waitFor("document.querySelectorAll('[data-model-code]').length === 5", "five model ranks");
      check(`${name} displays rank score without direction claims`, await browser.evaluate("[...document.querySelectorAll('.briefing-top-prediction [data-direction]')].every(el => el.dataset.direction === 'relative')"));
    }
    if (path === "/stock/005930") {
      await browser.waitFor("document.querySelector('[data-testid=report-prediction]')?.textContent.includes('1.500000')", "final rank score");
      check("stock rank score is not a percent", await browser.evaluate("!document.querySelector('[data-testid=report-prediction]').textContent.includes('%')"));
    }
    check(`${name} has one main heading`, await browser.evaluate("document.querySelectorAll('h1').length === 1"));
    check(`${name} has no horizontal page overflow`, await browser.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
    const metrics = await browser.send("Page.getLayoutMetrics");
    const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
    await writeFile(`${output}${name}.png`, Buffer.from(shot.data, "base64")); report.screenshots.push(`${name}.png`);
  }
  await browser.settleInterceptions();
  check("no browser script exceptions", browser.exceptions.length === 0);
  check("no POST/API execution was triggered", fixture.requests.every(request => request.method === "GET"));
  report.passed = true;
} finally {
  report.exceptions = browser.exceptions;
  await writeFile(`${output}report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await fixture.close();
}
