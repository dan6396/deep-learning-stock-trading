import { describe, expect, it } from "vitest";
import { formatAgreement, formatDate, formatNumber, formatPercent, formatWon } from "./format";
describe("financial formatting", () => {
  it.each([null, undefined, "", " ", NaN, Infinity, "NaN"])("renders %s as absent", value => {
    expect(formatNumber(value)).toBe("—");
    expect(formatWon(value)).toBe("—");
    expect(formatPercent(value)).toBe("—");
  });
  it("keeps fraction and percent units explicit", () => {
    expect(formatPercent(0.0123)).toBe("+1.23%");
    expect(formatPercent(1.23, "percent")).toBe("+1.23%");
    expect(formatPercent(-0.00000001)).toBe("0.00%");
    expect(formatWon(123400)).toBe("123,400원");
    expect(formatWon(0)).toBe("0원");
    expect(formatAgreement(null)).toBe("—");
    expect(formatAgreement(2 / 3)).toBe("67%");
  });
  it("rejects impossible dates and uses the Korean date/time zone", () => {
    for (const value of [null, "", "invalid", "2026-02-30", "2026-13-01"]) expect(formatDate(value)).toBe("—");
    expect(formatDate("2026-10-07T20:00:00Z", true)).toContain("2026. 10. 08.");
    expect(formatDate("2026-10-07")).toContain("2026. 10. 07.");
  });
});
