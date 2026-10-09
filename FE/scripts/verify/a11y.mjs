// Accessibility smoke check for the running dev server, driven over the Chrome
// DevTools Protocol (Edge/Chrome headless). For each page × theme × width it
// runs axe-core (WCAG 2.2 AA), and checks for horizontal overflow, pointer
// targets under 24px (WCAG 2.5.8) and a single, first-level h1.
//
// Usage: node scripts/verify/a11y.mjs [baseUrl] [path ...]
//   defaults: http://localhost:5173  /next /next/rank /next/watchlist /next/history /next/stock/000270
// Env: BROWSER=<path to msedge/chrome executable>
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const [baseArg, ...pathArgs] = process.argv.slice(2);
const BASE = baseArg ?? "http://localhost:5173";
const PATHS = pathArgs.length ? pathArgs : ["/next", "/next/rank", "/next/watchlist", "/next/history", "/next/stock/000270"];
const BROWSER = process.env.BROWSER ?? [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
].find((candidate) => existsSync(candidate));
if (!BROWSER) {
  console.error("No Edge/Chrome found; set BROWSER=<executable path>.");
  process.exit(2);
}

const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "a11y-"));
const browser = spawn(BROWSER, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ws;
for (let i = 0; i < 50 && !ws; i += 1) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {
    // Browser still starting.
  }
  if (!ws) await sleep(200);
}
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

let failures = 0;
const report = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
};

await send("Page.enable");
await send("Runtime.enable");
// Settle entrance animations so contrast is measured on final colours.
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

try {
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const theme of ["dark", "light"]) {
      for (const path of PATHS) {
        await send("Page.navigate", { url: `${BASE}${path}` });
        await sleep(1500);
        await evaluate(`localStorage.setItem("kospi-theme.v1", ${JSON.stringify(theme)}); document.documentElement.dataset.theme = ${JSON.stringify(theme)};`);
        await sleep(300);
        const label = `[${width} ${theme}] ${path}`;

        await evaluate(AXE);
        const violations = await evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })
          .then((r) => r.violations.map((v) => v.id + " (" + v.nodes.length + "x): " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`);
        report(`${label} axe WCAG 2.2 AA`, violations.length === 0, violations.join("\n        "));

        const overflow = await evaluate("({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })");
        report(`${label} no horizontal overflow`, overflow.sw <= overflow.iw, `${overflow.sw}/${overflow.iw}`);

        const small = await evaluate(`[...document.querySelectorAll("a[href], button, input, select, [role=option], [tabindex='0']")]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24); })
          .filter((el) => !(el.tagName === "A" && getComputedStyle(el).display === "inline"))
          .map((el) => (String(el.className) || el.tagName).slice(0, 40) + " " + Math.round(el.getBoundingClientRect().width) + "x" + Math.round(el.getBoundingClientRect().height))`);
        report(`${label} pointer targets >= 24px`, small.length === 0, small.slice(0, 5).join(", "));

        const headings = await evaluate(`[...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => h.getClientRects().length).map((h) => Number(h.tagName[1]))`);
        const skipped = headings.some((level, i) => i > 0 && level > headings[i - 1] + 1);
        report(`${label} single h1 first, no skipped levels`, headings[0] === 1 && headings.filter((l) => l === 1).length === 1 && !skipped, JSON.stringify(headings));
      }
    }
  }
} catch (error) {
  report("script error", false, error.message);
} finally {
  ws.close();
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} failing check(s)`}`);
  process.exit(failures ? 1 : 0);
}
