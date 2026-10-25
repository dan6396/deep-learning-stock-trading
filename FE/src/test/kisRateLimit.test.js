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
  it("gives a newly arrived user the next slot ahead of queued background work", async () => {
    let time = 0, release;
    const order = [];
    const limiter = createKisRequestLimiter({ now: () => time, wait: ms => new Promise(resolve => { release = () => { time += ms; resolve(); }; }) });
    await limiter.take(1, "background");
    const background = limiter.take(1, "background").then(() => order.push("background"));
    await Promise.resolve();
    const user = limiter.take(1).then(() => order.push("user"));
    release(); await user; expect(order).toEqual(["user"]);
    release(); await background; expect(order).toEqual(["user", "background"]);
  });
  it("caps background permits at thirty per minute while preserving the common one-RPS ceiling", async () => {
    let time = 0; const starts = [];
    const limiter = createKisRequestLimiter({ now: () => time, wait: async ms => { time += ms; } });
    for (let i = 0; i < 31; i++) { await limiter.take(1, "background"); starts.push(time); }
    expect(starts.filter(value => value < 60_000)).toHaveLength(30);
    expect(starts[30]).toBe(60_000);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(2000);
  });
  it("promotes a cold shared chart's queued and future pages when a user joins, then releases the promotion", async () => {
    let time = 0, release; const order = [];
    const limiter = createKisRequestLimiter({ now: () => time, wait: ms => new Promise(resolve => { release = () => { time += ms; resolve(); }; }) });
    await limiter.take(1, "background", "other");
    const other = limiter.take(1, "background", "other").then(() => order.push("other"));
    const chart = limiter.take(1, "background", "chart").then(() => order.push("chart"));
    await Promise.resolve(); limiter.promote("chart"); release(); await chart;
    expect(order).toEqual(["chart"]); expect(time).toBe(1000);
    expect(limiter.priority("chart", "background")).toBe("user");
    const nextPage = limiter.take(1, "background", "chart").then(() => order.push("next-page"));
    release(); await nextPage; expect(order).toEqual(["chart", "next-page"]);
    limiter.release("chart"); expect(limiter.priority("chart", "background")).toBe("background");
    release(); await other; expect(order).toEqual(["chart", "next-page", "other"]);
  });
});
