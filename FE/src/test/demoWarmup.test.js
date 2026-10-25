import { describe, expect, it, vi } from "vitest";
import { warmup } from "../../scripts/demo/warmup.mjs";
describe("read-only demo preparation", () => {
  it("reads status, indices, briefing, ranks and five quotes/charts sequentially without POST", async () => {
    let active = 0, maximum = 0;
    const transport = vi.fn(async (url, init) => {
      maximum = Math.max(maximum, ++active);
      expect(init.method).toBe("GET");
      const path = new URL(url).pathname;
      const data = path === "/api/rank" ? Array.from({ length: 6 }, (_, i) => ({ input_row: { ticker: String(100001 + i), pred_rank: i + 1 } }))
        : path === "/api/briefing" ? { status: "ready", macro: { indicators: [{ status: "unavailable" }] }, narrative: { status: "template" } } : {};
      await Promise.resolve(); active--; return { ok: true, status: 200, json: async () => data };
    });
    const pause = vi.fn(async () => {}), rows = await warmup("http://localhost:5173", { transport, pause });
    expect(rows).toHaveLength(14); expect(maximum).toBe(1); expect(pause).toHaveBeenCalledTimes(13);
    expect(rows[2].note).toContain("지표 미제공 1개");
    expect(transport.mock.calls.every(([url]) => !String(url).includes("/run") && !String(url).includes("/narrative"))).toBe(true);
  });
  it("keeps errors concise and continues without logging raw response bodies", async () => {
    const rows = await warmup("http://localhost:5173", { transport: async () => { throw new Error("private fixture text"); }, pause: async () => {} });
    expect(rows).toHaveLength(4); expect(JSON.stringify(rows)).not.toContain("private fixture text");
  });
});
