import { describe, expect, it } from "vitest";
import { nextKrxSession } from "../../server/krxCalendar";

describe("built-in KRX session calendar", () => {
  it.each([
    ["2026-10-08", "2026-10-12"], // 한글날 + weekend
    ["2026-10-12", "2026-10-13"],
    ["2026-10-02", "2026-10-06"], // weekend + 개천절 대체공휴일
    ["2026-09-23", "2026-09-28"], // 추석
    ["2026-12-24", "2026-12-28"], // 성탄절 + weekend
  ])("skips weekends and closures after %s", (base, next) => expect(nextKrxSession(base)).toBe(next));
  it("never guesses into an unrecorded year or accepts invalid dates", () => {
    expect(nextKrxSession("2026-12-30")).toBeNull();
    expect(nextKrxSession("2026-02-30")).toBeNull();
  });
});
