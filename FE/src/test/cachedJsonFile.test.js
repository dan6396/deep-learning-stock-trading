import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ text: '{"value":1}', mtimeMs: 1, size: 11, ino: 1 }));
const reads = vi.hoisted(() => vi.fn(async () => state.text));
vi.mock("node:fs/promises", () => { const api = { readFile: reads, stat: vi.fn(async () => ({ ...state, isFile: () => true })) }; return { ...api, default: api }; });
import { clearCachedJsonFiles, readCachedJsonFile } from "../../server/cachedJsonFile";
beforeEach(() => { clearCachedJsonFiles(); reads.mockClear(); Object.assign(state, { text: '{"value":1}', mtimeMs: 1, size: 11, ino: 1 }); });
describe("bounded mtime JSON file cache", () => {
  it("reads/parses only once for the same mtime/size and refreshes on change", async () => {
    const first = await readCachedJsonFile("fixture"); expect(await readCachedJsonFile("fixture")).toBe(first); expect(reads).toHaveBeenCalledOnce();
    state.text = '{"value":2}'; state.mtimeMs++;
    expect(await readCachedJsonFile("fixture")).toEqual({ value: 2 }); expect(reads).toHaveBeenCalledTimes(2);
  });
  it("rejects an oversized file before reading and checks bytes again before parsing", async () => {
    state.size = 2_000_000; await expect(readCachedJsonFile("oversize")).rejects.toThrow("too_large"); expect(reads).not.toHaveBeenCalled();
    state.size = 1; state.text = "x".repeat(100); await expect(readCachedJsonFile("changed", 10)).rejects.toThrow("too_large");
  });
});
