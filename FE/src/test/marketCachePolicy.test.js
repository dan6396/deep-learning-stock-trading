import { describe, expect, it, vi } from "vitest";
import { marketCacheExpiry, marketClock } from "../../server/marketCachePolicy";

const at = value => Date.parse(`${value}+09:00`);
describe("KRX cache expiry", () => {
  it("uses short intraday windows and forces one closing refresh", () => {
    const time = at("2026-10-22T10:00:00");
    expect(marketClock(time).active).toBe(true);
    expect(marketCacheExpiry(time, 25_000)).toBe(time + 25_000);
    expect(marketCacheExpiry(at("2026-10-22T15:29:50"), 60_000)).toBe(at("2026-10-22T15:30:00"));
  });
  it("retains after-hours observations through weekends and listed holidays until next open", () => {
    expect(marketCacheExpiry(at("2026-10-23T16:00:00"), 20_000)).toBe(at("2026-10-26T09:00:00"));
    expect(marketCacheExpiry(at("2026-10-08T16:00:00"), 20_000)).toBe(at("2026-10-12T09:00:00"));
    expect(marketClock(at("2026-10-09T10:00:00")).active).toBe(false);
    expect(marketCacheExpiry(at("2026-10-22T08:00:00"), 60_000)).toBe(at("2026-10-22T09:00:00"));
  });
  it("retains completed daily history until the next trading close", () => {
    expect(marketCacheExpiry(at("2026-10-23T10:00:00"), 600_000, true)).toBe(at("2026-10-23T15:30:00"));
    expect(marketCacheExpiry(at("2026-10-23T16:00:00"), 600_000, true)).toBe(at("2026-10-26T15:30:00"));
  });
  it("uses an injected calendar and bounded freshness for unconfirmed years", () => {
    const calendar = vi.fn(date => date === "2026-10-21" ? "2026-10-23" : "2026-10-23");
    expect(marketClock(at("2026-10-22T10:00:00"), calendar).active).toBe(false);
    const time = at("2027-02-01T16:00:00");
    expect(marketCacheExpiry(time, 25_000, false, () => null)).toBe(time + 25_000);
  });
});
