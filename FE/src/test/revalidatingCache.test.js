import { afterEach, describe, expect, it, vi } from "vitest";
import { createRevalidatingCache } from "../../server/revalidatingCache";
afterEach(() => vi.useRealTimers());
describe("bounded KIS stale-while-revalidate", () => {
  it("returns a cold fallback at 1.5 seconds while preserving one background operation for all waiters", async () => {
    vi.useFakeTimers(); let release; const load = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const read = createRevalidatingCache();
    const get = () => read("fixture", load, () => null, value => value !== null, 10000, { backgroundKis: true });
    const first = get(), second = get(); await vi.advanceTimersByTimeAsync(1500);
    expect(await first).toBeNull(); expect(await second).toBeNull(); expect(load).toHaveBeenCalledOnce();
    release({ value: 100 }); await vi.advanceTimersByTimeAsync(0);
    expect(await get()).toEqual({ value: 100 }); expect(load).toHaveBeenCalledOnce();
  });
  it("returns stale success immediately, updates it in the background and uses sixty-second negative caching", async () => {
    vi.useFakeTimers(); const read = createRevalidatingCache(), load = vi.fn().mockResolvedValueOnce(100).mockRejectedValueOnce(new Error("fixture"));
    const get = () => read("fixture", load, () => null, value => value !== null, 100, { backgroundKis: true });
    expect(await get()).toBe(100); await vi.advanceTimersByTimeAsync(101);
    expect(await get()).toBe(100); await vi.advanceTimersByTimeAsync(0);
    expect(await get()).toBe(100); expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_001); load.mockResolvedValueOnce(200);
    expect(await get()).toBe(100); await vi.advanceTimersByTimeAsync(0); expect(await get()).toBe(200);
  });
  it("keeps POST blocking semantics and retries a cold failure after its short negative TTL", async () => {
    vi.useFakeTimers(); const read = createRevalidatingCache(), load = vi.fn().mockRejectedValueOnce(new Error("fixture")).mockResolvedValueOnce(100);
    const get = () => read("fixture", load, () => null, value => value !== null, 10000);
    expect(await get()).toBeNull(); expect(await get()).toBeNull(); expect(load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_001); expect(await get()).toBe(100); expect(load).toHaveBeenCalledTimes(2);
  });
});
