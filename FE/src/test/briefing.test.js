import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBriefingInput, createBriefingService, formatSupplyWon } from "../../server/briefing";
import { MACRO_UNIVERSE } from "../../server/marketMacro";
import { briefingInputHash, templateNarrative, createNarrativeStore, isTargetSessionCaution, targetSessionCautionText } from "../../server/briefingNarrative";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { buildBriefingComposition } from "../../server/briefingComposition";
afterEach(() => vi.useRealTimers());

const marker = { status: "completed", mode: "model_only", startedAt: Date.parse("2026-10-22T07:00:00Z") };
const now = Date.parse("2026-10-23T01:00:00Z");
const macro = { asOf: "2026-10-22T20:00:00Z", indicators: MACRO_UNIVERSE.map(row => ({
  id: row.id, name: row.name, value: 100, change: 1, changePct: 1, unit: row.unit, asOf: "2026-10-22T20:00:00Z", source: "yahoo", status: "ok", session: "closed",
})) };
function rows() {
  return Array.from({ length: 6 }, (_, index) => ({
    input_row: { ticker: String(index + 1).padStart(6, "0"), model_id: "plain_20_120_rank_mean_v1", score_kind: "rank_zscore", prediction_target: "next_session_open_to_close",
      prediction_status: "ok", pred_rank: index + 1, rank_score: 6 - index, pred_pool_size: "6", prediction_base_date: "2026-10-22" },
    result: { ticker: String(index + 1).padStart(6, "0"), company_name: `종목${index + 1}`, label: "NEUTRAL", label_ko: "중립", sentiment_score: 0, confidence: 0,
      summary: "", positive_factors: [], negative_factors: [], key_data_points: [], used_news_indices: [], caution: "" },
    news: [], data_meta: { source: "cache", newsStatus: "not_collected" },
  }));
}
describe("model TOP5 briefing", () => {
  it.each(["running", "failed"])("keeps finishedAt and elapsedMs from the completed snapshot during %s", async status => {
    const finishedAt = marker.startedAt + 38000;
    let currentMarker = { ...marker, runId: "old-run", finishedAt };
    const narratives = { resolve: vi.fn(async input => templateNarrative(input, null, now)) };
    const service = createBriefingService({ rank: async () => rows(), marker: async () => currentMarker, macro: async () => macro,
      composition: async input => buildBriefingComposition(input), narratives, now: () => now });
    const saved = await service(false, {});
    expect(saved.model).toMatchObject({ finishedAt: new Date(finishedAt).toISOString(), elapsedMs: 38000, poolSize: 6 });
    // Presentation-only completion fields must not change narrative facts or cache identity.
    const facts = narratives.resolve.mock.calls[0][0];
    expect(facts.model).not.toHaveProperty("finishedAt"); expect(facts.model).not.toHaveProperty("elapsedMs");
    expect(saved.narrative.inputHash).toBe(briefingInputHash(facts));
    currentMarker = { ...marker, runId: "new-run", status, startedAt: finishedAt + 1000, finishedAt: finishedAt + 9000 };
    expect(await service(false, {})).toEqual({ ...saved, previousRun: { reason: status } });
  });
  it("returns null completion metadata when the historical completed marker has no finishedAt", async () => {
    const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: async () => macro,
      composition: async input => buildBriefingComposition(input), narratives: { resolve: async input => templateNarrative(input, null, now) } });
    expect((await service(false, {})).model).toMatchObject({ finishedAt: null, elapsedMs: null });
  });
  it("returns a coherent no_run if a cold read races a new run during composition", async () => {
    let currentMarker = marker, release, entered;
    const assembling = new Promise(resolve => { entered = resolve; });
    const pendingComposition = new Promise(resolve => { release = resolve; });
    const service = createBriefingService({ rank: async () => rows(), marker: async () => currentMarker, macro: async () => macro,
      composition: async () => { entered(); return pendingComposition; },
      narratives: { resolve: async input => templateNarrative(input, null, now) }, now: () => now });
    const pending = service(false, {});
    await assembling;
    currentMarker = { ...marker, status: "running" };
    release(buildBriefingComposition(buildBriefingInput(rows(), marker, macro, now)));
    const result = await pending;
    expect(result).toMatchObject({ status: "no_run", kind: "unknown", model: null, stocks: [], narrative: { fallbackReason: "no_run", stocks: [] } });
    expect(result.previousRun).toBeUndefined();
  });
  it("returns the saved payload when a new run starts while composition is being assembled", async () => {
    let currentMarker = { ...marker, kind: "official" }, wait = false, release, entered;
    const assembling = new Promise(resolve => { entered = resolve; });
    const pendingComposition = new Promise(resolve => { release = resolve; });
    const service = createBriefingService({ rank: async () => rows(), marker: async () => currentMarker, macro: async () => macro,
      composition: async input => { if (wait) { entered(); return pendingComposition; } return buildBriefingComposition(input); },
      narratives: { resolve: async input => templateNarrative(input, null, now) }, now: () => now });
    const first = await service(false, {});
    wait = true;
    const pending = service(false, {});
    await assembling;
    currentMarker = { ...marker, kind: "adhoc", status: "running", startedAt: marker.startedAt + 1000 };
    release({ ...first.composition, note: "Partial next result must not appear" });
    expect(await pending).toEqual({ ...first, previousRun: { reason: "running" } });
  });
  it("retains the entire completed briefing through running and failure, then replaces it on completion", async () => {
    let currentMarker = { ...marker, kind: "official" }, data = rows();
    const rank = vi.fn(async () => data), market = vi.fn(async () => macro);
    const service = createBriefingService({ rank, marker: async () => currentMarker, macro: market,
      composition: async input => buildBriefingComposition(input), now: () => now,
      narratives: { resolve: async input => templateNarrative(input, null, now) } });
    const first = await service(false, {});
    expect(first.status).toBe("ready");
    for (const status of ["running", "failed"]) {
      currentMarker = { ...marker, status, kind: "adhoc", startedAt: marker.startedAt + 1000 };
      data = [];
      expect(await service(false, {})).toEqual({ ...first, previousRun: { reason: status } });
      expect(await service(true, {})).toEqual({ ...first, previousRun: { reason: status } });
    }
    expect(rank).toHaveBeenCalledOnce(); expect(market).toHaveBeenCalledOnce();
    currentMarker = { ...marker, kind: "adhoc", startedAt: marker.startedAt + 1000 };
    data = rows(); data[0].result.company_name = "New result";
    const next = await service(false, {});
    expect(next.kind).toBe("adhoc"); expect(next.stocks[0].name).toBe("New result"); expect(next.previousRun).toBeUndefined();
  });
  it.each(["running", "failed"])("returns no_run for cold %s and never reuses another output root or supply policy", async status => {
    let currentMarker = marker;
    const service = createBriefingService({ rank: async () => rows(), marker: async () => currentMarker, macro: async () => macro,
      composition: async input => buildBriefingComposition(input), narratives: { resolve: async input => templateNarrative(input, null, now) } });
    await service(false, { PIPELINE_OUTPUT_DIR: "fixture-a" });
    currentMarker = { ...marker, status };
    for (const env of [{ PIPELINE_OUTPUT_DIR: "fixture-b" }, { PIPELINE_OUTPUT_DIR: "fixture-a", BRIEFING_SHOW_SUPPLY: "true" }]) {
      expect(await service(false, env)).toMatchObject({ status: "no_run", kind: "unknown", model: null, stocks: [] });
    }
  });
  it("shares the exact historical date-caution bytes between generation and classification", () => {
    const oldText = "모델 기준일은 2026-10-22이며 오늘 날짜와 다릅니다.";
    expect(Buffer.from(targetSessionCautionText("2026-10-22"), "utf8")).toEqual(Buffer.from(oldText, "utf8"));
    const input = buildBriefingInput(rows(), marker, macro, now), previous = structuredClone(input);
    for (const stock of previous.stocks) stock.cautions.find(fact => fact.kind === "data").text = oldText;
    expect(briefingInputHash(input)).toBe(briefingInputHash(previous));
    expect(isTargetSessionCaution({ kind: "data", text: oldText }, "2026-10-22")).toBe(true);
    expect(isTargetSessionCaution({ kind: "data", text: oldText }, "2026-10-23")).toBe(false);
  });
  it("omits only the target-session caution and its citations after resolving the unchanged input hash", async () => {
    let rawHash, originalInput, cachedNarrative;
    const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: async () => macro,
      composition: async input => buildBriefingComposition(input), now: () => now,
      narratives: { resolve: async input => {
        rawHash = briefingInputHash(input); originalInput = input;
        expect(input.stocks[0].cautions.find(fact => fact.kind === "data").text).toContain("오늘 날짜");
        cachedNarrative = templateNarrative(input, null, now);
        cachedNarrative.citations.push(...input.stocks.flatMap(stock => stock.cautions.filter(fact => isTargetSessionCaution(fact, input.model.baseDate)).map(fact => fact.id)));
        return cachedNarrative;
      } } });
    const result = await service(false, {});
    expect(result.narrative.inputHash).toBe(rawHash); expect(briefingInputHash(originalInput)).toBe(rawHash);
    const hiddenDate = fact => isTargetSessionCaution(fact, originalInput.model.baseDate);
    const hidden = new Set(originalInput.stocks.flatMap(stock => stock.cautions.filter(hiddenDate).map(fact => fact.id)));
    for (const [index, stock] of result.stocks.entries()) {
      expect(stock.cautions).toEqual(originalInput.stocks[index].cautions.filter(fact => !hiddenDate(fact)));
      expect(result.narrative.stocks[index].citations).toEqual([`E:${stock.code}:1`, `C:${stock.code}:1`, `C:${stock.code}:2`]);
    }
    expect(result.narrative.citations).toEqual(MACRO_UNIVERSE.filter(row => row.id !== "SP500").map(row => `M:${row.id}`));
    expect(result.narrative.citations).not.toContain("M:SP500");
    expect(result.stocks[0].cautions.map(fact => fact.kind)).toEqual(["model", "news"]);
    expect(result.narrative.stocks[0].summary).toContain("10/23(금) 정규장 시가→종가");
    const ids = new Set([...result.macro.indicators.map(row => `M:${row.id}`), ...result.stocks.flatMap(stock => [`R:${stock.code}`, ...stock.evidence.map(fact => fact.id), ...stock.cautions.map(fact => fact.id), ...stock.news.articles.map(article => article.id)])]);
    for (const id of [...result.narrative.citations, ...result.narrative.stocks.flatMap(stock => stock.citations)]) { expect(hidden.has(id)).toBe(false); expect(ids.has(id)).toBe(true); }
    expect(cachedNarrative.citations.some(id => hidden.has(id))).toBe(true);
    expect(cachedNarrative.stocks[0].citations.some(id => hidden.has(id))).toBe(true);
    expect(hiddenDate({ kind: "data", text: "일부 가격 자료를 확인하지 못했습니다." })).toBe(false);
    expect(hiddenDate({ kind: "news", text: "모델 기준일은 2026-10-22이며 오늘 날짜와 다릅니다." })).toBe(false);
  });
  it.each([false, true])("preserves seven LLM fields and exact visible citations (new POST generation: %s)", async generate => {
    const directory = await mkdtemp(join(tmpdir(), "briefing-date-caution-"));
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test cache path");
    try {
      const selectedEnv = { PIPELINE_OUTPUT_DIR: directory, GEMINI_API_KEY: "fixture-public-not-an-actual-key" };
      const input = buildBriefingInput(rows(), marker, macro, now, selectedEnv), template = templateNarrative(input, null, now);
      const dateIds = input.stocks.flatMap(stock => stock.cautions.filter(fact => isTargetSessionCaution(fact, input.model.baseDate)).map(fact => fact.id));
      const value = { overview: template.overview, marketNote: template.marketNote, stocks: template.stocks.map(({ source, ...stock }) => stock), citations: [...template.citations, ...dateIds] };
      const transport = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }) }));
      const store = createNarrativeStore({ transport, now: () => now });
      if (!generate) await store.resolve(input, true, selectedEnv);
      const path = join(directory, "briefing-narrative.json"), before = generate ? null : await readFile(path, "utf8");
      const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: async () => macro,
        composition: async input => buildBriefingComposition(input), now: () => now, narratives: createNarrativeStore({ transport, now: () => now }) });
      const result = await service(generate, selectedEnv);
      expect(result.narrative).toMatchObject({ status: "llm", fallbackReason: null, inputHash: briefingInputHash(input), generatedAt: template.generatedAt, fieldSources: { overview: "llm", marketNote: "llm" } });
      expect(result.narrative.stocks).toHaveLength(5); expect(result.narrative.stocks.every(stock => stock.source === "llm")).toBe(true);
      expect(result.stocks.every(stock => stock.cautions.every(fact => !isTargetSessionCaution(fact, input.model.baseDate)))).toBe(true);
      expect(result.narrative.citations).toEqual(template.citations);
      for (const stock of result.narrative.stocks) expect(stock.citations).toEqual([`E:${stock.code}:1`, `C:${stock.code}:1`, `C:${stock.code}:2`]);
      expect([...result.narrative.citations, ...result.narrative.stocks.flatMap(stock => stock.citations)].some(id => dateIds.includes(id))).toBe(false);
      const saved = await readFile(path, "utf8");
      if (before !== null) expect(saved).toBe(before);
      expect(JSON.parse(saved).narrative.citations).toEqual(value.citations);
      expect(JSON.parse(saved).input.stocks[0].cautions.find(fact => fact.kind === "data").text).toBe("모델 기준일은 2026-10-22이며 오늘 날짜와 다릅니다.");
      expect(transport).toHaveBeenCalledOnce();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it.each(["official", "adhoc", undefined, "invalid"])("classifies a stable completed result from run metadata (%s)", async kind => {
    const service = createBriefingService({ rank: async () => rows(), marker: async () => ({ ...marker, runId: "fixture-run", kind }),
      macro: async () => macro, composition: async input => buildBriefingComposition(input),
      narratives: { resolve: async input => templateNarrative(input, null, now) }, now: () => now });
    const result = await service(false, {});
    expect(result.status).toBe("ready"); expect(result.kind).toBe(kind === "official" || kind === "adhoc" ? kind : "unknown");
  });
  it.each(["kind", "runId"])("does not attribute a result to changed %s metadata", async field => {
    const read = vi.fn().mockResolvedValueOnce({ ...marker, runId: "first", kind: "adhoc" })
      .mockResolvedValueOnce({ ...marker, runId: "first", kind: "adhoc", [field]: field === "kind" ? "official" : "second" });
    const service = createBriefingService({ rank: async () => rows(), marker: read, macro: async () => macro,
      composition: async input => buildBriefingComposition(input), narratives: { resolve: async input => templateNarrative(input, null, now) }, now: () => now });
    expect(await service(false, {})).toMatchObject({ status: "no_run", kind: "unknown", model: null });
  });
  it("uses background KIS reads only for GET and carries the same 1.5-second budget into composition", async () => {
    const market = vi.fn(async () => macro), composition = vi.fn(async input => buildBriefingComposition(input));
    const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: market, composition,
      narratives: { resolve: async input => templateNarrative(input, null, now) } });
    await service(false, {}); expect(market.mock.calls[0][1].backgroundKis).toBe(true);
    expect(composition.mock.calls[0][2].backgroundKis).toBe(true); expect(composition.mock.calls[0][2].kisWaitMs).toBeLessThanOrEqual(1500);
    await service(true, {}); expect(market.mock.calls[1][1].backgroundKis).toBe(false); expect(composition.mock.calls[1][2].backgroundKis).toBe(false);
  });
  it("caps a POST at 45 seconds and reuses already loaded macro/composition when providers hang", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const known = buildBriefingComposition(buildBriefingInput(rows(), marker, macro, now));
    const market = vi.fn().mockResolvedValueOnce(macro).mockImplementation(() => new Promise(() => {}));
    const composition = vi.fn().mockResolvedValueOnce(known).mockImplementation(() => new Promise(() => {}));
    const resolve = vi.fn(async input => templateNarrative(input, null, now));
    const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: market, composition, narratives: { resolve }, now: () => now });
    await service(false, {});
    const pending = service(true, {});
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await pending;
    expect(result.status).toBe("ready"); expect(result.macro.indicators).toEqual(macro.indicators);
    expect(result.composition).toEqual(known);
    expect(resolve.mock.calls[1][3]).toBe(now + 45_000 - 50);
  });
  it("keeps model ranks and returns seven unavailable indicators if cold macro preparation exceeds nine seconds", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const resolve = vi.fn(async input => templateNarrative(input, null, now));
    const service = createBriefingService({ rank: async () => rows(), marker: async () => marker, macro: () => new Promise(() => {}),
      composition: async input => buildBriefingComposition(input), narratives: { resolve }, now: () => now });
    const pending = service(true, {});
    await vi.advanceTimersByTimeAsync(9000);
    const result = await pending;
    expect(result.status).toBe("ready"); expect(result.stocks.map(stock => stock.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result.macro.indicators).toHaveLength(7); expect(result.macro.indicators.every(row => row.status === "unavailable")).toBe(true);
  });
  it("returns no_run without a completed model_only run or with malformed model metadata", () => {
    expect(buildBriefingInput(rows(), null, macro, now).stocks).toEqual([]);
    expect(buildBriefingInput(rows(), { ...marker, mode: "full" }, macro, now).model).toBeNull();
    expect(buildBriefingInput(rows(), { ...marker, status: "running" }, macro, now).model).toBeNull();
    for (const override of [{ model_id: "other" }, { score_kind: "return" }, { pred_pool_size: 99 }, { pred_rank: 2 }, { rank_score: NaN }, { prediction_base_date: "2026-02-30" }]) {
      const data = rows(); Object.assign(data[0].input_row, override);
      expect(buildBriefingInput(data, marker, macro, now).model).toBeNull();
    }
  });
  it("preserves model rank despite row order, and creates grounded evidence and US/Korea session context", () => {
    const data = rows().reverse(), original = structuredClone(data);
    const result = buildBriefingInput(data, marker, macro, now);
    expect(result.stocks.map(row => row.rank)).toEqual([1, 2, 3, 4, 5]); expect(data).toEqual(original);
    expect(result.stocks[0].rankScore).toBe(6); expect(result.stocks[0].topPercent).toBeCloseTo(100 / 6);
    expect(result.stocks[0].evidence[0]).toMatchObject({ id: "E:000001:1", kind: "model", text: "전체 6개 중 1위(상위 16.7%)입니다." });
    expect(result.stocks[0].cautions.map(row => row.kind)).toEqual(["model", "news", "data"]);
    expect(result.macro.context).toMatchObject({ usSessionDate: "2026-10-22" });
    expect(result.macro.context?.targetSessionNote).toContain("2026-10-23 한국 정규장");
    expect(templateNarrative(result, null).marketNote).toContain("미국 정규장 마감");
  });
  it("distinguishes article failure, zero results, uncollected and measured supply", () => {
    const data = rows();
    data[0].input_row = { ...data[0].input_row, supply_status: "ok", supply_window: 5, supply_data_days: 5, foreign_net_buy_sum: 123, inst_net_buy_sum: -10, supply_pass: "true" };
    data[0].data_meta.newsStatus = "collected";
    data[0].news = [{ index: 1, title: "종목1 공시", url: "https://example.com/article", source: "경제지", pub_date: "2026-10-22T08:00:00Z" }];
    data[1].data_meta.newsStatus = "collection_failed"; data[2].data_meta.newsStatus = "collected";
    const partial = structuredClone(macro); partial.indicators[0].status = "unavailable";
    const result = buildBriefingInput(data, marker, partial, now, { BRIEFING_SHOW_SUPPLY: "true" });
    expect(result.stocks[0].evidence.map(row => row.text).join(" ")).toContain("외국인 123원 순매수");
    expect(result.stocks[0].evidence.map(row => row.text).join(" ")).toContain("기관 10원 순매도");
    expect(JSON.stringify(result)).not.toContain("수급 조건");
    expect(result.stocks[0].news.articles[0]).toMatchObject({ id: "N:000001:1", source: "경제지" });
    expect(result.stocks[1].cautions.some(row => row.text.includes("수집에 실패"))).toBe(true);
    expect(result.stocks[2].cautions.some(row => row.text.includes("확인된 관련 기사가 없"))).toBe(true);
    expect(result.stocks[3].cautions.some(row => row.text.includes("수집하지 않았"))).toBe(true);
    expect(result.stocks[0].cautions.some(row => row.kind === "macro")).toBe(true);
  });
  it("labels intraday and mismatched US dates without claiming a completed previous session", () => {
    const intraday = structuredClone(macro); intraday.indicators[2].session = "open";
    expect(buildBriefingInput(rows(), marker, intraday, now).macro.context?.targetSessionNote).toContain("장중 관측");
    intraday.indicators[3].asOf = "2026-10-21T20:00:00Z";
    expect(buildBriefingInput(rows(), marker, intraday, now).macro.context?.usSessionDate).toBeNull();
  });
  it("GET never requests generation; no_run POST never requests it; run changes invalidate results", async () => {
    const resolve = vi.fn(async (input, _requested, _env) => templateNarrative(input, null, now));
    const markerFn = vi.fn().mockResolvedValue(marker);
    const service = createBriefingService({ rank: async () => rows(), marker: markerFn, macro: async () => macro, narratives: { resolve }, now: () => now });
    expect((await service(false, {})).status).toBe("ready"); expect(resolve.mock.calls[0][1]).toBe(false);
    markerFn.mockResolvedValueOnce(marker).mockResolvedValueOnce({ ...marker, startedAt: marker.startedAt + 100 });
    expect((await service(true, {})).status).toBe("ready"); expect(resolve.mock.calls[1][1]).toBe(false);
    expect((await service(true, {})).status).toBe("ready"); expect(resolve.mock.calls[2][1]).toBe(true);
  });
  it("never presents supply flags as a ranking filter and describes measured days in KRW", () => {
    const data = rows(); Object.assign(data[0].input_row, { supply_status: "ok", supply_pass: "false", supply_window: 5, supply_data_days: 5,
      foreign_net_buy_sum: 123000000, inst_net_buy_sum: -10000000, foreign_positive_days: 3, inst_positive_days: 2, combined_positive_days: 4 });
    const result = buildBriefingInput(data, marker, macro, now, { BRIEFING_SHOW_SUPPLY: "true" }), text = JSON.stringify(result.stocks[0]);
    expect(result.stocks[0].rank).toBe(1); expect(text).toContain("1억 2,300만 원"); expect(text).toContain("순매수 양수 3일");
    expect(result.stocks[0].evidence.filter(fact => fact.kind === "supply")).toHaveLength(1);
    expect(text).not.toMatch(/수급 조건|통과|필터/);
  });
  it("formats measured won in Korean groups without changing magnitude or sign", () => {
    expect(formatSupplyWon(1473000000)).toBe("14억 7,300만 원");
    expect(formatSupplyWon(-2932000000)).toBe("-29억 3,200만 원");
    expect(formatSupplyWon(1230000000000)).toBe("1조 2,300억 원");
    expect(formatSupplyWon(123)).toBe("123원");
  });
  it("rejects non-ok rows claiming ranks, legacy returns and malformed rows like model output validation", () => {
    const legacy = rows(); legacy[0].input_row.ensemble_pred_return = 0.1;
    expect(buildBriefingInput(legacy, marker, macro, now).model).toBeNull();
    const nonOk = rows(); nonOk.push({ ...nonOk[0], input_row: { ...nonOk[0].input_row, ticker: "999999", prediction_status: "failed" } });
    expect(buildBriefingInput(nonOk, marker, macro, now).model).toBeNull();
    expect(buildBriefingInput([null], marker, macro, now).model).toBeNull();
  });
  it("passes the request environment through to rank loading", async () => {
    const rank = vi.fn(async () => rows()), selectedEnv = { PIPELINE_OUTPUT_DIR: "fixture-request" };
    const service = createBriefingService({ rank, marker: async () => marker, macro: async () => macro,
      narratives: { resolve: async input => templateNarrative(input, null, now) }, now: () => now });
    await service(false, selectedEnv); expect(rank).toHaveBeenCalledWith(selectedEnv);
  });
  it("omits unpublished supply from response, template, model input and identity by default", async () => {
    const data = rows(); Object.assign(data[0].input_row, { supply_status: "ok", supply_data_days: 5, supply_window: 5, foreign_net_buy_sum: 1473000000, inst_net_buy_sum: -10000000 });
    const resolve = vi.fn(async input => templateNarrative(input, null, now));
    const service = createBriefingService({ rank: async () => data, marker: async () => marker, macro: async () => macro, narratives: { resolve }, now: () => now });
    const hidden = await service(false, {}), initial = hidden.narrative.inputHash;
    expect(JSON.stringify(hidden)).not.toMatch(/1473000000|14억|순매수|순매도|수급/);
    expect(resolve.mock.calls[0][0].stocks[0].evidence.some(fact => fact.kind === "supply")).toBe(false);
    data[0].input_row.foreign_net_buy_sum *= 100;
    expect((await service(false, {})).narrative.inputHash).toBe(initial);
    const visible = buildBriefingInput(data, marker, macro, now, { BRIEFING_SHOW_SUPPLY: "1" });
    expect(briefingInputHash(visible)).not.toBe(initial);
    expect(visible.stocks[0].evidence.some(fact => fact.kind === "supply")).toBe(true);
  });
});
