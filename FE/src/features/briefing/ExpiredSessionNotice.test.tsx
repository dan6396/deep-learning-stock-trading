import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ExpiredSessionNotice, targetSessionEnd } from "./ExpiredSessionNotice";
import { jsonResponse } from "../../test/dataFixtures";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(now: string, baseDate = "2026-10-22", target: string | null = "2026-10-23") {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now));
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ baseDate, nextSession: target })); vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ExpiredSessionNotice baseDate={baseDate} /></MemoryRouter></QueryClientProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return fetcher;
}
describe("prediction target session context", () => {
  it.each(["2026-10-22T19:00:00+09:00", "2026-10-23T08:59:59+09:00", "2026-10-23T12:00:00+09:00", "2026-10-23T15:29:59+09:00"])("does not show an ended-session note before close: %s", async now => {
    await mount(now); expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
  it("shows the neutral note at 15:30 KST and offers the existing analysis guide", async () => {
    const fetcher = await mount("2026-10-23T15:30:00+09:00");
    expect(screen.getByRole("note")).toHaveTextContent("이 순위의 예측 대상(10/23 정규장)은 종료되었습니다. 다음 거래일 순위는 새 분석 후 표시됩니다.");
    expect(screen.getByRole("link", { name: "분석 실행 안내" })).toHaveAttribute("href", "/about#analysis-guide");
    expect(String(fetcher.mock.calls[0][0])).toContain("/api/korean-market/next-session?baseDate=2026-10-22");
  });
  it("updates an already open page at the close boundary", async () => {
    await mount("2026-10-23T15:29:59+09:00"); expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
  it("uses the calendar holiday result rather than the next calendar day", async () => {
    const fetcher = await mount("2026-10-09T19:00:00+09:00", "2026-10-08", "2026-10-12");
    expect(String(fetcher.mock.calls[0][0])).toContain("baseDate=2026-10-08");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(Date.parse("2026-10-12T15:30:00+09:00") - Date.now()); });
    expect(screen.getByRole("note")).toHaveTextContent("10/12 정규장");
  });
  it("does not guess an unsupported or invalid calendar date", async () => {
    await mount("2027-01-10T19:00:00+09:00", "2027-01-07", null);
    expect(screen.queryByRole("note")).not.toBeInTheDocument(); expect(targetSessionEnd("2026-02-30")).toBeNull();
  });
});
