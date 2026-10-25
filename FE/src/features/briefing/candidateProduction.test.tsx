import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { BriefingPage } from "./BriefingPage";
import { RankPage } from "../rank/RankPage";
import { StockReportPage } from "../stock/StockReportPage";
import { wholeRank } from "../../test/fixtures/rankFixtures";
import { chartBundle, reportRow } from "../../test/fixtures/reportFixtures";
import { backendStatusBody, jsonResponse } from "../../test/dataFixtures";
import { briefingSignals, resolveMembership } from "./membership";
import { adaptCandidate } from "../../entities/candidate";

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

describe("briefing always uses model TOP5", () => {
  it.each(["not_produced", "available", "empty", "unknown"])("uses raw model ranks when candidate state is %s", async state => {
    const fetcher = backend([], { state }); mount(<BriefingPage />, "/next");
    await screen.findByRole("button", { name: "검증종목001 100001 상세 보기" });
    expect(document.querySelectorAll("[data-model-code]")).toHaveLength(5);
    expect(document.querySelector('[data-model-code="100001"] .briefing-top-rank')).toHaveTextContent("01");
    expect(fetcher.mock.calls.some(([url]) => String(url) === "/api/candidates")).toBe(false);
    expect(document.querySelector('[data-detail-evidence="news"]')).not.toBeInTheDocument();
  });
});

describe("rank and report pages with model-only results", () => {
  it("keeps raw model values while hiding unused final columns, membership notes and candidate filter", async () => {
    const rows = wholeRank(); backend([], { state: "not_produced" }); mount(<RankPage />, "/next/rank");
    await screen.findByText("199종목");
    await screen.findByText("뉴스 보정 미사용 · 모델 순위 기준");
    const first = document.querySelector(`[data-rank-code="${rows[0].input_row.ticker}"]`)!;
    expect(first).toHaveAttribute("data-membership", "unknown");
    expect(document.querySelectorAll('[data-membership="nonCandidate"]')).toHaveLength(0);
    expect(first.querySelector('[data-rank-signal="model"] [data-signal]')).toHaveAttribute("data-signal", "neutral");
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
    expect(document.querySelector("[data-membership]")).not.toHaveTextContent("최종 후보");
    expect(screen.getByTestId("report-prediction")).not.toHaveTextContent("—");
    expect(screen.queryByTestId("report-final-prediction")).not.toBeInTheDocument(); expect(screen.queryByTestId("report-final-rank")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "모델 순위" })).toBeInTheDocument();
    expect(document.querySelector('[data-report-signal="model"] [data-signal]')).toHaveAttribute("data-signal", "neutral");
  });
  it("keeps the true-empty produced case as a confirmed non-candidate", async () => {
    backend([], { state: "empty", count: 0 }); mount(<StockReportPage />, "/next/stock/005930");
    await screen.findByRole("heading", { name: "종목 A" });
    await waitFor(() => expect(document.querySelector("[data-membership]")).toHaveAttribute("data-membership", "nonCandidate"));
  });
});
