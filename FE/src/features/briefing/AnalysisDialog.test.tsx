import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AnalysisDialog, dialogTabStops } from "./AnalysisDialog";
import { AppShell } from "../../app/AppShell";
import { AppProviders } from "../../app/providers";
import { backendStatusBody, deferred, jsonResponse, pipelineRow } from "../../test/dataFixtures";
import { queries } from "../../shared/api/queries";

const clients: QueryClient[] = [];
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function(this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); focusManager.setFocused(undefined); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function RouteProbe() { const navigate = useNavigate(), location = useLocation(); return <><button onClick={() => navigate("/rank")}>경로 이동</button><output data-testid="route">{location.pathname + location.search}</output></>; }
function mount(running = false, status = running ? "running" : "idle", initialEntries = ["/"], post?: () => Promise<Response>) {
  const fetcher = vi.fn<typeof fetch>(async (path, request) => request?.method === "POST" && post ? post() : jsonResponse(String(path) === "/api/backend/status" ? backendStatusBody({ state: "not_produced" }) : { status, mode: "model_only" }));
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AnalysisDialog /><RouteProbe /></MemoryRouter></QueryClientProvider>);
  return fetcher;
}
describe("header analysis dialog", () => {
  it.each(["idle", "running"] as const)("keeps an accessible trigger name when its mobile text is hidden (%s)", async status => {
    mount(false, status);
    const trigger = await screen.findByRole("button", { name: status === "running" ? "분석 진행 중" : "AI 분석 실행" });
    trigger.querySelector("span")!.style.display = "none";
    expect(trigger).toHaveAccessibleName(status === "running" ? "분석 진행 중" : "AI 분석 실행");
  });
  it("automatically refreshes briefing and rank on the focused original rank tab after the dialog closes", async () => {
    let completed = false;
    const fetcher = vi.fn<typeof fetch>(async path => {
      const revision = completed ? "new result" : "old result";
      if (String(path) === "/api/backend/status") return jsonResponse(backendStatusBody({ state: "not_produced" }, { runtime: { state: completed ? "completed" : "running" } }));
      if (String(path) === "/api/briefing") return jsonResponse({ version: 1, status: "ready", narrative: { overview: revision }, stocks: [] });
      if (String(path) === "/api/rank") {
        const row = pipelineRow({ company_name: revision });
        return jsonResponse([{ ...row, result: { ...row.result, company_name: revision } }]);
      }
      return jsonResponse({ status: completed ? "completed" : "running", runId: "observed-run", elapsedMs: completed ? 38000 : 1000 });
    });
    vi.stubGlobal("fetch", fetcher); focusManager.setFocused(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } }); clients.push(client);
    const rank = new QueryObserver(client, queries.rank()), briefing = new QueryObserver(client, queries.briefing());
    const stopRank = rank.subscribe(() => {}), stopBriefing = briefing.subscribe(() => {});
    try {
      render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/rank"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AnalysisDialog /></MemoryRouter></QueryClientProvider>);
      fireEvent.click(await screen.findByRole("button", { name: "분석 진행 중" }));
      fireEvent.click(screen.getByRole("button", { name: "분석 실행 대화상자 닫기" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect([rank.getCurrentResult().data?.data[0]?.name, briefing.getCurrentResult().data?.narrative.overview]).toEqual(["old result", "old result"]));
      vi.useFakeTimers();
      // Re-arm the running observer's actual five-second poll under the fake clock.
      act(() => client.setQueryData(queries.analysisRun().queryKey, { data: { status: "running", runId: "observed-run", elapsedMs: 2000, progress: null, error: null, result: null }, source: "live", asOf: null }));
      completed = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); await vi.advanceTimersByTimeAsync(100); });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect([rank.getCurrentResult().data?.data[0]?.name, briefing.getCurrentResult().data?.narrative.overview]).toEqual(["new result", "new result"]);
      expect(screen.getByRole("button", { name: "AI 분석 실행" })).toBeInTheDocument();
      expect(fetcher.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    } finally { stopRank(); stopBriefing(); }
  });
  it("mounts local tokenless analysis controls without updating AppShell during render", async () => {
    window.sessionStorage.clear();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async path => jsonResponse(String(path) === "/api/backend/status"
      ? { ...backendStatusBody({ state: "not_produced" }), localWriteAllowed: true } : { status: "idle" })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppProviders><QueryClientProvider client={client}><AppShell /></QueryClientProvider></AppProviders></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "AI 분석 실행" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    expect(consoleError.mock.calls.filter(args => args.some(value => String(value).includes("Cannot update a component")))).toEqual([]);
  });
  it("moves focus to close before disabling the focused launch button and keeps run details in the trap", async () => {
    const pending = deferred<Response>(); mount(false, "idle", ["/"], () => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "AI 분석 실행" }));
    const start = await screen.findByRole("button", { name: "분석 시작" });
    await waitFor(() => expect(start).toBeEnabled()); start.focus(); fireEvent.click(start);
    const close = screen.getByRole("button", { name: "분석 실행 대화상자 닫기" }); expect(close).toHaveFocus();
    pending.resolve(jsonResponse({ status: "running", runId: "fixture-run" }));
    await screen.findByRole("progressbar"); expect(close).toHaveFocus();
    const dialog = screen.getByRole("dialog"), summary = screen.getByText("실행 정보");
    const stops = dialogTabStops(dialog); expect(stops[stops.length - 1]).toBe(summary);
    summary.focus(); fireEvent.keyDown(summary, { key: "Tab" }); expect(close).toHaveFocus();
  });
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
    expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
    expect(within(dialog).getByRole("heading")).toHaveTextContent("AI 분석 실행");
    expect(within(dialog).getByRole("region", { name: "AI 분석 실행" })).toBeInTheDocument();
    expect(within(dialog).queryByText("새 분석 실행")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("보통 1분 안팎이 걸리며");
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

beforeEach(() => window.sessionStorage.setItem("kospi-admin-token.v1", "fixture-admin"));
