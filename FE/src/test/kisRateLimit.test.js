import { describe, expect, it } from "vitest";
import { createKisRequestLimiter, kisMaxRps } from "../../server/kisRateLimit";

describe("process KIS token bucket", () => {
  it("paces concurrent endpoint requests and does not accumulate idle burst tokens", async () => {
    let time = 1000; const sleeps = [], starts = [];
    const limiter = createKisRequestLimiter({ now: () => time, wait: async ms => { sleeps.push(ms); time += ms; } });
    await Promise.all(Array.from({ length: 4 }, async () => { await limiter.take(5); starts.push(time); }));
    expect(starts).toEqual([1000, 1200, 1400, 1600]); expect(sleeps).toEqual([200, 200, 200]);
    time += 10_000; await limiter.take(5); await limiter.take(5);
    expect(sleeps[sleeps.length - 1]).toBe(200);
  });
  it("honors a slower mock caller in the shared queue and recovers after a failed wait", async () => {
    let time = 1000, fail = true;
    const limiter = createKisRequestLimiter({ now: () => time, wait: async ms => { if (fail) { fail = false; throw new Error("fixture clock"); } time += ms; } });
    await limiter.take(0.8); await expect(limiter.take(5)).rejects.toThrow("fixture clock");
    await limiter.take(5); expect(time).toBe(2250);
  });
  it("uses conservative defaults and clamps configuration to the documented domain limits", () => {
    expect(kisMaxRps({}, "real")).toBe(1); expect(kisMaxRps({}, "mock")).toBe(1);
    for (const value of ["", "0", "-1", "NaN", "Infinity"]) expect(kisMaxRps({ KIS_MAX_RPS: value }, "real")).toBe(1);
    expect(kisMaxRps({ KIS_MAX_RPS: "3" }, "real")).toBe(3);
    expect(kisMaxRps({ KIS_MAX_RPS: "30" }, "real")).toBe(18);
    expect(kisMaxRps({ KIS_MAX_RPS: "3" }, "mock")).toBe(1);
    expect(kisMaxRps({ KIS_MAX_RPS: "0.5" }, "mock")).toBe(0.5);
  });
});
