import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";
import { deferred, jsonResponse } from "../../test/dataFixtures";

afterEach(() => vi.useRealTimers());
describe("fetch transport", () => {
  it("propagates caller cancellation and rejects a late success instead of fallback", async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const controller = new AbortController();
    const request = createApiClient("", fetcher).request("/api/candidates", { signal: controller.signal });
    const signal = fetcher.mock.calls[0][1]?.signal;
    controller.abort();
    expect(signal?.aborted).toBe(true);
    pending.resolve(jsonResponse([]));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
  it("does not start fetch for an already aborted caller", async () => {
    const fetcher = vi.fn<typeof fetch>(), controller = new AbortController();
    controller.abort();
    await expect(createApiClient("", fetcher).request("/api/candidates", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts a timed out request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    const request = createApiClient("", fetcher).request("/api/candidates", { timeoutMs: 100 });
    const assertion = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
  it("keeps cache/sample payload evidence instead of classifying HTTP200 as live", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ source: "cache", generatedAt: "2026-10-07T09:00:00Z" }, { "x-data-source": "live" }));
    expect(await createApiClient("", fetcher).request("/api/korean-market/dashboard")).toMatchObject({ source: "cache", asOf: "2026-10-07T09:00:00Z" });
    fetcher.mockResolvedValue(jsonResponse({ isSample: true }, { "x-data-source": "live" }));
    expect((await createApiClient("", fetcher).request("/api/stock-analysis")).source).toBe("sample");
    fetcher.mockResolvedValue(jsonResponse([]));
    expect((await createApiClient("", fetcher).request("/api/korean-market/indices")).source).toBe("unknown");
  });
  it("reads array provenance headers and supports an explicit envelope", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([], { "x-data-source": "cache", "x-data-as-of": "2026-10-07T09:00:00Z" }));
    expect(await createApiClient("", fetcher).request("/api/candidates")).toMatchObject({ data: [], source: "cache", asOf: "2026-10-07T09:00:00Z" });
    fetcher.mockResolvedValue(jsonResponse({ data: [], source: "sample", asOf: "2026-10-07" }));
    expect(await createApiClient("", fetcher).request("/api/candidates")).toMatchObject({ data: [], source: "sample" });
  });
  it("surfaces HTTP/HTML errors and does not provide samples", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("failed", { status: 502 }));
    await expect(createApiClient("", fetcher).request("/api/candidates")).rejects.toThrow("502");
    fetcher.mockResolvedValue(new Response("<html />", { headers: { "content-type": "text/html" } }));
    await expect(createApiClient("", fetcher).request("/api/candidates")).rejects.toThrow("JSON");
  });
});
