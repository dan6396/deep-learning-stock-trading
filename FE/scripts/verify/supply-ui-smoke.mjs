// Local fixtures and a read-only saved /api/rank snapshot. Never launches analysis.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { startFixtureServer, candidateFixture, fixtureCodes } from "./fixture-server.mjs";
import { launchBrowser } from "./cdp-browser.mjs";

const artifacts = fileURLToPath(new URL("../../artifacts/supply-ui-removal/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const require = createRequire(import.meta.url), axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const fixture = await startFixtureServer(), browser = await launchBrowser(fixture.base);
const report = { fixtureOnly: true, checks: [], screens: [], storedRank: null, exceptions: [], limitations: [
  "화면 검증은 로컬 fixture 서버에서 수행했습니다. 저장 TOP5는 localhost /api/rank 읽기 전용 GET으로 보관한 응답을 fixture에 주입했습니다. 실제 서버에 연결한 화면 동작과 새 분석 실행은 검증하지 않았습니다.",
  "script failure 없음은 스크립트 완주를 뜻하며 모든 axe 검사가 통과했다는 뜻이 아닙니다.",
  "legacy 브랜드 링크 이름 불일치와 시장 국면 배지 색 대비는 이번 diff의 해당 aria/CSS 변경과 관련이 없습니다. 기존 문제로 추정하지만 baseline 브라우저 검증은 하지 않아 기준선은 미확인입니다.",
] };
const check = (label, condition) => { assert.ok(condition, label); report.checks.push(label); console.log(`PASS ${label}`); };
const save = () => writeFile(`${artifacts}browser-report.json`, JSON.stringify(report, null, 2));
async function control(change) {
  const response = await fetch(`${fixture.base}/_fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
  assert.equal(response.status, 200);
}
async function navigate(path, selector) {
  await browser.send("Page.navigate", { url: `${fixture.base}${path}` });
  await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})`, `${path} mounted`);
  await browser.waitFor("document.fonts.status==='loaded'", "fonts loaded");
}
async function capture(name, width, theme) {
  await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await browser.evaluate(`localStorage.setItem('kospi-theme.v1',${JSON.stringify(theme)}); document.documentElement.dataset.theme=${JSON.stringify(theme)}; window.scrollTo(0,0)`);
  const overflow = await browser.evaluate("document.documentElement.scrollWidth > innerWidth + 1");
  await browser.evaluate(axe);
  const violations = await browser.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(result=>result.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})))");
  const metrics = await browser.send("Page.getLayoutMetrics");
  const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
  const pixels = Buffer.from(shot.data, "base64");
  await writeFile(`${artifacts}${name}.png`, pixels);
  report.screens.push({ name, width, theme, overflow, violations, screenshot: `${name}.png`, md5: createHash("md5").update(pixels).digest("hex") });
  console.log(`${overflow || violations.length ? "ISSUE" : "PASS"} ${name}: overflow=${overflow}, axe=${violations.length}`);
  await save();
}
try {
  const rows = fixtureCodes.map((code, index) => {
    const row = candidateFixture(code); row.input_row.pred_rank = index + 1;
    row.input_row.ensemble_pred_return = [.01, .009, 0, -.001, .005][index];
    return row;
  });
  await control({ rankRows: rows, backendScenario: "model_only" });
  await navigate("/", ".briefing-dashboard");
  await browser.waitFor("document.querySelectorAll('[data-model-code]').length===5 && document.querySelector('.briefing-summary-prediction')?.innerText.includes('예측값 양수 3종목')", "TOP5 summary ready");
  check("summary uses displayed mixed-sign original TOP5", await browser.evaluate("document.querySelector('.briefing-summary-prediction').innerText.includes('-0.10% ~ +1.00%')"));
  check("briefing keeps model and removes supply and agreement", await browser.evaluate("!!document.querySelector('[data-detail-evidence=model]') && !document.querySelector('[data-detail-evidence=supply],.briefing-evidence-agreement') && !document.querySelector('.briefing-detail').innerText.includes('외국인')"));
  const before = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
  check("summary adds no candidate, prediction, or launch requests", !before.some(request => request.path === "/api/candidates" || request.path === "/api/stock-analysis" || request.method !== "GET"));
  await browser.click('[data-model-code="005930"] [data-watch-code]');
  check("watch action still works", await browser.evaluate("localStorage.getItem('kospi-watchlist.v1').includes('005930')"));
  await capture("briefing-1440-light", 1440, "light");
  await capture("briefing-1440-dark", 1440, "dark");
  await capture("briefing-375-light", 375, "light");
  await capture("briefing-375-dark", 375, "dark");
  const mixedDate = structuredClone(rows); mixedDate[4].input_row.prediction_base_date = "2026-10-06";
  await control({ rankRows: mixedDate }); await navigate("/", ".briefing-dashboard");
  await browser.waitFor("document.querySelector('.briefing-summary-prediction')?.innerText.includes('분석 기준일·예측 기간 불일치')", "mixed date hidden");
  check("mixed-date range is withheld", await browser.evaluate("document.querySelector('.briefing-summary-prediction strong').innerText==='—'"));
  await control({ rankRows: rows.slice(0, 4) }); await navigate("/", ".briefing-dashboard");
  await browser.waitFor("document.querySelector('.briefing-summary-prediction')?.innerText.includes('TOP5 미완성')", "partial top five hidden");
  check("partial TOP5 range is withheld", await browser.evaluate("document.querySelector('.briefing-summary-prediction strong').innerText==='—'"));
  await control({ rankRows: rows, rankScenario: "error" }); await navigate("/", ".briefing-dashboard");
  await browser.waitFor("document.querySelector('.briefing-summary-prediction')?.innerText.includes('모델 예측 조회 실패')", "failed rank hidden");
  check("failed rank request has no range", await browser.evaluate("document.querySelector('.briefing-summary-prediction strong').innerText==='—'"));
  await control({ rankScenario: "populated" });
  const description = (await readFile(new URL("../../src/features/about/AboutContent.tsx", import.meta.url), "utf8")).match(/ABOUT_DESCRIPTION = "([^"]+)"/)[1];
  check("all HTML description tags match service introduction", await browser.evaluate(`[...document.querySelectorAll('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]')].every(el=>el.content===${JSON.stringify(description)})`));
  const routes = [
    ["rank", "/rank", "[data-rank-code]"],
    ["report", "/stock/005930", "[data-report-signal=model]"],
    ["watchlist", "/watchlist", "[data-rank-code]"],
    ["about", "/about", ".about-grid"],
    ["history", "/history", ".history-page"],
    ["legacy-landing", "/legacy", "#top .hero-section"],
    ["legacy-dashboard", "/legacy/dashboard", ".ai-brief"],
    ["legacy-report", "/legacy/stock/005930", ".report-dashboard"],
  ];
  for (const [name, path, selector] of routes) {
    if (name === "history") await control({ analysis: "failed", analysisProgressMessage: "외국인·기관 수급 조회 중", analysisError: "기관 순매수 조회 실패" });
    await navigate(path, selector);
    if (name === "history") {
      await browser.waitFor("document.querySelector('.history-facts')?.innerText.includes('분석 데이터 처리 중')", "history progress filtered");
      check("history progress and error omit retired evidence", await browser.evaluate("!document.querySelector('.history-facts').innerText.match(/수급|순매수/) && document.querySelector('.history-facts').innerText.includes('분석 기록을 확인해 주세요.')"));
    }
    check(`${path}: no retired supply/agreement widgets`, await browser.evaluate("!document.querySelector('[data-rank-signal=supply],[data-report-signal=supply],.report-agreement,.report-supply-panel,.supply-row,.briefing-evidence-agreement') && ![...document.querySelectorAll('th,h2,dt,.metric-tile__label')].some(el=>/수급|일치도|외국인 합계|기관 합계/.test(el.innerText))"));
    for (const width of [1440, 375]) for (const theme of ["light", "dark"]) await capture(`${name}-${width}-${theme}`, width, theme);
  }
  // The generated sample record is preserved; only the legacy analysis prose is hidden.
  await control({ stockScenario: "null" });
  await navigate("/legacy/stock/007660", ".reco-reason");
  await browser.waitFor("!document.querySelector('.detail-source-flag')?.innerText.includes('동기화 중')", "saved sample ready");
  check("legacy saved sample commentary omits investor flows", await browser.evaluate("!document.querySelector('.reco-reason').innerText.match(/수급|순매수|순매도|매수세|매도세|매물 출회/) && document.querySelector('.reco-reason').innerText.includes('하반기 실적 개선')"));
  const sampleText = await readFile(new URL("../../src/data/aiCandidates.ts", import.meta.url), "utf8");
  const sample = JSON.parse(sampleText.slice(sampleText.indexOf("= [") + 2, sampleText.lastIndexOf("];") + 1)).find(row => row.ticker === "007660");
  const articleTitles = await browser.evaluate("[...document.querySelectorAll('.ai-news-list__title')].map(el=>el.textContent).sort()");
  check("legacy article titles stay unchanged", JSON.stringify(articleTitles) === JSON.stringify(sample.news.map(row => row.title).sort()));
  const articleDescriptions = await browser.evaluate("[...document.querySelectorAll('.ai-news-list__desc')].map(el=>el.textContent).sort()");
  check("legacy original article descriptions stay unchanged", JSON.stringify(articleDescriptions) === JSON.stringify(sample.news.map(row => row.description).filter(Boolean).sort()));
  await capture("legacy-saved-commentary-375-light", 375, "light");
  await control({ stockScenario: "populated", analysis: "idle", analysisProgressMessage: null, analysisError: null });
  const stored = JSON.parse(await readFile(`${artifacts}stored-rank.json`, "utf8"));
  await control({ rankRows: stored, backendScenario: "model_only" }); await navigate("/", ".briefing-dashboard");
  await browser.waitFor("document.querySelector('.briefing-summary-prediction')?.innerText.includes('예측값 양수 5종목')", "stored TOP5 ready");
  report.storedRank = await browser.evaluate("({codes:[...document.querySelectorAll('[data-model-code]')].map(el=>el.dataset.modelCode),summary:document.querySelector('.briefing-summary-prediction').innerText})");
  check("stored TOP5 summary is +0.38% to +0.40%", report.storedRank.summary.includes("+0.38% ~ +0.40%"));
  check("stored TOP5 uses the correct five stocks", report.storedRank.codes.join(",") === "001800,029780,000270,007070,323410");
  await capture("stored-top5-1440-light", 1440, "light");
  await capture("stored-top5-375-dark", 375, "dark");
  await browser.settleInterceptions();
  report.exceptions = browser.exceptions; report.consoleErrors = browser.consoleErrors;
  check("browser has no script exceptions", browser.exceptions.length === 0);
  const requests = await (await fetch(`${fixture.base}/_fixture/requests`)).json();
  check("no product POST or real analysis ran", !requests.some(request => request.method !== "GET"));
  report.themeChecks = report.screens.filter(screen => screen.theme === "light" && screen.name.startsWith("legacy-")).map(light => {
    const dark = report.screens.find(screen => screen.name === light.name.replace(/-light$/, "-dark"));
    return { page: light.name.replace(/-light$/, ""), identical: dark ? light.md5 === dark.md5 : null };
  });
  if (report.themeChecks.some(check => check.identical)) report.limitations.push("legacy 라이트·다크 캡처의 MD5가 같습니다. 테마 미지원 또는 테마 적용 실패로 실제 별도 다크 화면을 검증하지 못했습니다.");
} catch (error) { report.failure = error.stack; throw error; }
finally { await save(); await browser.close(); await fixture.close(); }
