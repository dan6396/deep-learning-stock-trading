// Exact replay: npm run build; node scripts/verify/m2-smoke.mjs
// Uses localhost fixture API exclusively. Artifacts describe fixtures, never broker data.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { startFixtureServer } from "./fixture-server.mjs";
import { launchBrowser, pause } from "./cdp-browser.mjs";

const require = createRequire(import.meta.url), axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const artifacts = fileURLToPath(new URL("../../artifacts/m2/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const fixture = await startFixtureServer(), browser = await launchBrowser(fixture.base);
const report = { fixtureOnly: true, generatedAt: new Date().toISOString(), checks: [], screenshots: [], axe: [], consoleErrors: [], exceptions: [], requests: [] };
const control = async change => { const response = await fetch(`${fixture.base}/_fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }); assert.equal(response.status, 200); };
const check = (label, value) => { assert.ok(value, label); report.checks.push(label); console.log(`PASS ${label}`); };
const text = () => browser.evaluate("document.querySelector('.briefing-page')?.innerText ?? ''");
async function navigate(path = "/next") {
  await browser.send("Page.navigate", { url: `${fixture.base}${path}` });
  await browser.waitFor("document.querySelector('.briefing-page h1')?.textContent === '오늘의 브리핑'", "briefing mounted");
}
async function populated() { await browser.waitFor("document.querySelectorAll('[data-candidate-code]').length === 5", "five candidates loaded"); }
async function detail(code) { await browser.waitFor(`document.querySelector('[data-detail-code="${code}"]') && document.querySelector('[data-detail-code="${code}"] [data-testid="detail-price"]')?.textContent !== '—'`, `detail ${code}`); }
async function audit(label) {
  await browser.evaluate(axe);
  const violations = await browser.evaluate(`axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(result=>result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})))`);
  report.axe.push({ label, violations }); check(`${label}: populated axe WCAG 2.2 AA`, violations.length === 0);
  const overflow = await browser.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth})");
  check(`${label}: no horizontal page overflow`, overflow.scroll <= overflow.width);
  const smallTargets = await browser.evaluate(`[...document.querySelectorAll("a[href],button,input,select,[tabindex='0']")].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<24||r.height<24)&&!(el.tagName==='A'&&getComputedStyle(el).display==='inline')}).map(el=>el.outerHTML)`);
  check(`${label}: pointer targets at least 24px`, smallTargets.length === 0);
  const headings = await browser.evaluate("[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(el=>el.getClientRects().length).map(el=>Number(el.tagName[1]))");
  check(`${label}: single first h1, no skipped heading levels`, headings[0] === 1 && headings.filter(level => level === 1).length === 1 && !headings.some((level, i) => i > 0 && level > headings[i - 1] + 1));
}

try {
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await control({ reset: true, stockDelays: { "005930": 1500 } }); await navigate(); await populated();
  check("public briefing has no manual analysis execution control", !(await browser.evaluate("[...document.querySelectorAll('button')].some(b=>/분석.*실행|실행.*분석/.test(b.textContent))")));
  await browser.click('[data-candidate-code="005930"] button');
  await browser.waitFor("location.search.includes('005930')", "A clicked");
  await pause(100);
  await browser.click('[data-candidate-code="000660"] button'); await detail("000660"); await pause(1600);
  check("rapid A→B / late A never replaces B", await browser.evaluate("document.querySelector('[data-detail-code]')?.dataset.detailCode === '000660' && document.querySelector('#detail-title')?.textContent === 'SK하이닉스'"));
  await browser.evaluate("document.querySelector('[data-candidate-code=\"000660\"] button').focus()");
  await browser.key("ArrowDown"); await detail("267250");
  check("ArrowDown moves selection and keyboard focus", await browser.evaluate("location.search.includes('267250') && document.activeElement.closest('[data-candidate-code]')?.dataset.candidateCode==='267250'"));
  await browser.evaluate("document.querySelector('[data-candidate-code=\"005930\"] button').focus()"); await browser.key("Enter"); await detail("005930");
  check("native Enter opens selection", await browser.evaluate("location.search.includes('005930')"));
  await browser.evaluate("document.querySelector('[data-candidate-code=\"000660\"] button').focus()"); await browser.key(" ", "Space"); await detail("000660");
  check("native Space opens selection", await browser.evaluate("location.search.includes('000660')"));
  await browser.evaluate("history.back()"); await detail("005930");
  check("browser back restores selected code", await browser.evaluate("location.search.includes('005930')"));
  await browser.send("Page.reload", { ignoreCache: true }); await populated(); await detail("005930");
  check("reload preserves selected deeplink", await browser.evaluate("location.search.includes('005930')"));
  await browser.click('button[aria-label="종목 상세 닫기"]');
  await browser.waitFor("!location.search.includes('code=')", "panel closed");
  check("close restores focus to selected table button", await browser.evaluate("document.activeElement.closest('[data-candidate-code]')?.dataset.candidateCode==='005930'"));
  await browser.click('button[aria-label="서비스 안내 닫기"]');
  await browser.send("Page.reload", { ignoreCache: true }); await populated();
  check("intro dismissal persists across reload", await browser.evaluate("!document.querySelector('[aria-label=\"서비스 첫 방문 안내\"]')"));
  await browser.click('button[aria-label="밝은 테마로 전환"]'); await browser.send("Page.reload", { ignoreCache: true }); await populated();
  check("theme choice persists across reload", await browser.evaluate("document.documentElement.dataset.theme==='light'"));

  await control({ reset: true, candidatesDelayMs: 1000 }); await navigate("/next?code=005930"); await detail("005930");
  check("pending deeplink membership and model fail closed", await browser.evaluate("document.querySelector('[data-membership]')?.dataset.membership==='pending' && document.querySelector('.briefing-detail-signals [data-signal]')?.dataset.signal==='unavailable'"));
  await populated();
  await control({ scenario: "error", candidatesDelayMs: 0 }); await browser.click('.briefing-title-row button');
  await browser.waitFor("document.querySelector('[data-membership]')?.dataset.membership==='unknown'", "background membership unknown");
  check("failed refresh makes previous table/panel membership unavailable", await browser.evaluate("document.querySelector('[data-candidate-code=\"005930\"] [data-signal]')?.dataset.signal==='unavailable' && document.querySelector('.briefing-detail-signals [data-signal]')?.dataset.signal==='unavailable'"));
  await navigate("/next?code=005930"); await detail("005930");
  await browser.waitFor("document.querySelector('[data-membership]')?.dataset.membership==='unknown'", "initial error membership unknown");
  check("error deeplink never claims non-candidate", !(await text()).includes("최종 후보 외 종목"));
  await control({ scenario: "empty" }); await browser.click('.briefing-title-row button');
  await browser.waitFor("document.querySelector('[data-membership]')?.dataset.membership==='nonCandidate'", "successful empty list establishes non-membership");
  check("successful [] establishes genuine non-membership", (await text()).includes("최종 후보 외 종목"));

  await control({ reset: true, lazyDelayMs: 1300 }); await navigate(); await populated();
  await browser.click('nav a[href="/next/rank"]');
  await browser.waitFor("document.querySelector('.rank-page h1')?.textContent === '전체 순위'", "delayed lazy rank route mounted");
  await browser.waitFor("document.activeElement.id === 'main-content'", "late route main focus");
  check("main receives focus after lazy mount beyond 30 frames", await browser.evaluate("document.activeElement.dataset.routePath==='/next/rank'"));
  await browser.click('nav a[href="/next"]'); await populated();

  await control({ scenario: "empty" }); await browser.click('.briefing-title-row button');
  await browser.waitFor("document.querySelector('.briefing-empty')?.textContent.includes('최종 후보가 없습니다')", "authoritative empty result");
  check("authoritative [] replaces populated table", await browser.evaluate("document.querySelectorAll('[data-candidate-code]').length===0"));
  await control({ scenario: "error" }); await browser.click('.briefing-title-row button');
  await browser.waitFor("document.body.innerText.includes('후보 갱신 실패')", "background empty error");
  check("background failure explicitly retains previous result", (await text()).includes("이전 조회 결과"));
  await navigate();
  await browser.waitFor("document.body.innerText.includes('후보 조회 실패')", "initial error");
  check("initial API error has no fabricated empty success/sample table", await browser.evaluate("!document.querySelector('.briefing-table') && !document.body.innerText.includes('최종 후보가 없습니다')"));
  await control({ scenario: "sample" }); await browser.click('.briefing-title-row button'); await populated();
  check("sample response explicitly labelled", (await text()).includes("예시 데이터 · 실제 분석 결과가 아닙니다"));
  await control({ scenario: "populated" }); await browser.click('.briefing-title-row button'); await populated();
  await control({ scenario: "error", indicesFail: true }); await browser.click('.briefing-title-row button');
  await browser.waitFor("document.body.innerText.includes('이전 조회 결과 · 후보 갱신 실패')", "previous populated results on error");
  check("populated background failure keeps candidates with warning", await browser.evaluate("document.querySelectorAll('[data-candidate-code]').length===5"));
  await browser.waitFor("document.body.innerText.includes('지수 갱신 실패')", "index background warning");

  await control({ reset: true, analysis: "running" }); await navigate("/next?code=005930"); await populated(); await detail("005930");
  await browser.waitFor("document.body.innerText.includes('서버 분석 진행 중')", "GET status reattached");
  await control({ candidatesDelayMs: 1400 }); await browser.click('.briefing-title-row button'); await pause(120);
  await control({ candidatesDelayMs: 0, analysis: "completed", version: 2 });
  await browser.waitFor("document.querySelector('.briefing-summary')?.textContent.includes('갱신 후 결과')", "completion invalidated detail", 16000);
  check("running→completed GET polling invalidates and defeats older refresh", await browser.evaluate("document.querySelector('[data-candidate-code=\"005930\"]')?.textContent.includes('+4.12%')"));
  await pause(1500);
  check("late prior refresh cannot restore older candidate prediction", await browser.evaluate("document.querySelector('[data-candidate-code=\"005930\"]')?.textContent.includes('+4.12%')"));
  const requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
  const pollCount = requests.filter(request => request.path === "/api/candidates/run").length;
  await pause(5200);
  const after = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
  check("polling stops after completion", after.filter(request => request.path === "/api/candidates/run").length === pollCount);

  await control({ reset: true }); await navigate("/next?code=005380"); await populated(); await detail("005380");
  check("missing model prediction remains — and unavailable, no prose zero", await browser.evaluate("document.querySelector('[data-detail-code]')?.textContent.includes('원본 모델 예측값이 없습니다') && !document.querySelector('[data-detail-code]')?.textContent.includes('Huber 예상수익률 0.00%')"));
  await navigate("/next?code=005930"); await populated(); await detail("005930");
  check("cache/sample and interpolation stay visible per index", (await text()).includes("시계열: 보간값 · 실제 이력 아님") && (await text()).includes("시계열: 과거 관측값"));
  check("model table and panel share final candidate membership", await browser.evaluate("document.querySelector('[data-candidate-code=\"005930\"] [data-signal]')?.dataset.signal==='positive' && document.querySelector('.briefing-detail-signals [data-signal]')?.dataset.signal==='positive'"));
  check("no invented record count/next-session date", !(await text()).match(/\d+\/20/) && (await text()).includes("다음 거래일\n미확인"));
  await browser.click('.briefing-rules summary');
  check("rule explanation and version are disclosed", (await text()).includes("m1-2026-10-08-v2") && (await text()).includes("개별 양수일수"));
  await browser.click('.briefing-rules summary');

  for (const width of [1440, 1280]) for (const theme of ["dark", "light"]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate(`localStorage.removeItem('kospi-briefing-intro.v1');localStorage.setItem('kospi-theme.v1',${JSON.stringify(theme)})`);
    await navigate("/next?code=005930"); await populated(); await detail("005930");
    await browser.evaluate("document.fonts.ready"); await audit(`${width}-${theme}`);
    const layout = await browser.send("Page.getLayoutMetrics");
    const capture = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(2500, Math.ceil(layout.cssContentSize.height)), scale: 1 } });
    const name = `m2-${width}-${theme}.png`; await writeFile(resolve(artifacts, name), Buffer.from(capture.data, "base64")); report.screenshots.push({ name, width, theme, fixture: true });
  }
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate("/next?code=005930"); await populated(); await detail("005930"); await audit("375-light-stacked");
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked;
  await browser.settleInterceptions();
  check("zero page console.error and unhandled exceptions", !browser.consoleErrors.length && !browser.exceptions.length);
  report.requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
  check("all product API requests are GET against fixture server", report.requests.every(request => request.method === "GET" && !request.blocked));
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack;
  console.error(error.message); process.exitCode = 1;
} finally {
  try { await browser.settleInterceptions(); }
  catch (error) { report.passed = false; report.diagnosticFailure = error.message; process.exitCode = 1; }
  report.consoleErrors = browser.consoleErrors; report.exceptions = browser.exceptions; report.blocked = browser.blocked;
  report.cancelledInterceptions = browser.cancelledInterceptions; report.interceptionErrors = browser.interceptionErrors;
  try {
    report.requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
    report.page = await browser.evaluate("({url:location.href,selectedCode:new URLSearchParams(location.search).get('code'),detailCode:document.querySelector('[data-detail-code]')?.dataset.detailCode,price:document.querySelector('[data-testid=detail-price]')?.textContent,activeElement:document.activeElement?.outerHTML,text:document.body.innerText})");
    if (!report.passed) {
      const capture = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await writeFile(resolve(artifacts, "failure.png"), Buffer.from(capture.data, "base64")); report.failureScreenshot = "failure.png";
    }
  } catch (error) { report.diagnosticFailure = error.message; }
  await writeFile(resolve(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(artifacts, "README.md"), "# M2 fixture 브라우저 검증\n\n스크린샷과 report.json은 localhost의 결정적 fixture 결과입니다. 실제 시장·브로커·유료 분석 데이터를 검증하지 않습니다.\n\n재실행: FE에서 `npm run build` 후 `node scripts/verify/m2-smoke.mjs`. 기존 Edge/Chrome을 사용하며 외부 네트워크와 제품 POST 요청을 차단합니다.\n");
  await browser.close(); await fixture.close();
  console.log(`Artifacts: FE/artifacts/m2/ · ${report.passed ? "ALL PASSED" : "FAILED"}`);
}
