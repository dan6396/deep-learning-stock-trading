import { afterEach, describe, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => { const api = { readFile: read, mkdir: vi.fn(), writeFile: vi.fn() }; return { ...api, default: api }; });
import { marketHistorySessions } from "../../server/marketHistoryCalendar";

afterEach(() => { vi.unstubAllEnvs(); read.mockReset(); });
describe("read-only market history session reference", () => {
  it("uses the shared repository root helper and the explicit KIS CSV provenance", async () => {
    vi.stubEnv("PIPELINE_PROJECT_ROOT", "C:/fixture/top5-repository");
    read.mockResolvedValue("date,Close,Volume,source,collected_at\n2025-10-28,100,10,kis,2026-10-22T01:00:00Z\n2025-10-29,101,10,kis,2026-10-22T01:00:00Z\n");
    expect(await marketHistorySessions("2025-10-28", "2025-10-29")).toEqual({ dates: ["2025-10-28", "2025-10-29"], confirmed: true, source: "kis-index-cache" });
    expect(read.mock.calls[0][0].replace(/\\/g, "/")).toBe("C:/fixture/top5-repository/outputs/market_index_history/KOSPI.csv");
  });
  it.each(["broken", "date,Close,Volume,source,collected_at\n2025-10-28,100,10,unknown,2026-10-22T01:00:00Z\n"])("falls back without upgrading corrupt or foreign-source reference to verified sessions", async text => {
    read.mockResolvedValue(text);
    expect(await marketHistorySessions("2025-10-28", "2025-10-29")).toMatchObject({ confirmed: false, source: "krx-table" });
    expect(await marketHistorySessions("2026-10-08", "2026-10-12")).toEqual({ dates: ["2026-10-08", "2026-10-12"], confirmed: true, source: "krx-table" });
  });
});
