import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { BriefingPage } from "./BriefingPage";
import { RankPage } from "../rank/RankPage";
import { StockReportPage } from "../stock/StockReportPage";
import { wholeRank } from "../rank/rankFixtures";
import { chartBundle, reportRow } from "../stock/reportFixtures";
import { backendStatusBody, deferred, jsonResponse } from "../../test/dataFixtures";
import { briefingSignals, resolveMembership, UNPRODUCED_REASON } from "./membership";
import { adaptCandidate } from "../../entities/candidate";
import { formatDate } from "../../shared/lib/format";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });

type Status = { state: string; count?: number | null } | "error" | Promise<Response>;
function backend(candidates: unknown[], status: Status, rank: unknown[] | "error" = wholeRank()) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path === "/api/backend/status") return status === "error" ? new Response("{}", { status: 502 }) : status instanceof Promise ? status : jsonResponse(backendStatusBody(status));
    if (path === "/api/candidates") return jsonResponse(candidates);
    if (path === "/api/rank") return rank === "error" ? new Response("{}", { status: 502 }) : jsonResponse(rank);
    if (path === "/api/candidates/run") return jsonResponse({ status: "idle" });
    if (path === "/api/korean-market/indices") return jsonResponse([]);
    const code = new URL(path, "http://localhost").searchParams.get("ticker") ?? new URL(path, "http://localhost").searchParams.get("symbol") ?? "005930";
    if (path.includes("stock-analysis")) return jsonResponse(reportRow(code, "종목 A", -.03));
    if (path.includes("stock-chart")) return jsonResponse(chartBundle(code));
    if (path.includes("quote")) return jsonResponse({ code, currentPrice: 12300, change: 0, changeRate: 0, accumulatedVolume: 0, tradingValue: 0, source: "cache" });
    throw new Error(`Unexpected test request ${path}`);
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function mount(element: JSX.Element, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LocationProbe /><Routes><Route path="/next/stock/:code" element={element} /><Route path="*" element={element} /></Routes></MemoryRouter></QueryClientProvider>);
}
const statusCalls = (fetcher: ReturnType<typeof backend>) => fetcher.mock.calls.filter(([url]) => String(url) === "/api/backend/status").length;

describe("membership resolution for an authoritative empty candidate list", () => {
  const settled = { isPending: false, isError: false };
  it("claims non-candidate only when the final list was produced", () => {
    expect(resolveMembership(settled, false, "produced")).toBe("nonCandidate");
    expect(resolveMembership(settled, false, "unproduced")).toBe("unknown");
    expect(resolveMembership(settled, false, "unknown")).toBe("unknown");
    expect(resolveMembership(settled, false, "pending")).toBe("pending");
    expect(resolveMembership(settled, true, "produced")).toBe("candidate");
    expect(resolveMembership({ isPending: true, isError: false }, false, "produced")).toBe("pending");
    expect(resolveMembership({ isPending: false, isError: true }, true, "produced")).toBe("unknown");
  });
  it("evaluates raw model, news and supply independently of unproduced final candidates", () => {
    const candidate = adaptCandidate(reportRow("005930", "종목 A", -.03)).data;
    const unknown = briefingSignals(candidate, "unknown", "unproduced"), produced = briefingSignals(candidate, "nonCandidate");
    expect(unknown.model).toEqual(produced.model);
    expect(unknown.news.state).toBe("unavailable"); expect(unknown.supply).toEqual(produced.supply);
    expect(unknown.agreement.evaluable + unknown.agreement.unavailable).toBe(2);
  });
});

