import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { opinionSentences, stockOpinionSentenceReason, selectStockOpinion, validateStockOpinion } from "../../server/stockOpinion";

// Optional local offline evidence: never calls Gemini/KIS or reads credentials.
const directory = resolve(process.cwd(), "../outputs/ui-verification/macro-v2");
const cachePath = resolve(directory, "result-copy/briefing-narrative.json");
describe.skipIf(!existsSync(cachePath))("stored Gemini language replay against stock-opinion policy", () => {
  it("reports sentence acceptance separately from the new 2–4 sentence field contract", () => {
    const cache = JSON.parse(readFileSync(cachePath, "utf8")), input = cache.input;
    const files = ["briefing-generated.json", "briefing-generated-second.json"];
    const sets = files.filter(file => existsSync(resolve(directory, file))).map(file => {
      const payload = JSON.parse(readFileSync(resolve(directory, file), "utf8"));
      return { label: file, rows: payload.narrative.stocks.map(row => ({ ...row, text: row.summary })) };
    });
    sets.push({ label: "result-copy/rawFields.stocks", rows: input.stocks.map(stock => ({ code: stock.code,
      text: cache.rawFields.stocks[stock.code].text, citations: cache.rawFields.stocks[stock.code].citations })) });
    for (const { label, rows } of sets) {
      let sentences = 0, safeSentences = 0, acceptedFields = 0;
      const reasons = {};
      for (const [index, row] of rows.entries()) {
        const candidate = { code: row.code, text: row.text, citations: row.citations };
        for (const sentence of opinionSentences(row.text)) {
          sentences++;
          if (stockOpinionSentenceReason(sentence, input, index) === null) safeSentences++;
        }
        const reason = validateStockOpinion(candidate, input, index);
        reasons[reason ?? "accepted"] = (reasons[reason ?? "accepted"] ?? 0) + 1;
        if (selectStockOpinion(candidate, input, index)) acceptedFields++;
      }
      expect(sentences).toBeGreaterThan(0); expect(safeSentences).toBeLessThanOrEqual(sentences);
      console.info("[stock-opinion offline replay]", JSON.stringify({ label, fields: rows.length, acceptedFields, safeSentences, sentences, reasons }));
    }
  });
});
