import { describe, expect, it } from "vitest";
import { expectReadableUserText } from "./assertUserText";

describe("user text identifier guard", () => {
  it("allows normal capitalized words and separate abbreviations", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>OECD NASA UNICEF AI</span><span>KST</span><span>KIS</span>";
    expect(() => expectReadableUserText(root)).not.toThrow();
  });
  it.each(["rank_zscore", "generation_in_progress", "KOSPI200_NIGHT", "UST10Y", "USDKRW", "macroStale", "fallbackReason", "MODEL UNIVERSE", "STOCK REPORT", "PRICE OBSERVATIONS", "ANALYSIS RECORDS", "m3-2026-10-23-neutral-rank"])("rejects internal identifier %s", code => {
    const root = document.createElement("div"); root.textContent = code;
    expect(() => expectReadableUserText(root)).toThrow();
  });
});
