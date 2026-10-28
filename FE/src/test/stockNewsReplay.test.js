import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createNarrativeStore, templateNarrative } from "../../server/briefingNarrative";
import { createStockInsightService } from "../../server/stockInsight";

import replay from "./fixtures/narrative-0154-replay.json";

describe("synthetic current-grammar acceptance through stock insight", () => {
  it("keeps two distinct grounded article topics as llm without calling a provider", async () => {
    const code = "005930", id = "N:005930:1", directory = mkdtempSync(join(tmpdir(), "stock-news-accepted-"));
    const previousFetch = globalThis.fetch, provider = vi.fn(async () => { throw Error("external request prohibited"); });
    globalThis.fetch = provider;
    const input = { newsValidation: "on", model: null, macro: { indicators: [], preOpen: [] }, stocks: [{ code, name: "삼성전자", rank: 1, rankScore: 1.7, poolSize: 200, topPercent: .5, evidence: [], cautions: [],
      news: { status: "collected", articles: [{ id, title: "삼성전자 서비스 공개 공시", source: "가일보", url: "https://paper.example/accepted", pubDate: "2026-10-28T00:00:00Z" }] } }] };
    const summary = { code, text: "서비스 공개를 다룬 기사입니다. 공시를 다룬 기사입니다.", source: "llm", summaryBasis: "title", citations: [id] };
    try {
      const service = createStockInsightService({ rank: async () => [], briefing: async () => ({ ...input, narrative: { newsSummaries: [summary] } }),
        observations: { get: async () => ({ sensitivities: [{ status: "preparing", complete: false }] }) } });
      const result = await service(code, { PIPELINE_OUTPUT_DIR: directory, BRIEFING_NEWS_VALIDATION: "on" });
      expect(result.news).toMatchObject({ summarySource: "llm", summaryBasis: "title", summary: summary.text, citations: [id] });
      expect(provider).not.toHaveBeenCalled();
    } finally { globalThis.fetch = previousFetch; rmdirSync(directory); }
  });
});
describe("offline replay of pinned TOP5 news summaries", () => {
  it("replays the fixed historical data through briefing GET and stock insight without upstream calls", async () => {
    const input = structuredClone(replay.input), copy = { version: 0, inputHash: "legacy-0154", input, narrative: { ...templateNarrative(input, null), generatedAt: replay.generatedAt,
      newsSummaries: replay.rawFields.newsSummaries.map(row => ({ ...row, source: "llm" })) } };
    const bytes = Buffer.from(JSON.stringify(copy));
    const directory = mkdtempSync(join(tmpdir(), "stock-news-replay-")), path = join(directory, "briefing-narrative.json");
    try {
      writeFileSync(path, bytes);
      const transport = vi.fn(() => { throw Error("external generation prohibited"); });
      const env = { BRIEFING_NEWS_VALIDATION: "on", PIPELINE_OUTPUT_DIR: directory }, narrative = await createNarrativeStore({ transport }).resolve(input, false, env);
      const service = createStockInsightService({ rank: async () => [], briefing: async () => ({ ...input, narrative }),
        observations: { get: async () => ({ sensitivities: [{ status: "preparing", complete: false }] }) } });
      const rows = [];
      for (const stock of input.stocks) {
        const result = await service(stock.code, env), expected = copy.narrative.newsSummaries.find(row => row.code === stock.code);
        // The strict additional gate rejects unsupported paraphrases/publisher claims.
        // A cache source flag cannot bypass the current grammar on GET or stock insight.
        expect(result.news.summarySource).toBe("template");
        expect(result.news.summary).not.toBe(expected.text);
        expect(result.news.summary).not.toContain("제2뉴스");
        expect(result.news.citations).toEqual(expected.citations);
        rows.push({ code: stock.code, name: stock.name, summarySource: result.news.summarySource, originalTextMatch: result.news.summary === expected.text,
          citations: result.news.citations.length });
      }
      expect(transport).not.toHaveBeenCalled(); expect(readFileSync(path).equals(bytes)).toBe(true);
      console.info("[stock-news offline replay]", JSON.stringify(rows));
    } finally { unlinkSync(path); rmdirSync(directory); }
  });
});
