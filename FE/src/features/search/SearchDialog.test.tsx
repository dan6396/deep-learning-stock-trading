import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { SearchDialog } from "./SearchDialog";
import { wholeRank } from "../rank/rankFixtures";
import { jsonResponse } from "../../test/dataFixtures";
const clients: QueryClient[] = [];
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function(this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(handler?: () => Promise<Response>) {
  const fetcher = vi.fn<typeof fetch>(async () => handler ? handler() : jsonResponse(wholeRank())); vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/next/rank", "/next"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SearchDialog /><HistoryProbe /><input aria-label="외부 입력" /></MemoryRouter></QueryClientProvider>); return fetcher;
}
function HistoryProbe() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>테스트 뒤로</button>; }
describe("global whole-rank search", () => {
  it("opens a labelled modal with focused input, searches all 199 instead of candidates", async () => {
    const fetcher = mount(); const trigger = screen.getByRole("button", { name: "종목 검색" }); trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "종목 검색" }), input = within(dialog).getByRole("searchbox"); expect(input).toHaveFocus();
    expect(dialog.querySelector(".stock-search-results")).toBeInTheDocument(); expect(dialog.querySelector(".search-results")).toBeNull();
    await screen.findByText("전체 199종목 중 199종목 일치"); fireEvent.change(input, { target: { value: "100199" } });
    expect(screen.getByRole("link", { name: /검증종목199 100199/ })).toHaveAttribute("href", "/next/stock/100199");
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual(["/api/rank"]);
    fireEvent.keyDown(input, { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  });
  it("traps Tab in both directions and closes the native modal before restoring focus", async () => {
    mount(); const trigger = screen.getByRole("button", { name: "종목 검색" }); trigger.focus(); fireEvent.click(trigger);
    await screen.findByText("전체 199종목 중 199종목 일치"); const dialog = screen.getByRole("dialog"), buttons = within(dialog).getAllByRole("button"), first = buttons[0], last = buttons[buttons.length - 1];
    last.focus(); fireEvent.keyDown(last, { key: "Tab" }); expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
    let stillOpen = true; trigger.addEventListener("focus", () => { stillOpen = (dialog as HTMLDialogElement).open; }, { once: true });
    fireEvent.click(first); expect(stillOpen).toBe(false); expect(trigger).toHaveFocus();
  });
  it("supports Ctrl/Meta K without intercepting input or IME shortcuts", () => {
    mount(); const input = screen.getByRole("textbox", { name: "외부 입력" }); input.focus();
    fireEvent.keyDown(input, { key: "k", ctrlKey: true }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "k", metaKey: true, isComposing: true }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true }); expect(screen.getByRole("dialog")).toBeInTheDocument();
    const search = screen.getByRole("searchbox"); fireEvent.compositionStart(search); fireEvent.keyDown(search, { key: "Escape", isComposing: true }); expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.compositionEnd(search); fireEvent.keyDown(search, { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("does not present failed, unqueried data as an authoritative zero", async () => {
    mount(() => Promise.resolve(new Response("{}", { status: 502 }))); fireEvent.click(screen.getByRole("button", { name: "종목 검색" }));
    await screen.findByText("전체 순위 조회 실패"); expect(screen.getByText("검색 자료 미확인")).toBeInTheDocument(); expect(screen.queryByText(/전체 0종목/)).not.toBeInTheDocument();
  });
  it("allows a successful empty response to show zero and never seeds five candidates", async () => {
    mount(() => Promise.resolve(jsonResponse([]))); fireEvent.click(screen.getByRole("button", { name: "종목 검색" }));
    await screen.findByText("전체 0종목 중 0종목 일치"); expect(screen.getByText("최신 전체 분석 결과가 비어 있습니다.")).toBeInTheDocument();
  });
  it("closes on a router history change without restoring the old trigger focus", async () => {
    mount(); const trigger = screen.getByRole("button", { name: "종목 검색" }); trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole("searchbox")).toHaveFocus(); fireEvent.click(screen.getByRole("button", { name: "테스트 뒤로" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(trigger).not.toHaveFocus();
  });
});
