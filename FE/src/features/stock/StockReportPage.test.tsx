import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { StockReportPage } from "./StockReportPage";
import { backendStatusBody, deferred, jsonResponse } from "../../test/dataFixtures";
import { reportRow, chartBundle } from "./reportFixtures";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function backend(overrides?: (path: string, options?: RequestInit) => Promise<Response> | undefined) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = String(url), custom = overrides?.(path, options); if (custom) return custom;
    if (path === "/api/candidates") return jsonResponse([reportRow(), reportRow("000660", "종목 B")]);
    if (path === "/api/backend/status") return jsonResponse(backendStatusBody());
    const code = new URL(path, "http://localhost").searchParams.get("ticker") ?? new URL(path, "http://localhost").searchParams.get("symbol") ?? "005930";
    if (path.includes("stock-analysis")) return jsonResponse(reportRow(code, code === "005930" ? "종목 A" : "종목 B", -.03));
    if (path.includes("stock-chart")) return jsonResponse(chartBundle(code));
    if (path.includes("quote")) return jsonResponse({ code, currentPrice: code === "005930" ? 12300 : 99000, change: 0, changeRate: 0, accumulatedVolume: 0, tradingValue: 0, source: "cache" });
    throw new Error(`Unexpected test request ${path}`);
  }); vi.stubGlobal("fetch", fetcher); return fetcher;
}
function mount(path = "/next/stock/005930") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Link to="/next/stock/000660">테스트 B</Link><Routes><Route path="/next/stock/:code" element={<StockReportPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
describe("stock report using actual fetch fixtures", () => {
  it("merges authoritative candidate model fields and preserves raw news without unsafe links", async () => {
    const fetcher = backend(); mount(); await screen.findByRole("heading", { name: "종목 A" });
    expect(screen.getByRole("button", { name: "다시 조회" })).toHaveClass("stock-report-button");
    expect(document.querySelector(".report-button")).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-report-signal="news"] [data-signal]')).toHaveAttribute("data-signal", "unavailable"));
    expect(screen.getByTestId("report-prediction")).toHaveTextContent("+2.00%");
    expect(screen.getByTestId("report-final-prediction")).toHaveTextContent("+2.50%"); expect(screen.getByTestId("report-final-rank")).toHaveTextContent("2위");
    expect(screen.getByText("판정 불명 원본 근거")).toBeInTheDocument(); expect(screen.getByText("감성 미확인")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /원본 기사/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("report-price")).toHaveTextContent("12,300원"); expect(screen.getByText("외국인 합계").nextElementSibling).toHaveTextContent("0원");
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("links only an absolute https original article with safe new-tab attributes", async () => {
    const row = reportRow(); row.news[0].url = "https://news.example/article";
    backend(path => path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : undefined); mount();
    const link = await screen.findByRole("link", { name: /원본 기사/ }); expect(link).toHaveAttribute("href", "https://news.example/article"); expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("does not fetch with an invalid/non-six-digit/zero code", async () => {
    const fetcher = backend(); mount("/next/stock/5930"); await screen.findByRole("heading", { name: "종목 코드를 확인하세요" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps pending/error membership unavailable and [] successful non-membership distinct", async () => {
    const list = deferred<Response>(); let fail = false, empty = false;
    backend(path => path === "/api/candidates" ? fail ? Promise.resolve(new Response("error", { status: 502 })) : empty ? Promise.resolve(jsonResponse([])) : list.promise : undefined);
    mount(); await screen.findByRole("heading", { name: "종목 A" });
    expect(document.querySelector('[data-membership]')).toHaveAttribute("data-membership", "pending");
    expect(document.querySelector('[data-report-signal="model"] [data-signal]')).toHaveAttribute("data-signal", "unavailable");
    list.resolve(jsonResponse([reportRow()])); await waitFor(() => expect(document.querySelector('[data-membership]')).toHaveAttribute("data-membership", "candidate"));
    fail = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" })); await screen.findByText(/현재 멤버십 미확인/);
    expect(document.querySelector('[data-membership]')).toHaveAttribute("data-membership", "unknown");
    expect(document.querySelector('[data-report-signal="model"] [data-signal]')).toHaveAttribute("data-signal", "unavailable");
    fail = false; empty = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await waitFor(() => expect(document.querySelector('[data-membership]')).toHaveAttribute("data-membership", "nonCandidate"));
  });
  it("keeps a negative final candidate positive by the unchanged membership rule and colors its negative value blue", async () => {
    backend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([reportRow("005930", "종목 A", -.02)])) : undefined); mount();
    await screen.findByRole("heading", { name: "종목 A" }); expect(screen.getByTestId("report-prediction")).toHaveTextContent("-2.00%"); expect(screen.getByTestId("report-prediction")).toHaveClass("report-fall");
    expect(document.querySelector('[data-report-signal="model"] [data-signal]')).toHaveAttribute("data-signal", "positive");
  });
  it("never renders a missing model prose zero or invents final rank", async () => {
    const row = reportRow("005930", "원본 누락", null); row.result.summary = "Huber 예상수익률 0.00%."; Object.assign(row.input_row, { final_pred_return: null, final_rank: null });
    backend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([row])) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : undefined); mount();
    await screen.findByRole("heading", { name: "원본 누락" }); expect(screen.getByTestId("report-prediction")).toHaveTextContent("—"); expect(screen.getByTestId("report-final-rank")).toHaveTextContent("원본 미제공"); expect(document.body).not.toHaveTextContent("Huber 예상수익률 0.00%");
  });
  it("cancels late A stock/quote/chart on code change and renders B only", async () => {
    const pending = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    const fetcher = backend(path => path.includes("005930") ? path.includes("stock-analysis") ? pending[0].promise : path.includes("quote") ? pending[1].promise : pending[2].promise : undefined);
    mount(); await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => String(path).includes("005930") && !String(path).startsWith("/api/performance"))).toHaveLength(3));
    fireEvent.click(screen.getByRole("link", { name: "테스트 B" })); await screen.findByRole("heading", { name: "종목 B" });
    await waitFor(() => expect(screen.getByTestId("report-price")).toHaveTextContent("99,000원"));
    expect(fetcher.mock.calls.filter(([path]) => String(path).includes("005930")).every(([, options]) => options?.signal?.aborted)).toBe(true);
    pending[0].resolve(jsonResponse(reportRow("005930", "늦은 A"))); pending[1].resolve(jsonResponse({ code: "005930", currentPrice: 1 })); pending[2].resolve(jsonResponse(chartBundle())); await Promise.resolve();
    expect(document.querySelector('[data-report-code]')).toHaveAttribute("data-report-code", "000660"); expect(document.body).not.toHaveTextContent("늦은 A");
    await waitFor(() => expect(document.querySelector('[data-chart-code]')).toHaveAttribute("data-chart-code", "000660"));
  });
  it("clears chart while switching ranges and does not let a late range replace the selected range", async () => {
    const late = deferred<Response>(); let chartReads = 0;
    backend(path => path.includes("stock-chart") && ++chartReads === 2 ? late.promise : undefined); mount(); await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "1개월" })); await screen.findByText("선택한 기간의 가격 이력을 조회하고 있습니다."); expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3개월" })); await screen.findByRole("img"); expect(document.querySelector('[data-chart-range]')).toHaveAttribute("data-chart-range", "3M");
    late.resolve(jsonResponse(chartBundle())); await Promise.resolve(); expect(document.querySelector('[data-chart-range]')).toHaveAttribute("data-chart-range", "3M");
  });
  it.each(["sample", "unknown"])("does not draw %s chart data as history", async source => {
    backend(path => path.includes("stock-chart") ? Promise.resolve(jsonResponse(chartBundle("005930", source))) : undefined); mount(); await screen.findByText(source === "sample" ? "예시 데이터이므로 실제 가격 이력 차트를 제공하지 않습니다." : "가격 이력 출처 미확인으로 차트를 제공하지 않습니다."); expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("provides pending/empty/error states without switching to another range or fabricating a sample", async () => {
    let failure = false; const bundle = chartBundle(); bundle.chartData.ranges["1D"].prices = []; bundle.chartData.ranges["1D"].candles = [];
    backend(path => path.includes("stock-chart") ? failure ? Promise.resolve(new Response("error", { status: 502 })) : Promise.resolve(jsonResponse(bundle)) : undefined); mount();
    await screen.findByText("유효한 관측 시각과 가격이 없습니다."); expect(screen.getByRole("button", { name: "1일" })).toHaveAttribute("aria-pressed", "true");
    failure = true; fireEvent.click(screen.getByRole("button", { name: "가격 이력 다시 조회" })); await screen.findByText("이전 조회 결과 · 가격 이력 갱신 실패");
  });
  it("treats stock null as absent analysis without sample/model fabrication", async () => {
    backend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(null)) : undefined); mount();
    await screen.findByText("상세 분석 결과가 없습니다."); expect(document.body).toHaveTextContent("확인 가능한 분석 근거가 없습니다"); expect(screen.getByTestId("report-prediction")).toHaveTextContent("—");
  });
  it.each(["sample", "mismatch"])("rejects %s stock responses explicitly rather than rendering their report", async kind => {
    const row = reportRow(kind === "mismatch" ? "000660" : "005930", "허용되지 않은 분석");
    if (kind === "sample") Object.assign(row.data_meta, { source: "sample" });
    backend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : undefined); mount();
    await screen.findByText(kind === "sample" ? "예시 분석 응답은 제공하지 않습니다. 확인 가능한 후보 원본만 표시합니다." : "종목 코드가 일치하지 않아 분석 응답을 표시하지 않습니다.");
    expect(screen.queryByRole("heading", { name: "허용되지 않은 분석" })).not.toBeInTheDocument(); expect(screen.getByTestId("report-prediction")).toHaveTextContent("—");
  });
  it("keeps previous analysis/quote data with background failure warnings", async () => {
    let failure = false; backend(path => failure && (path.includes("stock-analysis") || path.includes("quote")) ? Promise.resolve(new Response("error", { status: 502 })) : undefined); mount(); await screen.findByRole("heading", { name: "종목 A" }); await waitFor(() => expect(screen.getByTestId("report-price")).toHaveTextContent("12,300원"));
    failure = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" })); await screen.findByText("이전 조회 결과 · 분석 갱신 실패"); await screen.findByText("이전 조회 결과 · 시세 갱신 실패"); expect(screen.getByTestId("report-price")).toHaveTextContent("12,300원");
  });
});
