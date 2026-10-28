import { existsSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createNarrativeStore } from "../../server/briefingNarrative";
import { createStockInsightService } from "../../server/stockInsight";

const original = resolve(process.cwd(), "../outputs/briefing-narrative.json");
describe.skipIf(!existsSync(original))("offline replay of saved TOP5 news summaries", () => {
  it("replays the real file copy through briefing GET and stock insight without upstream calls", async () => {
    const bytes = readFileSync(original), copy = JSON.parse(bytes.toString("utf8")), input = copy.input;
    const directory = mkdtempSync(join(tmpdir(), "stock-news-replay-")), path = join(directory, "briefing-narrative.json");
    try {
      writeFileSync(path, bytes);
      const transport = vi.fn(() => { throw Error("external generation prohibited"); });
      const env = { PIPELINE_OUTPUT_DIR: directory }, narrative = await createNarrativeStore({ transport }).resolve(input, false, env);
      const service = createStockInsightService({ rank: async () => [], briefing: async () => ({ ...input, narrative }),
        observations: { get: async () => ({ sensitivities: [{ status: "preparing", complete: false }] }) } });
      const rows = [];
      for (const stock of input.stocks) {
        const result = await service(stock.code, env), expected = copy.narrative.newsSummaries.find(row => row.code === stock.code);
        expect(result.news.summarySource).toBe("llm");
        if (stock.code === "030200") {
          // A generic title-only notice is no longer an attributed article fact.
          expect(result.news.summary).toBe(expected.text.split(/(?<=[.!?。])\s+/).slice(0, 2).join(" "));
        } else if (stock.code === "004990" && expected.text.includes("제2뉴스")) {
          // The input identifies this publisher by URL, not the invented numeric brand.
          expect(result.news.summary).toBe(expected.text.split(/(?<=[.!?。])\s+/).slice(0, 2).join(" "));
          expect(result.news.summary).not.toContain("제2뉴스");
        } else expect(result.news.summary).toBe(expected.text);
        expect(result.news.citations).toEqual(expected.citations);
        rows.push({ code: stock.code, name: stock.name, summarySource: result.news.summarySource, originalTextMatch: result.news.summary === expected.text,
          citations: result.news.citations.length });
      }
      expect(transport).not.toHaveBeenCalled(); expect(readFileSync(path).equals(bytes)).toBe(true);
      console.info("[stock-news offline replay]", JSON.stringify(rows));
    } finally { unlinkSync(path); rmdirSync(directory); }
  });
});
