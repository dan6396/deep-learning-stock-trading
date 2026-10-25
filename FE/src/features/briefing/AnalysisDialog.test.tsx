import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AnalysisDialog, dialogTabStops } from "./AnalysisDialog";
import { backendStatusBody, jsonResponse } from "../../test/dataFixtures";

const clients: QueryClient[] = [];
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function(this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function RouteProbe() { const navigate = useNavigate(), location = useLocation(); return <><button onClick={() => navigate("/rank")}>경로 이동</button><output data-testid="route">{location.pathname + location.search}</output></>; }
function mount(running = false, status = running ? "running" : "idle", initialEntries = ["/"]) {
  const fetcher = vi.fn<typeof fetch>(async path => jsonResponse(String(path) === "/api/backend/status" ? backendStatusBody({ state: "not_produced" }) : { status, mode: "model_only" }));
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AnalysisDialog /><RouteProbe /></MemoryRouter></QueryClientProvider>);
  return fetcher;
}
describe("header analysis dialog", () => {
  it("offers a TOP5 shortcut after completion that closes the dialog and opens the briefing", async () => {
    mount(false, "completed", ["/rank?code=005930"]);
    fireEvent.click(screen.getByRole("button", { name: "AI 분석 실행" }));
    const shortcut = await screen.findByRole("button", { name: "TOP5 보러가기" });
    expect(screen.getByRole("button", { name: "분석 시작" })).toHaveClass("analysis-start-secondary");
    fireEvent.click(shortcut);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("route")).toHaveTextContent(/^\/$/);
  });
  it("locks background scrolling, closes the native modal before returning focus, and never starts analysis on opening", async () => {
    document.body.style.overflow = "auto";
    const fetcher = mount(), trigger = screen.getByRole("button", { name: "AI 분석 실행" });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "AI 분석 실행" }), close = within(dialog).getByRole("button", { name: "분석 실행 대화상자 닫기" });
    expect(dialog).toHaveTextContent("약 40초");
    expect(dialog).toHaveTextContent("실행 중에도 현재 결과는 그대로 보입니다.");
    expect(close).toHaveFocus(); await screen.findByRole("button", { name: "분석 시작" });
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    expect(document.body.style.overflow).toBe("hidden"); expect(document.documentElement.style.overflow).toBe("hidden");
    const stops = dialogTabStops(dialog), last = stops[stops.length - 1];
    close.focus(); fireEvent.keyDown(close, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" }); expect(close).toHaveFocus();
    let openAtRestore = true; trigger.addEventListener("focus", () => { openAtRestore = (dialog as HTMLDialogElement).open; }, { once: true });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus(); expect(openAtRestore).toBe(false);
    expect(document.body.style.overflow).toBe("auto"); expect(document.documentElement.style.overflow).toBe(""); document.body.style.overflow = "";
    expect(fetcher.mock.calls.every(call => !call[1]?.method || call[1].method === "GET")).toBe(true);
  });
  it("uses checked or first enabled radios as group boundaries, never an unchecked trailing member", () => {
    const dialog = document.createElement("div"); dialog.innerHTML = '<input type="radio" name="mode" id="first"><input type="radio" name="mode" id="selected" checked><input type="radio" name="mode" id="last"><input type="radio" name="other" id="disabled" disabled checked><input type="radio" name="other" id="enabled"><button hidden>숨김</button>';
    expect(dialogTabStops(dialog).map(node => node.id)).toEqual(["selected", "enabled"]);
    (dialog.querySelector("#selected") as HTMLInputElement).checked = false;
    expect(dialogTabStops(dialog).map(node => node.id)).toEqual(["first", "enabled"]);
  });
  it("displays ongoing analysis in the header and closes without restoring focus on route change", async () => {
    mount(true); const trigger = await screen.findByRole("button", { name: "분석 진행 중" });
    trigger.focus(); fireEvent.click(trigger); expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("대화상자를 닫아도 분석은 서버에서 계속 진행됩니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "경로 이동" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(trigger).not.toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });
});
