import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { BriefingPage, INTRO_STORAGE_KEY } from "./BriefingPage";
import { queryKeys } from "../../shared/api/queries";
import { backendStatusBody, deferred, jsonResponse, pipelineRow } from "../../test/dataFixtures";
import { adaptCandidate } from "../../entities/candidate";
import { candidateSignals } from "../../entities/signals";
import { mergeCandidateDetail } from "./DetailPanel";
import { marketAssessment, MarketOverview } from "./MarketOverview";
import { BRAND_NAME } from "../../shared/lib/brand";
import { chartBundle } from "../../test/fixtures/reportFixtures";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function row(code: string, name: string, prediction: unknown = 0.01) {
  const value = pipelineRow({ ticker: code, ensemble_pred_return: prediction, pred_rank: code === "005930" ? 1 : 2 });
  value.result.ticker = code; value.result.company_name = name;
  return value;
}
const rows = () => [row("005930", "종목 A"), row("000660", "종목 B")];

function mockBackend(overrides?: (path: string, options?: RequestInit) => Promise<Response> | undefined) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = String(url), custom = overrides?.(path, options);
    if (custom) return custom;
    if (path === "/api/candidates" || path === "/api/rank") return jsonResponse(rows());
    if (path === "/api/korean-market/indices") return jsonResponse([
      { symbol: "KOSPI", value: 2700, changeRate: 0.4, source: "cache", asOf: "2026-10-07T09:00:00Z", miniSeriesSource: "history" },
      { symbol: "KOSDAQ", value: 800, changeRate: -0.2, source: "sample", asOf: "2026-10-07T09:00:00Z", miniSeriesSource: "interpolated" },
    ]);
    if (path === "/api/candidates/run") return jsonResponse({ status: "idle" });
    if (path === "/api/backend/status") return jsonResponse(backendStatusBody());
    const code = new URL(path, "http://localhost").searchParams.get("ticker") ?? new URL(path, "http://localhost").searchParams.get("symbol") ?? "005930";
    if (path.startsWith("/api/stock-analysis")) return jsonResponse(row(code, code === "005930" ? "종목 A" : "종목 B"));
    if (path.startsWith("/api/korean-market/stock-chart")) return jsonResponse(chartBundle(code));
    if (path.startsWith("/api/korean-market/quote")) return jsonResponse({ code, currentPrice: 12300, changeRate: 0, source: "cache", asOf: "2026-10-07T09:00:00Z" });
    throw new Error(`unexpected test request: ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function HistoryControls() {
  const navigate = useNavigate(), location = useLocation();
  return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>테스트 뒤로</button></>;
}
function mount(entries = ["/next"], index = entries.length - 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={entries} initialIndex={index} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><HistoryControls /><BriefingPage /></MemoryRouter></QueryClientProvider>);
  return client;
}

describe("briefing with raw model rank fixtures", () => {
  it("selects through buttons, keyboard and URL history", async () => {
    mockBackend(); mount();
    const a = await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    fireEvent.click(a); await screen.findByRole("heading", { name: "종목 A" });
    expect(screen.getByTestId("location")).toHaveTextContent("code=005930");
    fireEvent.keyDown(a, { key: "ArrowDown" }); await screen.findByRole("heading", { name: "종목 B" });
    expect(screen.getByRole("button", { name: "종목 B 000660 · 선택됨 상세 보기" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "테스트 뒤로" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/next$/));
    expect(screen.getByRole("link", { name: "표로 돌아가기" })).toHaveAttribute("href", "#candidate-heading");
  });
  it("uses raw rank and never requests a news-adjusted candidate list or news analysis", async () => {
    const fetcher = mockBackend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([row("999999", "보정 후보", .99)])) : undefined);
    mount(); await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    expect(screen.queryByText("보정 후보")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => String(url) === "/api/rank")).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url) === "/api/candidates")).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("stock-analysis"))).toBe(false);
    expect(fetcher.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  });
  it("keeps a valid deeplink", async () => {
    mockBackend(); mount(["/next?code=000660"]); await screen.findByRole("heading", { name: "종목 B" });
    expect(screen.getByTestId("location")).toHaveTextContent("code=000660");
  });
  it.each(["bad", "000000"])("rejects invalid selection %s", async code => {
    mockBackend(); mount(["/next?code=" + code]); await screen.findByText("유효한 6자리 종목 코드가 필요합니다.");
    expect(document.querySelector("[data-detail-code]")).not.toBeInTheDocument();
  });
  it("replaces predictions with an authoritative empty rank result", async () => {
    let empty = false;
    mockBackend(path => path === "/api/rank" && empty ? Promise.resolve(jsonResponse([])) : undefined);
    mount(); await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    empty = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText("표시할 모델 예측이 없습니다.");
    expect(document.querySelectorAll("[data-model-code]")).toHaveLength(0);
  });
  it("shows rank loading independently of candidate generation", async () => {
    const pending = deferred<Response>(); mockBackend(path => path === "/api/rank" ? pending.promise : undefined); mount();
    await screen.findByText("모델 예측 순위를 조회하고 있습니다.");
    pending.resolve(jsonResponse(rows())); await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
  });
  it("keeps cached rank with a visible refresh failure label", async () => {
    let failure = false;
    mockBackend(path => path === "/api/rank" && failure ? Promise.resolve(new Response("failed", { status: 502 })) : undefined);
    mount(); await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    failure = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText("이전 조회 결과 · 모델 순위 갱신 실패");
    expect(document.querySelectorAll("[data-model-code]")).toHaveLength(2);
  });
  it("shows initial rank failure without fabricating results", async () => {
    mockBackend(path => path === "/api/rank" ? Promise.resolve(new Response("failed", { status: 502 })) : undefined);
    mount(); await screen.findByText("모델 순위 조회 실패 · 분석 결과를 가져오지 못했습니다.");
    expect(document.querySelectorAll("[data-model-code]")).toHaveLength(0);
  });
  it("marks sample predictions", async () => {
    mockBackend(path => path === "/api/rank" ? Promise.resolve(jsonResponse(rows().map(value => ({ ...value, data_meta: { ...value.data_meta, source: "sample" } })))) : undefined);
    mount(); await screen.findByText("예시 데이터 · 실제 분석 결과가 아닙니다.");
  });
  it("does not invent zero from prose and keeps 0.01 as 1 percent", async () => {
    const missing = row("005930", "원본 누락", null); missing.result.summary = "예상수익률 0.00%";
    mockBackend(path => path === "/api/rank" ? Promise.resolve(jsonResponse([missing, row("000660", "실제 예측", .01)])) : undefined);
    mount(); await screen.findByText("원본 예측값 없음");
    expect(document.querySelector('[data-model-code="005930"] .briefing-top-prediction')).toHaveTextContent("—");
    expect(document.querySelector('[data-model-code="000660"] .briefing-top-prediction')).toHaveTextContent("상승");
    expect(document.querySelector('[data-model-code="000660"] .briefing-top-prediction')).not.toHaveTextContent("%");
    expect(document.getElementById("briefing-detail")).not.toHaveTextContent("예상수익률 0.00%");
  });
  it.each([undefined, "close_to_close"])("does not assert a period for target %s", async target => {
    const value = row("005930", "기준 미확인"); value.input_row.prediction_target = target as string;
    mockBackend(path => path === "/api/rank" ? Promise.resolve(jsonResponse([value])) : undefined);
    mount(); await screen.findByText("기준 미확인", { selector: "strong" });
    expect(document.querySelector('[data-model-code] .briefing-top-prediction')).toHaveTextContent("예측 기간 미확인");
    expect(document.querySelector('[data-model-code] .briefing-top-prediction')).not.toHaveTextContent("다음 거래일");
  });
  it("dismisses the introduction without launching analysis", async () => {
    const fetcher = mockBackend(); mount(); fireEvent.click(screen.getByRole("button", { name: "서비스 안내 닫기" }));
    expect(localStorage.getItem(INTRO_STORAGE_KEY)).toBe("dismissed");
    await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    expect(fetcher.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    expect(document.title).toBe("브리핑 · " + BRAND_NAME);
  });
  it("refreshes the visible rank query after invalidation", async () => {
    let latest = false;
    mockBackend(path => path === "/api/rank" && latest ? Promise.resolve(jsonResponse([row("000660", "새 결과")])) : undefined);
    const client = mount(); await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    latest = true; await client.invalidateQueries({ queryKey: queryKeys.rank() });
    await screen.findByRole("button", { name: /새 결과 000660.*상세 보기/ });
    expect(screen.queryByRole("button", { name: /종목 A 005930.*상세 보기/ })).not.toBeInTheDocument();
  });
});

describe("panel model membership and market heuristic", () => {
  it("uses candidate model fields even if stock endpoint has a different ranking/prediction", () => {
    const candidate = adaptCandidate(row("005930", "A"), true).data;
    const detail = adaptCandidate(row("005930", "A", -0.02)).data;
    expect(candidateSignals(mergeCandidateDetail(candidate, detail)!).model).toEqual(candidateSignals(candidate).model);
    expect(mergeCandidateDetail(candidate, detail)?.predictedReturn).toBe(candidate.predictedReturn);
    expect(mergeCandidateDetail(candidate, adaptCandidate(row("000660", "B")).data)?.code).toBe("005930");
  });
  it("does not call sample/absent index data a market direction", () => {
    expect(marketAssessment([])).toContain("판정 불가");
    expect(marketAssessment([{ source: "sample", asOf: null, data: { symbol: "KOSPI", name: null, value: 1, change: 1, changeRate: 50, miniSeries: [], miniSeriesSource: "interpolated" } }])).toContain("판정 불가");
  });
  it("does not apply rise/fall meaning to a missing index change rate", () => {
    render(<MarketOverview indices={[{ source: "cache", asOf: null, data: { symbol: "KOSPI", name: null, value: 2700, change: null, changeRate: null, miniSeries: [], miniSeriesSource: "unknown" } }]} pending={false} error={false} previous={true} />);
    expect(document.querySelector('.briefing-index-title span')).toHaveTextContent("—");
    expect(document.querySelector('.briefing-index-title span')).not.toHaveClass("briefing-rise", "briefing-fall");
  });
});
