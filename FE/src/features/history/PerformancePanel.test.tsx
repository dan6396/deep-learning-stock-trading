import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { classificationLabel, PerformancePanel } from "./PerformancePanel";
import { jsonResponse } from "../../test/dataFixtures";
const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount(code?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PerformancePanel detailed code={code} /></MemoryRouter></QueryClientProvider>);
}
const payload = { version: 1, source: "cache", asOf: null, summaries: [], runs: [], reasons: ["목표 거래일 종료 대기"], collector: { status: "idle", checkedAt: null, error: null } };
it("shows the missing-result reason and posts collection only after the user clicks", async () => {
  const fetcher = vi.fn(async () => jsonResponse(payload)); vi.stubGlobal("fetch", fetcher); mount();
  expect(await screen.findByText("목표 거래일 종료 대기")).toBeInTheDocument();
  expect(fetcher.mock.calls).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "실제 가격 수집" }));
  await waitFor(() => expect(fetcher.mock.calls.some(call => (call as unknown[])[0] === "/api/performance/collect" && ((call as unknown[])[1] as RequestInit)?.method === "POST")).toBe(true));
});
it("shows frozen predictions joined to exact-day actual prices", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...payload, runs: [{ runId: "fixture-run-id", kind: "adhoc", officialEligible: false, mode: "model_only", baseDate: "2026-10-07", targetDate: "2026-10-08", selectedCount: 1, measuredCount: 1, predictedReturn: .02, actualReturn: .1, reason: "수시 실행 · 공식 집계 제외", measurements: [{ code: "005930", name: "삼성전자", predictedReturn: .02, date: "2026-10-08", open: 100, close: 110, actualReturn: .1 }] }] })));
  mount(); await screen.findByText("실행 식별자 fixture-run-id");
  fireEvent.click(screen.getByText("종목별 예측·실제 가격 1종목"));
  expect(screen.getByText(/KIS 시가 100원 → 종가 110원/)).toHaveTextContent("+10.00%");
  expect(screen.getByText("수시 · 공식 집계 제외")).toBeInTheDocument();
});
it("keeps collection disabled while the backend job is running", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...payload, collector: { ...payload.collector, status: "running" } })));
  mount(); expect(await screen.findByRole("button", { name: "실제 가격 수집 중" })).toBeDisabled();
});
it("filters stock performance using the symbol query", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(payload)); vi.stubGlobal("fetch", fetcher); mount("005930");
  await screen.findByText("목표 거래일 종료 대기"); expect(fetcher.mock.calls[0][0]).toBe("/api/performance?symbol=005930");
});
it("distinguishes official request, verification and exclusion", () => {
  expect(classificationLabel({ kind: "official", officialEligible: null })).toBe("공식 요청 · 검증 대기");
  expect(classificationLabel({ kind: "official", officialEligible: true })).toBe("공식 · 검증 통과");
  expect(classificationLabel({ kind: "official", officialEligible: false })).toBe("공식 요청 · 집계 제외");
});