describe("briefing with model-only (not_produced) candidates", () => {
  it("shows model Top-5 instead of asserting zero final candidates", async () => {
    backend([], { state: "not_produced" }); mount(<BriefingPage />, "/next");
    await screen.findByRole("heading", { name: "Transformer Ensemble Top-5" });
    expect(screen.queryByText("최종 후보가 없습니다.")).not.toBeInTheDocument();
    expect(document.querySelector(".briefing-count")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-model-code]")).toHaveLength(5);
    expect(document.querySelector('.briefing-table-help')).toHaveTextContent("모델·수급 2개 근거 기준");
    expect(screen.queryByText(/뉴스 보정 최종 후보 미생성/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "검증종목001 100001 · 선택됨 상세 보기" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/next$/);
    expect(document.querySelector('[data-model-code="100001"] [data-value="rank"]')).toHaveTextContent("01");
    expect(document.querySelector('.briefing-result-meta')).toHaveTextContent("모집단 199종목");
    expect(document.querySelector('.briefing-comparison-footer')).toHaveTextContent("원본 순위 6위 이하 194종목은 전체 순위에서 확인");
    expect(document.querySelector('#briefing-detail')).toHaveTextContent(`분석 저장 시각 ${formatDate("2026-10-07T09:00:00Z", true)}`);
    expect(document.querySelectorAll('[data-model-code] .briefing-evidence-dots i')).toHaveLength(10);
    expect(document.querySelector('[data-detail-evidence="news"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-model-code="100001"] [data-value="predictedReturn"]')).toHaveTextContent("0.00%");
    expect(screen.getByText(/다음 거래일 시가→종가 모델 예측 · 실제 성과 아님/)).toBeInTheDocument();
  });
  it("selects only ranked rows by original rank and keeps source dates, pool and a short count", async () => {
    const rows = wholeRank().slice(0, 4);
    [42, null, 17, 6].forEach((rank, index) => Object.assign(rows[index].input_row, { pred_rank: rank, prediction_base_date: "2026-10-08" }));
    backend([], { state: "not_produced" }, rows); mount(<BriefingPage />, "/next");
    await screen.findByRole("heading", { name: "Transformer Ensemble Top-5" });
    expect([...document.querySelectorAll("[data-model-code]")].map(row => row.getAttribute("data-model-code"))).toEqual(["100004", "100003", "100001"]);
    expect([...document.querySelectorAll('[data-model-code] [data-value="rank"]')].map(cell => cell.textContent)).toEqual(["06", "17", "42"]);
    expect(document.querySelector(".briefing-result-meta")).toHaveTextContent(formatDate("2026-10-08"));
    expect(document.querySelector(".briefing-result-meta")).toHaveTextContent(`저장 시각 ${formatDate("2026-10-07T09:00:00Z", true)}`);
    expect(document.querySelector('.briefing-comparison-footer')).toHaveTextContent("나머지 종목은 전체 순위에서 확인");
    fireEvent.click(document.querySelector('[data-model-code="100004"] [data-value="rank"]')!);
    expect(screen.getByTestId("location")).toHaveTextContent("/next?code=100004");
  });
  it("does not infer a final-candidate cutoff from consecutive original model ranks", async () => {
    backend(wholeRank().slice(0, 5), { state: "available", count: 5 }); mount(<BriefingPage />, "/next");
    await screen.findByRole("heading", { name: "후보 5종목 비교" });
    expect(document.querySelector('.briefing-comparison-footer')).toHaveTextContent("나머지 종목은 전체 순위에서 확인");
    expect(document.querySelector('.briefing-comparison-footer')).not.toHaveTextContent("6위 이하");
  });
  it.each(["empty", "error", "unranked"])("falls back to the existing notice for %s rank results without samples", async scenario => {
    const rows = wholeRank().map(row => ({ ...row, input_row: { ...row.input_row, pred_rank: null } }));
    backend([], { state: "not_produced" }, scenario === "error" ? "error" : scenario === "empty" ? [] : rows); mount(<BriefingPage />, "/next");
    await screen.findByText(/뉴스 보정 최종 후보 미생성/);
    expect(screen.queryByRole("heading", { name: "Transformer Ensemble Top-5" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-model-code]")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "전체 순위" })).toBeInTheDocument();
  });
  it("removes cached Top-5 after a rank refresh fails", async () => {
    let failure = false;
    const fetcher = backend([], { state: "not_produced" }), healthy = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, options) => String(url) === "/api/rank" && failure ? new Response("{}", { status: 502 }) : healthy(url, options));
    mount(<BriefingPage />, "/next"); await screen.findByRole("heading", { name: "Transformer Ensemble Top-5" });
    failure = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText(/뉴스 보정 최종 후보 미생성/);
    expect(document.querySelectorAll("[data-model-code]")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Transformer Ensemble Top-5" })).not.toBeInTheDocument();
  });
  it("leaves final membership unknown while evaluating the raw model prediction", async () => {
    backend([], { state: "not_produced" }); mount(<BriefingPage />, "/next?code=005930");
    await waitFor(() => expect(document.querySelector("#briefing-detail [data-membership]")).toHaveAttribute("data-membership", "unknown"));
    expect(document.getElementById("briefing-detail")).not.toHaveTextContent("최종 후보 외 종목");
    expect(document.querySelector("#briefing-detail .briefing-detail-signals [data-signal]")).toHaveAttribute("data-signal", "negative");
    expect(document.getElementById("briefing-detail")).not.toHaveTextContent("뉴스");
  });
  it("stays pending while the status read is in flight, then resolves a produced empty list to non-candidate", async () => {
    const status = deferred<Response>(); backend([], status.promise); mount(<BriefingPage />, "/next?code=005930");
    await waitFor(() => expect(document.querySelector("#briefing-detail [data-membership]")).toHaveAttribute("data-membership", "pending"));
    expect(screen.queryByText("최종 후보가 없습니다.")).not.toBeInTheDocument();
    status.resolve(jsonResponse(backendStatusBody({ state: "empty", count: 0 })));
    await waitFor(() => expect(document.querySelector("#briefing-detail [data-membership]")).toHaveAttribute("data-membership", "nonCandidate"));
    await screen.findByText("최종 후보가 없습니다.");
  });
  it.each([["status request fails", "error" as const], ["missing result", { state: "missing" }], ["stale result", { state: "stale" }], ["blocked by failed run", { state: "blocked" }], ["unknown availability", { state: "unknown" }]])(
    "does not assert non-candidate when %s", async (_name, status) => {
      backend([], status); mount(<BriefingPage />, "/next?code=005930");
      await waitFor(() => expect(document.querySelector("#briefing-detail [data-membership]")).toHaveAttribute("data-membership", "unknown"));
      expect(screen.queryByText("최종 후보가 없습니다.")).not.toBeInTheDocument();
      expect(document.getElementById("briefing-detail")).not.toHaveTextContent("최종 후보 외 종목");
    });
  it("shares the launch-control status read and preserves membership from a non-empty list", async () => {
    const fetcher = backend([reportRow()], { state: "not_produced" }); mount(<BriefingPage />, "/next?code=005930");
    await waitFor(() => expect(document.querySelector("#briefing-detail [data-membership]")).toHaveAttribute("data-membership", "candidate"));
    expect(statusCalls(fetcher)).toBe(1);
  });
});

describe("rank and report pages with model-only results", () => {
  it("keeps raw model values while hiding unused final columns, membership notes and candidate filter", async () => {
    const rows = wholeRank(); backend([], { state: "not_produced" }); mount(<RankPage />, "/next/rank");
    await screen.findByText("199종목");
    await screen.findByText("뉴스 보정 미사용 · 모델 예측 순위 기준");
    const first = document.querySelector(`[data-rank-code="${rows[0].input_row.ticker}"]`)!;
    expect(first).toHaveAttribute("data-membership", "unknown");
    expect(document.querySelectorAll('[data-membership="nonCandidate"]')).toHaveLength(0);
    expect(first.querySelector('[data-rank-signal="model"] [data-signal]')).toHaveAttribute("data-signal", "negative");
    expect(first.querySelector('[data-value="rank"]')).not.toHaveTextContent("—");
    expect(screen.queryByRole("columnheader", { name: "최종 보정 순위" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "최종 보정 예측" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "뉴스" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "최종 후보만" })).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-value="finalRank"], [data-value="finalPredictedReturn"], [data-rank-signal="news"]')).toHaveLength(0);
    expect(screen.queryByText("최종 후보 미확인")).not.toBeInTheDocument();
    expect(document.querySelector("[data-candidate-production]")).not.toHaveClass("rank-notice");
  });
  it("labels the report as unknown membership instead of a non-candidate and keeps the raw prediction", async () => {
    backend([], { state: "not_produced" }); mount(<StockReportPage />, "/next/stock/005930");
    await screen.findByRole("heading", { name: "종목 A" });
    await waitFor(() => expect(document.querySelector("[data-membership]")).toHaveAttribute("data-membership", "unknown"));
    expect(document.querySelector("[data-membership]")).toHaveTextContent("최종 후보 여부 미확인");
    expect(document.querySelector("[data-membership]")).not.toHaveTextContent("최종 후보 외 종목");
    expect(screen.getByTestId("report-prediction")).not.toHaveTextContent("—");
    expect(document.querySelector('[data-report-signal="model"] [data-signal]')).toHaveAttribute("data-signal", "negative");
  });
  it("keeps the true-empty produced case as a confirmed non-candidate", async () => {
    backend([], { state: "empty", count: 0 }); mount(<StockReportPage />, "/next/stock/005930");
    await screen.findByRole("heading", { name: "종목 A" });
    await waitFor(() => expect(document.querySelector("[data-membership]")).toHaveAttribute("data-membership", "nonCandidate"));
  });
});
