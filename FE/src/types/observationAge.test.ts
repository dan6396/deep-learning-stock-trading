import { describe, expect, it } from "vitest";
import { pastObservation } from "./observationAge";
const kst = (text: string) => Date.parse(`${text}+09:00`);
describe("past market observation label", () => {
  it("uses the thirty-minute threshold during an open session", () => {
    expect(pastObservation("2026-10-23T10:00:00+09:00", kst("2026-10-23T10:30:00"))).toBe(false);
    expect(pastObservation("2026-10-23T10:00:00+09:00", kst("2026-10-23T10:30:01"))).toBe(true);
  });
  it.each(["2026-10-23T16:00:00", "2026-10-24T12:00:00", "2026-10-25T12:00:00", "2026-10-26T08:59:00"])("requires the preceding completed close outside trading hours: %s", now => {
    expect(pastObservation("2026-10-23T15:30:00+09:00", kst(now))).toBe(false);
    expect(pastObservation("2026-10-23T15:29:59+09:00", kst(now))).toBe(true);
  });
  it("knows a KRX holiday and does not fabricate a date for invalid or missing observations", () => {
    expect(pastObservation("2026-10-08T15:30:00+09:00", kst("2026-10-09T12:00:00"))).toBe(false);
    expect(pastObservation("2026-10-07T16:00:00+09:00", kst("2026-10-09T12:00:00"))).toBe(true);
    expect(pastObservation(null)).toBe(false); expect(pastObservation("invalid")).toBe(false);
  });
});
