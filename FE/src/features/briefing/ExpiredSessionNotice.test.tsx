import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { targetSessionEnd, useTargetSession } from "./ExpiredSessionNotice";
import { jsonResponse } from "../../test/dataFixtures";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function mountHook(now: string, baseDate = "2026-10-22", target: string | null = "2026-10-23") {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now));
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ baseDate, nextSession: target })); vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useTargetSession(baseDate), { wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return { result, fetcher };
}

describe("prediction target session context", () => {
  it.each(["2026-10-22T19:00:00+09:00", "2026-10-23T08:59:59+09:00", "2026-10-23T12:00:00+09:00", "2026-10-23T15:29:59+09:00"])("does not report ended-session before close: %s", async now => {
    const { result } = await mountHook(now);
    expect(result.current.isSessionEnded).toBe(false);
  });

  it("reports session ended at 15:30 KST and queries next-session endpoint", async () => {
    const { result, fetcher } = await mountHook("2026-10-23T15:30:00+09:00");
    expect(result.current.isSessionEnded).toBe(true);
    expect(result.current.target).toBe("2026-10-23");
    expect(String(fetcher.mock.calls[0][0])).toContain("/api/korean-market/next-session?baseDate=2026-10-22");
  });

  it("updates an already open page at the close boundary", async () => {
    const { result } = await mountHook("2026-10-23T15:29:59+09:00");
    expect(result.current.isSessionEnded).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.isSessionEnded).toBe(true);
  });

  it("uses the calendar holiday result rather than the next calendar day", async () => {
    const { result, fetcher } = await mountHook("2026-10-09T19:00:00+09:00", "2026-10-08", "2026-10-12");
    expect(String(fetcher.mock.calls[0][0])).toContain("baseDate=2026-10-08");
    expect(result.current.isSessionEnded).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(Date.parse("2026-10-12T15:30:00+09:00") - Date.now()); });
    expect(result.current.isSessionEnded).toBe(true);
    expect(result.current.target).toBe("2026-10-12");
  });

  it("does not guess an unsupported or invalid calendar date", async () => {
    const { result } = await mountHook("2027-01-10T19:00:00+09:00", "2027-01-07", null);
    expect(result.current.isSessionEnded).toBe(false);
    expect(targetSessionEnd("2026-02-30")).toBeNull();
  });
});
