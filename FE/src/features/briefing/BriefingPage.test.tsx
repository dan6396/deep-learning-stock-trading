import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { chartBundle } from "../stock/reportFixtures";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function row(code: string, name: string, prediction: unknown = 0.01) {
  const value = pipelineRow({ ticker: code, ensemble_pred_return: prediction, pred_rank: 50 });
  value.result.ticker = code; value.result.company_name = name;
  return value;
}
const rows = () => [row("005930", "종목 A"), row("000660", "종목 B")];

function mockBackend(overrides?: (path: string, options?: RequestInit) => Promise<Response> | undefined) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = String(url), custom = overrides?.(path, options);
    if (custom) return custom;
    if (path === "/api/candidates") return jsonResponse(rows());
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

describe("briefing with fetch fixtures", () => {
  it("selects through native buttons, ArrowDown and URL history without a meaningless close button", async () => {
    mockBackend(); mount();
    const a = await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    fireEvent.click(a);
    await screen.findByRole("heading", { name: "종목 A" });
    expect(screen.getByTestId("location")).toHaveTextContent("/next?code=005930");
    fireEvent.keyDown(a, { key: "ArrowDown" });
    await screen.findByRole("heading", { name: "종목 B" });
    expect(screen.getByRole("button", { name: "종목 B 000660 · 선택됨 상세 보기" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "테스트 뒤로" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/next$/));
    fireEvent.click(a);
    await screen.findByRole("heading", { name: "종목 A" });
    expect(screen.queryByRole("button", { name: "종목 상세 닫기" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "표로 돌아가기" })).toHaveAttribute("href", "#candidate-heading");
  });
  it("keeps a valid deeplink on mount and rejects invalid six-digit selection", async () => {
    mockBackend(); mount(["/next?code=000660"]);
    await screen.findByRole("heading", { name: "종목 B" });
    expect(screen.getByTestId("location")).toHaveTextContent("code=000660");
  });
  it("ignores a late A response after switching to B and forwards cancellation", async () => {
    const pending = deferred<Response>();
    const fetcher = mockBackend(path => path === "/api/stock-analysis?ticker=005930" ? pending.promise : undefined);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("ticker=005930"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "종목 B 000660 상세 보기" }));
    await screen.findByRole("heading", { name: "종목 B" });
    const aCall = fetcher.mock.calls.find(([url]) => String(url).includes("ticker=005930"));
    expect(aCall?.[1]?.signal?.aborted).toBe(true);
    pending.resolve(jsonResponse(row("005930", "오래된 A 상세")));
    await Promise.resolve();
    expect(screen.queryByRole("heading", { name: "오래된 A 상세" })).not.toBeInTheDocument();
    expect(document.getElementById("briefing-detail")).toHaveAttribute("data-detail-code", "000660");
  });
  it("replaces candidates with a genuinely empty result", async () => {
    let empty = false;
    mockBackend(path => path === "/api/candidates" && empty ? Promise.resolve(jsonResponse([])) : undefined);
    mount(); await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    empty = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText("최신 분석 결과가 비어 있습니다.");
    expect(screen.queryByRole("button", { name: /종목 A 005930/ })).not.toBeInTheDocument();
  });
  it("keeps pending deeplink membership/model unavailable until the candidate list succeeds", async () => {
    const list = deferred<Response>();
    mockBackend(path => path === "/api/candidates" ? list.promise : undefined);
    mount(["/next?code=005930"]);
    await screen.findByRole("heading", { name: "종목 A" });
    const panel = document.getElementById("briefing-detail")!;
    expect(panel).toHaveTextContent("최종 후보 여부 확인 중");
    expect(panel.querySelector('.briefing-detail-signals [data-signal]')).toHaveAttribute("data-signal", "unavailable");
    list.resolve(jsonResponse(rows()));
    await waitFor(() => expect(panel.querySelector('[data-membership]')).toHaveAttribute("data-membership", "candidate"));
    expect(panel.querySelector('.briefing-detail-signals [data-signal]')).toHaveAttribute("data-signal", "positive");
    expect(document.title).toBe(`브리핑 · ${BRAND_NAME}`);
  });
  it("does not call an error deeplink non-candidate even when stock analysis succeeds", async () => {
    mockBackend(path => path === "/api/candidates" ? Promise.resolve(new Response("failed", { status: 502 })) : undefined);
    mount(["/next?code=005930"]);
    await screen.findByRole("heading", { name: "종목 A" });
    await screen.findByText("후보 조회 실패 · 분석 결과를 가져오지 못했습니다.");
    const panel = document.getElementById("briefing-detail")!;
    expect(panel).toHaveTextContent("최종 후보 여부 미확인");
    expect(panel).not.toHaveTextContent("최종 후보 외 종목");
    expect(panel.querySelector('.briefing-detail-signals [data-signal]')).toHaveAttribute("data-signal", "unavailable");
  });
  it("identifies non-membership only from a successful empty list", async () => {
    mockBackend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : undefined);
    mount(["/next?code=005930"]);
    await screen.findByRole("heading", { name: "종목 A" });
    await screen.findByText("최신 분석 결과가 비어 있습니다.");
    expect(document.querySelector('[data-membership]')).toHaveAttribute("data-membership", "nonCandidate");
    expect(document.getElementById("briefing-detail")).toHaveTextContent("최종 후보 외 종목");
  });
  it("fails model membership closed in both old table and panel after background list failure", async () => {
    let failure = false;
    mockBackend(path => path === "/api/candidates" && failure ? Promise.resolve(new Response("failed", { status: 502 })) : undefined);
    mount(["/next?code=005930"]);
    await screen.findByRole("button", { name: "종목 A 005930 · 선택됨 상세 보기" });
    failure = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText("이전 조회 결과 · 후보 갱신 실패");
    expect(document.querySelector('[data-membership]')).toHaveAttribute("data-membership", "unknown");
    expect(document.querySelector('[data-candidate-code="005930"] [data-signal]')).toHaveAttribute("data-signal", "unavailable");
    expect(document.querySelector('.briefing-detail-signals [data-signal]')).toHaveAttribute("data-signal", "unavailable");
  });
  it("distinguishes initial error from empty and background error from successful stale data", async () => {
    let failure = false;
    mockBackend(path => path === "/api/candidates" && failure ? Promise.resolve(new Response("failed", { status: 502 })) : undefined);
    mount(); await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    failure = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText("이전 조회 결과 · 후보 갱신 실패");
    expect(screen.getByRole("button", { name: /종목 A 005930.*상세 보기/ })).toBeInTheDocument();
    expect(screen.queryByText("최종 후보가 없습니다.")).not.toBeInTheDocument();
  });
  it("shows an initial API failure without a sample table", async () => {
    mockBackend(path => path === "/api/candidates" ? Promise.resolve(new Response("failed", { status: 502 })) : undefined);
    mount(); await screen.findByText("후보 조회 실패 · 분석 결과를 가져오지 못했습니다.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("최종 후보가 없습니다.")).not.toBeInTheDocument();
  });
  it("marks sample candidates and cache/sample/interpolated market evidence", async () => {
    mockBackend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse(rows().map(row => ({ ...row, data_meta: { ...row.data_meta, source: "sample" } })))) : undefined);
    mount(); await screen.findByText("예시 데이터 · 실제 분석 결과가 아닙니다.");
    expect(screen.getAllByText("예시 데이터").length).toBeGreaterThan(0);
    expect(document.querySelector(".briefing-index-grid")).not.toBeInTheDocument();
    expect(screen.getByText(/확인 가능한 지수가 부족합니다/)).toBeInTheDocument();
  });
  it("does not render a fabricated model zero from legacy summary prose", async () => {
    const missing = row("005930", "원본 누락", null); missing.result.summary = "Huber 예상수익률 0.00%.";
    mockBackend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([missing])) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(missing)) : undefined);
    mount(["/next?code=005930"]);
    await screen.findByRole("heading", { name: "원본 누락" });
    expect(document.getElementById("briefing-detail")).not.toHaveTextContent("Huber 예상수익률 0.00%");
    expect(screen.getByText(/원본 모델 예측값이 없어 수익률 요약/)).toBeInTheDocument();
    expect(within(document.getElementById("briefing-detail")!).getByText("모델 예측수익률").nextElementSibling).toHaveTextContent("—");
  });
  it("dismisses first-visit introduction persistently without automatically launching analysis", async () => {
    const fetcher = mockBackend(); mount();
    fireEvent.click(screen.getByRole("button", { name: "서비스 안내 닫기" }));
    expect(localStorage.getItem(INTRO_STORAGE_KEY)).toBe("dismissed");
    expect(screen.queryByRole("region", { name: "서비스 첫 방문 안내" })).not.toBeInTheDocument();
    await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    expect(screen.queryByRole("button", { name: "분석 시작" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    expect(screen.queryByRole("region", { name: "성과 기록" })).not.toBeInTheDocument();
    expect(screen.getByText("모의투자 기록 · 10/6–10/8")).toBeInTheDocument();
    expect(screen.queryByText(/\d+\/20/)).not.toBeInTheDocument();
  });
  it("reattaches to GET analysis completion and invalidates an older candidate read", async () => {
    let version = 1;
    mockBackend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([row("005930", `버전 ${version}`)])) : undefined);
    const client = mount(); await screen.findByRole("button", { name: /버전 1 005930.*상세 보기/ });
    version = 2;
    client.setQueryData(queryKeys.analysisRun(), { data: { status: "completed", elapsedMs: 10, progress: { updatedAt: 2 }, result: { rows: 1 } }, source: "unknown", asOf: null });
    await screen.findByRole("button", { name: /버전 2 005930.*상세 보기/ });
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
