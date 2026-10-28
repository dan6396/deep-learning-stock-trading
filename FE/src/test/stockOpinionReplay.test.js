import replay from "./fixtures/narrative-legacy-opinion-replay.json";
import { describe, expect, it } from "vitest";
import { opinionSentences, stockOpinionSentenceReason, selectStockOpinion, validateStockOpinion } from "../../server/stockOpinion";

// Pinned public summaries only; no runtime outputs, secrets or provider reads.
describe("stored Gemini language replay against stock-opinion policy", () => {
  it("reports sentence acceptance separately from the new 2–4 sentence field contract", () => {
    const { input, sets } = structuredClone(replay);
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
