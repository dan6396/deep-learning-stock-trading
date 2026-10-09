import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WatchlistPage } from "./WatchlistPage";
import { wholeRank } from "../rank/rankFixtures";
import { WATCHLIST_KEY, watchlistStore } from "../../shared/lib/watchlist";
import { deferred, jsonResponse } from "../../test/dataFixtures";
const clients: QueryClient[] = [];
function sync(codes: string[]) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(codes));
  const unsubscribe = watchlistStore.subscribe(() => {});
  window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: JSON.stringify(codes), storageArea: localStorage })); unsubscribe();
}
beforeEach(() => sync([]));
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(rank: unknown = wholeRank()) {
  vi.stubGlobal("fetch", vi.fn(async url => String(url) === "/api/rank" && typeof rank === "function" ? rank() : jsonResponse(String(url) === "/api/rank" ? rank : wholeRank().slice(0, 5))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/next/watchlist"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><WatchlistPage /></MemoryRouter></QueryClientProvider>);
}
describe("watchlist joins and persistence UI", () => {
  it.each([null, "[]"])("does not seed an absent or deliberately empty stored list: %s", value => {
    if (value === null) localStorage.removeItem(WATCHLIST_KEY); else localStorage.setItem(WATCHLIST_KEY, value);
    mount(); expect(screen.getByText(/아직 관심 종목이 없습니다/)).toBeInTheDocument(); expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(0);
  });
  it("retains a code outside the universe, links it, and lets the user remove it", async () => {
    sync(["100001", "999999"]); mount();
    const link = await screen.findByRole("link", { name: "검증종목001 100001" }); expect(link).toHaveAttribute("href", "/next/stock/100001");
    expect(screen.getByRole("link", { name: "이름 미확인 999999" })).toHaveAttribute("href", "/next/stock/999999");
    expect(document.querySelector('[data-rank-code="999999"]')).toHaveTextContent("분석 미제공");
    expect(document.querySelector('[data-rank-code="100001"] [data-value=predictedReturn]')).toHaveTextContent("0.00%");
    fireEvent.click(screen.getByRole("button", { name: "999999 관심 종목" }));
    expect(document.querySelector('[data-rank-code="999999"]')).not.toBeInTheDocument(); expect(JSON.parse(localStorage.getItem(WATCHLIST_KEY)!)).toEqual(["100001"]);
  });
  it("does not fill missing rank analysis from candidate data", async () => {
    sync(["100001"]); mount([]); await screen.findByText("분석 미제공");
    expect(screen.getByRole("link", { name: "이름 미확인 100001" })).toBeInTheDocument();
    expect(document.querySelector('[data-rank-code="100001"] [data-value=predictedReturn]')).toHaveTextContent("—");
  });
  it("shows session-only save failure without losing the current action", async () => {
    sync(["100001"]); mount(); await screen.findByRole("link", { name: "검증종목001 100001" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    fireEvent.click(screen.getByRole("button", { name: "검증종목001 100001 관심 종목" }));
    expect(screen.getByRole("status")).toHaveTextContent("현재 탭에서만 유지"); expect(screen.getByText(/아직 관심 종목이 없습니다/)).toBeInTheDocument();
  });
  it("updates visible count from a cross-tab change and clears on localStorage.clear", async () => {
    mount(); fireEvent(window, new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: '["100001","999999"]', storageArea: localStorage }));
    await screen.findByRole("link", { name: "검증종목001 100001" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("2개");
    fireEvent(window, new StorageEvent("storage", { key: null, newValue: null, storageArea: localStorage }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("0개"));
  });
  it("distinguishes pending, confirmed absent and previous-data failure for a saved code", async () => {
    sync(["999999"]); const response = deferred<Response>(); let fail = false;
    mount(() => fail ? Promise.resolve(new Response("{}", { status: 502 })) : response.promise);
    expect(document.querySelector('[data-rank-code="999999"]')).toHaveTextContent("분석 조회 중"); expect(screen.queryByText("분석 미제공")).not.toBeInTheDocument();
    response.resolve(jsonResponse([])); await screen.findByText("분석 미제공");
    fail = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText("이전 조회 결과 · 관심 종목 분석 갱신 실패");
    expect(document.querySelector('[data-rank-code="999999"]')).toHaveTextContent("현재 분석 여부 미확인"); expect(screen.queryByText("분석 미제공")).not.toBeInTheDocument();
  });
  it("does not label initial rank failure as missing analysis", async () => {
    sync(["999999"]); mount(() => Promise.resolve(new Response("{}", { status: 502 })));
    await screen.findByText("전체 순위 조회 실패 · 저장한 종목 코드는 유지합니다.");
    expect(document.querySelector('[data-rank-code="999999"]')).toHaveTextContent("분석 조회 실패 · 미확인"); expect(screen.queryByText("분석 미제공")).not.toBeInTheDocument();
  });
});
