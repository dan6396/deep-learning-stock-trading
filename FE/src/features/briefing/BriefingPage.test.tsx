import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { BriefingPage, INTRO_STORAGE_KEY, useBriefingGenerationPolling, formatShortSessionDate } from "./BriefingPage";
import { queryKeys } from "../../shared/api/queries";
import { invalidateAnalysisResults } from "../../shared/api/analysis";
import { backendStatusBody, deferred, jsonResponse, pipelineRow } from "../../test/dataFixtures";
import { adaptCandidate } from "../../entities/candidate";
import { candidateSignals } from "../../entities/signals";
import { mergeCandidateDetail } from "./DetailPanel";
import { marketAssessment, MarketOverview } from "./MarketOverview";
import { BRAND_NAME } from "../../shared/lib/brand";
import { chartBundle } from "../../test/fixtures/reportFixtures";

const clients: QueryClient[] = [];
it("formats Korean session weekdays independently of browser timezone and rejects invalid days", () => {
  const localDay = vi.spyOn(Date.prototype, "getDay").mockReturnValue(0);
  try {
    expect(formatShortSessionDate("2026-10-26")).toBe("10/26(월)");
    expect(formatShortSessionDate("2026-10-27")).toBe("10/27(화)");
    expect(formatShortSessionDate("2026-02-30")).toBeNull();
    expect(localDay).not.toHaveBeenCalled();
  } finally { localDay.mockRestore(); }
});
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
    if (path === "/api/briefing") return jsonResponse({
      version: 1,
      status: "ready",
      model: { modelId: "test_model", scoreKind: "rank_zscore", baseDate: "2026-10-07", predictionTarget: "next_session_open_to_close", poolSize: 200, runStartedAt: null },
      macro: { asOf: "2026-10-07T09:00:00Z", indicators: [] },
      stocks: [],
      narrative: { status: "template", generatedAt: "2026-10-07T09:00:00Z", llmModel: null, inputHash: "hash", fallbackReason: null, overview: "", marketNote: "", stocks: [], citations: [] },
      disclaimer: "테스트 면책 조항",
      data_meta: { source: "cache", asOf: "2026-10-07T09:00:00Z" }
    });
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
  it("does not infer a shared target session from mixed candidate dates without model metadata", async () => {
    const mixedRows = rows();
    Object.assign(mixedRows[0].input_row, { prediction_base_date: "2026-10-07" });
    Object.assign(mixedRows[1].input_row, { prediction_base_date: "2026-10-08" });
    mockBackend(path => path === "/api/rank" || path === "/api/candidates" ? Promise.resolve(jsonResponse(mixedRows))
      : path === "/api/briefing" ? Promise.resolve(jsonResponse({ version: 1, status: "ready", model: null, macro: { asOf: null, indicators: [] }, stocks: [], narrative: { status: "template", overview: "혼합 기준일", stocks: [], citations: [] }, data_meta: { source: "cache", asOf: null } }))
      : path.includes("next-session") ? Promise.resolve(jsonResponse({ nextSession: "2026-10-09" })) : undefined);
    mount(); await screen.findByRole("heading", { name: "종목 A" });
    expect(screen.getByRole("heading", { name: "오늘의 브리핑" })).toBeInTheDocument();
    expect(screen.queryByTestId("briefing-title-meta")).not.toBeInTheDocument();
  });
  it("opens score help with keyboard focus and closes it with Escape or blur", async () => {
    mockBackend(); mount();
    await screen.findByRole("heading", { name: "종목 A" });
    const help = screen.getByRole("button", { name: "순위 점수 도움말" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent("순위 점수는 수익률·상승 확률이 아닙니다");
    expect(help).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(help); fireEvent.blur(help);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("uses a neutral model-position badge in the detail panel", async () => {
    mockBackend(); mount();
    await screen.findByRole("heading", { name: "종목 A" });
    const evidence = document.querySelector('[data-detail-evidence="model"]');
    expect(evidence).not.toBeNull();
    expect(evidence).toHaveTextContent(/모델 (상위권|중위권|하위권)|순위 미확인/);
    expect(evidence).not.toHaveTextContent("긍정");
    expect(evidence?.querySelector(".lucide-triangle")).toBeNull();
  });
  it("merges only matching stock evidence into the original rank rows and leaves selection to the row button", async () => {
    mockBackend(path => path === "/api/briefing" ? Promise.resolve(jsonResponse({
      version: 1, status: "ready", model: null,
      macro: { asOf: null, indicators: [] },
      stocks: ["000660", "999999"].map(code => ({
        code, name: "근거 종목", rank: 1, rankScore: 1.2, poolSize: 200, topPercent: .5,
        evidence: [{ id: `E:${code}:1`, kind: "model", text: "모델 근거" }], cautions: [],
        news: { status: "not_collected", articles: [] },
      })),
      narrative: { status: "template", generatedAt: null, llmModel: null, inputHash: "", fallbackReason: null,
        overview: "통합 브리핑", marketNote: "", citations: [],
        stocks: [{ code: "000660", summary: "종목 B 자동 요약", citations: ["E:000660:1"] }],
      },
      disclaimer: "테스트 면책 조항", data_meta: { source: "cache", asOf: null },
    })) : undefined);
    mount(["/next?code=005930"]);
    await screen.findByText("종목 B 자동 요약");
    const first = document.querySelector('[data-model-code="005930"]')!;
    const second = document.querySelector('[data-model-code="000660"]')!;
    expect(first.querySelector(".briefing-related-news")).not.toBeNull();
    expect(second.querySelector(".briefing-related-news")).toBeNull();
    expect(second.contains(screen.getByTestId("stock-card-000660"))).toBe(true);
    expect(screen.queryByTestId("stock-card-999999")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "종목별 근거·주의점" })).not.toBeInTheDocument();
    expect(within(second as HTMLElement).getByRole("button", { name: "종목 B 000660 상세 보기" })).toHaveTextContent("종목 B");
    expect(second.querySelector(".briefing-top-rank")).toHaveTextContent("02");
    expect(within(second as HTMLElement).getByRole("link", { name: "리포트" })).toHaveAttribute("href", "/next/stock/000660");
    fireEvent.click(second.querySelector("summary")!);
    fireEvent.click(screen.getByTestId("stock-expand-btn-000660"));
    fireEvent.click(screen.getByText("종목 B 자동 요약"));
    expect(screen.getByTestId("stock-details-000660")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/next?code=005930");
    expect(first).toHaveAttribute("data-selected", "true");
    expect(second).not.toHaveAttribute("data-selected");
  });
  it.each([
    ["000660", "000660", "종목 B"],
    ["999999", "005930", "종목 A"],
  ])("chooses a TOP5 default when the first briefing code is %s", async (briefingCode, selectedCode, selectedName) => {
    mockBackend(path => path === "/api/briefing" ? Promise.resolve(jsonResponse({
      version: 1, status: "ready", model: null, macro: { asOf: null, indicators: [] },
      stocks: [{ code: briefingCode, name: "근거 종목", rank: 1, rankScore: 1.2, poolSize: 200, topPercent: .5,
        evidence: [], cautions: [], news: { status: "not_collected", articles: [] } }],
      narrative: { status: "template", generatedAt: null, llmModel: null, inputHash: "", fallbackReason: null,
        overview: "기본 선택 검증", marketNote: "", citations: [`R:${briefingCode}`], stocks: [] },
      disclaimer: "테스트 면책 조항", data_meta: { source: "cache", asOf: null },
    })) : undefined);
    mount();
    await screen.findByText("기본 선택 검증");
    const selected = await screen.findByRole("button", { name: `${selectedName} ${selectedCode} 상세 보기` });
    await waitFor(() => expect(selected).toHaveAttribute("aria-pressed", "true"));
    expect(await screen.findByRole("heading", { name: selectedName })).toBeInTheDocument();
    expect(document.querySelectorAll('.briefing-top-five > li[data-selected="true"]')).toHaveLength(1);
    expect(selected.closest("[data-model-code]")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/next$/);
  });
  it("retains previous comprehensive briefing data and announces a failed refresh", async () => {
    let failed = false;
    mockBackend(path => path === "/api/briefing" && failed ? Promise.resolve(new Response("{}", { status: 503 })) : undefined);
    const client = mount();
    await screen.findByRole("heading", { name: "종합 브리핑" });
    failed = true;
    await client.refetchQueries({ queryKey: queryKeys.briefing(), exact: true });
    expect(await screen.findByText("이전 조회 결과 · 종합 브리핑 갱신 실패")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "종합 브리핑" })).toBeInTheDocument();
  });
  it("selects through buttons, keyboard and URL history", async () => {
    mockBackend(); mount();
    const a = await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    fireEvent.click(a); await screen.findByRole("heading", { name: "종목 A" });
    expect(screen.getByTestId("location")).toHaveTextContent("code=005930");
    fireEvent.keyDown(a, { key: "ArrowDown" });
    const b = screen.getByRole("button", { name: "종목 B 000660 상세 보기" });
    expect(b).toHaveFocus(); expect(screen.getByTestId("location")).toHaveTextContent("code=005930");
    fireEvent.keyDown(b, { key: "Enter" }); await screen.findByRole("heading", { name: "종목 B" });
    expect(b).toHaveAttribute("aria-pressed", "true");
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
    await screen.findByText("표시할 모델 순위가 없습니다.");
    expect(document.querySelectorAll("[data-model-code]")).toHaveLength(0);
  });
  it("shows rank loading independently of candidate generation", async () => {
    const pending = deferred<Response>(); mockBackend(path => path === "/api/rank" ? pending.promise : undefined); mount();
    await screen.findByText("모델 순위를 조회하고 있습니다.");
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
  it.each([false, true])("keeps manual refresh busy until delayed queries settle (failure: %s)", async failure => {
    let refreshing = false;
    const pending = deferred<Response>();
    const fetcher = mockBackend(path => path === "/api/rank" && refreshing ? pending.promise : undefined);
    const client = mount();
    await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const refetch = vi.spyOn(client, "refetchQueries");
    refreshing = true;
    const button = screen.getByRole("button", { name: "다시 조회" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName("조회 중…");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /종목 A 005930.*상세 보기/ })).toBeInTheDocument();
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === "/api/rank")).toHaveLength(2));
    fireEvent.click(button);
    expect(refetch.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === queryKeys.rank()[0])).toHaveLength(1);
    pending.resolve(failure ? new Response("failed", { status: 502 }) : jsonResponse(rows()));
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAccessibleName("다시 조회");
    expect(button).toHaveAttribute("aria-busy", "false");
    if (failure) expect(screen.getByText("이전 조회 결과 · 모델 순위 갱신 실패")).toBeInTheDocument();
  });
  it("releases manual refresh after cancellation rejects and allows a retry", async () => {
    mockBackend();
    const client = mount();
    await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    vi.spyOn(client, "cancelQueries").mockRejectedValueOnce(new Error("cancellation failed"));
    const button = screen.getByRole("button", { name: "다시 조회" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-busy", "false");
    const refetch = vi.spyOn(client, "refetchQueries");
    fireEvent.click(button);
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    await waitFor(() => expect(button).toBeEnabled());
  });
  it("does not mark initial loading or background refetch as manual refresh", async () => {
    const pending = deferred<Response>();
    mockBackend(path => path === "/api/rank" ? pending.promise : undefined);
    const client = mount();
    const button = screen.getByRole("button", { name: "다시 조회" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    pending.resolve(jsonResponse(rows()));
    await screen.findByRole("button", { name: /종목 A 005930.*상세 보기/ });
    const background = deferred<Response>();
    mockBackend(path => path === "/api/rank" ? background.promise : undefined);
    let request: Promise<void>;
    act(() => { request = client.refetchQueries({ queryKey: queryKeys.rank(), exact: true }); });
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName("다시 조회");
    expect(button).toHaveAttribute("aria-busy", "false");
    await act(async () => { background.resolve(jsonResponse(rows())); await request; });
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

describe("BriefingPage comprehensive briefing integration", () => {
  it("disables narrative generation and explains why while a failed run shows the previous result", async () => {
    const fetcher = mockBackend(path => path === "/api/briefing" ? Promise.resolve(jsonResponse({
      version: 1, status: "ready", previousRun: { reason: "failed" }, stocks: [], narrative: { status: "template" },
    })) : undefined);
    mount();
    const button = await screen.findByTestId("narrative-generate-btn");
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("새 분석이 실패해 이전 결과를 표시 중입니다. 분석을 완료한 뒤 요약을 다시 생성해 주세요.");
    fireEvent.click(button);
    expect(fetcher.mock.calls.some(([path, request]) => String(path) === "/api/briefing/narrative" && request?.method === "POST")).toBe(false);
  });
  it("shows authentication recovery guidance when narrative generation returns 401", async () => {
    mockBackend((path, request) => path === "/api/briefing/narrative" && request?.method === "POST"
      ? Promise.resolve(new Response("", { status: 401 })) : undefined);
    mount();
    const button = await screen.findByTestId("narrative-generate-btn");
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("관리자 인증이 필요합니다. ?admin에서 유효한 토큰을 저장한 뒤 다시 시도해 주세요.");
  });
  const briefingSnapshot = (status: "ready" | "no_run", overview = "이전 브리핑 유지") => ({ version: 1, status, model: null, stocks: [], narrative: { status: "template", overview } });
  it.each(["analysis", "backend"])("disables narrative regeneration while %s reports a running analysis", async source => {
    const fetcher = mockBackend(path => {
      if (path === "/api/briefing") return Promise.resolve(jsonResponse(briefingSnapshot("ready")));
      if (path === "/api/candidates/run") return Promise.resolve(jsonResponse({ status: source === "analysis" ? "running" : "idle" }));
      if (path === "/api/backend/status") return Promise.resolve(jsonResponse(backendStatusBody(undefined, { runtime: { state: source === "backend" ? "running" : "idle" } })));
      return undefined;
    });
    mount(); const button = await screen.findByTestId("narrative-generate-btn");
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAccessibleDescription("분석 진행 중에는 요약을 다시 만들 수 없습니다.");
    fireEvent.click(button);
    expect(fetcher.mock.calls.some(([path, request]) => String(path) === "/api/briefing/narrative" && request?.method === "POST")).toBe(false);
  });
  it("checks the current cache before sending a narrative request even before disabled props update", async () => {
    const fetcher = mockBackend(); const client = mount(), button = await screen.findByTestId("narrative-generate-btn");
    await waitFor(() => expect(button).toBeEnabled());
    act(() => {
      client.setQueryData(queryKeys.analysisRun(), { data: { status: "running" }, source: "live", asOf: null });
      fireEvent.click(button);
    });
    await waitFor(() => expect(button).toBeDisabled());
    expect(fetcher.mock.calls.some(([path, request]) => String(path) === "/api/briefing/narrative" && request?.method === "POST")).toBe(false);
  });
  it.each(["idle", "running"])("accepts server no_run instead of indefinitely preserving browser ready (%s)", async status => {
    let missing = false;
    mockBackend(path => path === "/api/briefing" ? Promise.resolve(jsonResponse(briefingSnapshot(missing ? "no_run" : "ready"))) : path === "/api/candidates/run" ? Promise.resolve(jsonResponse({ status })) : undefined);
    const client = mount(); await screen.findByText("이전 브리핑 유지"); missing = true;
    await act(async () => { await client.refetchQueries({ queryKey: queryKeys.briefing() }); });
    expect(client.getQueryData(queryKeys.briefing())).toMatchObject({ status: "no_run" });
    expect(await screen.findByText("진행된 종합 브리핑 결과가 없습니다")).toBeInTheDocument();
  });
  it.each([
    { running: false, status: "no_run" as const },
    { running: true, status: "no_run" as const },
    { running: true, status: "ready" as const },
  ])("keeps the prior ready result when a pending narrative response arrives (running=$running, status=$status)", async ({ running, status }) => {
    const pending = deferred<Response>();
    const fetcher = mockBackend((path, request) => path === "/api/briefing" ? Promise.resolve(jsonResponse(briefingSnapshot("ready"))) : path === "/api/briefing/narrative" && request?.method === "POST" ? pending.promise : undefined);
    const client = mount(); await screen.findByText("이전 브리핑 유지");
    const button = screen.getByTestId("narrative-generate-btn"); fireEvent.click(button);
    await waitFor(() => expect(fetcher.mock.calls.some(([path, request]) => String(path) === "/api/briefing/narrative" && request?.method === "POST")).toBe(true));
    await act(async () => {
      if (running) client.setQueryData(queryKeys.analysisRun(), { data: { status: "running" }, source: "live", asOf: null });
      pending.resolve(jsonResponse(briefingSnapshot(status, "늦게 도착한 요약")));
    });
    if (running) await waitFor(() => expect(button).toHaveAttribute("aria-busy", "false"));
    else await screen.findByText("진행된 종합 브리핑 결과가 없습니다");
    expect(client.getQueryData(queryKeys.briefing())).toMatchObject({ status: running ? "ready" : status });
    if (running) {
      expect(screen.getByText("이전 브리핑 유지")).toBeInTheDocument();
      expect(screen.queryByText("늦게 도착한 요약")).not.toBeInTheDocument();
    }
  });
  it("renders ready briefing with macro grid and narrative", async () => {
    mockBackend(path => {
      if (path === "/api/briefing") {
        return Promise.resolve(jsonResponse({
          version: 1,
          status: "ready",
          model: { modelId: "test_model", scoreKind: "rank_zscore", baseDate: "2026-10-07", predictionTarget: "next_session_open_to_close", poolSize: 200, runStartedAt: null },
          macro: {
            asOf: "2026-10-07T09:00:00Z",
            context: { usSessionDate: "2026-10-06", targetSessionNote: "통합 테스트 매크로 노트" },
            indicators: [
              { id: "KOSPI", name: "코스피", value: 2750.0, change: 10.5, changePct: 0.38, unit: "pt", asOf: "2026-10-07T09:00:00Z", source: "kis", status: "ok" }
            ]
          },
          stocks: [
            {
              rank: 1, code: "005930", name: "삼성전자", rankScore: 2.1, poolSize: 200, topPercent: 0.5,
              evidence: [{ id: "E:005930:1", kind: "model", text: "상위 모멘텀 지속" }],
              cautions: [],
              news: { status: "not_collected", articles: [] }
            }
          ],
          narrative: {
            status: "llm", generatedAt: "2026-10-07T09:05:00Z", llmModel: "gemini-flash", inputHash: "hash-ready",
            fallbackReason: null, overview: "시장 개황 통합 테스트 내용", marketNote: "지표 관찰 내용",
            stocks: [{ code: "005930", summary: "삼성전자 종합 요약", citations: ["M:KOSPI"] }],
            citations: ["M:KOSPI"]
          },
          disclaimer: "통합 면책 조항",
          data_meta: { source: "live", asOf: "2026-10-07T09:00:00Z" }
        }));
      }
      return undefined;
    });

    mount();
    await screen.findByTestId("macro-card-KOSPI");
    expect(screen.queryByText("미국장 2026-10-06 기준")).not.toBeInTheDocument();
    expect(screen.getByText("시장 개황 통합 테스트 내용")).toBeInTheDocument();
    expect(screen.getByText("통합 면책 조항")).toBeInTheDocument();
  });

  it("renders empty state guide when briefing status is no_run", async () => {
    mockBackend(path => {
      if (path === "/api/briefing") {
        return Promise.resolve(jsonResponse({
          version: 1,
          status: "no_run",
          model: null,
          macro: { asOf: null, indicators: [] },
          stocks: [],
          narrative: { status: "template", generatedAt: "2026-10-07T09:00:00Z", llmModel: null, inputHash: "", fallbackReason: null, overview: "", marketNote: "", stocks: [], citations: [] },
          disclaimer: "",
          data_meta: { source: "cache", asOf: null }
        }));
      }
      return undefined;
    });

    mount();
    await screen.findByText("진행된 종합 브리핑 결과가 없습니다");
    expect(screen.getByText("새 분석 실행")).toBeInTheDocument();
    expect(document.querySelectorAll(".briefing-top-five .briefing-related-news")).toHaveLength(2);
    expect(document.querySelector(".briefing-stock-evidence")).toBeNull();
  });

  it("handles briefing fetch error without crashing the page", async () => {
    mockBackend(path => {
      if (path === "/api/briefing") {
        return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
      }
      return undefined;
    });

    mount();
    await screen.findByText("종합 브리핑 조회 실패 · 분석 결과를 가져오지 못했습니다.");
    expect(screen.getByRole("heading", { name: "모델 순위 TOP5" })).toBeInTheDocument();
  });

  it("calls narrative generation mutation and updates briefing on user click", async () => {
    let generated = false;
    mockBackend((path, options) => {
      if (path === "/api/briefing/narrative" && options?.method === "POST") {
        generated = true;
        return Promise.resolve(jsonResponse({
          version: 1,
          status: "ready",
          model: null,
          macro: { asOf: null, indicators: [] },
          stocks: [],
          narrative: {
            status: "llm", generatedAt: "2026-10-07T09:10:00Z", llmModel: "gemini-pro", inputHash: "hash-new",
            fallbackReason: null, overview: "새로 생성된 AI 브리핑 요약", marketNote: "",
            stocks: [], citations: []
          },
          disclaimer: "",
          data_meta: { source: "live", asOf: null }
        }));
      }
      if (path === "/api/briefing") {
        return Promise.resolve(jsonResponse({
          version: 1,
          status: "ready",
          model: null,
          macro: { asOf: null, indicators: [] },
          stocks: [],
          narrative: {
            status: "template", generatedAt: "2026-10-07T09:00:00Z", llmModel: null, inputHash: "hash-old",
            fallbackReason: "규칙 생성", overview: "규칙 요약 내용", marketNote: "",
            stocks: [], citations: []
          },
          disclaimer: "",
          data_meta: { source: "cache", asOf: null }
        }));
      }
      return undefined;
    });

    mount();
    await screen.findByText("규칙 요약 내용");
    const generateBtn = screen.getByTestId("narrative-generate-btn");
    expect(generateBtn).toHaveTextContent("AI 요약 생성");

    fireEvent.click(generateBtn);
    await screen.findByText("새로 생성된 AI 브리핑 요약");
    expect(generated).toBe(true);
  });

  // 차단 3: 분석 완료 후 briefing 쿼리 무효화 검증
  it("invalidates briefing query when analysis completes", async () => {
    let briefingCount = 0;
    mockBackend(path => {
      if (path === "/api/briefing") {
        briefingCount += 1;
        return Promise.resolve(jsonResponse({
          version: 1,
          status: "ready",
          model: null,
          macro: { asOf: null, indicators: [] },
          stocks: [],
          narrative: { status: "template", generatedAt: "2026-10-07T09:00:00Z", llmModel: null, inputHash: "", fallbackReason: null, overview: `무효화 호출 ${briefingCount}`, marketNote: "", stocks: [], citations: [] },
          disclaimer: "",
          data_meta: { source: "cache", asOf: null }
        }));
      }
      return undefined;
    });

    const client = mount();
    await screen.findByText("무효화 호출 1");

    await invalidateAnalysisResults(client);
    await screen.findByText("무효화 호출 2");
    expect(briefingCount).toBeGreaterThanOrEqual(2);
  });

  // 권장 11: 언마운트 중 뮤테이션 완료 시 오류 없음
  it("handles unmount during narrative mutation without throwing", async () => {
    let resolveNarrative!: (val: Response) => void;
    mockBackend((path, options) => {
      if (path === "/api/briefing/narrative" && options?.method === "POST") {
        return new Promise<Response>(res => { resolveNarrative = res; });
      }
      return undefined;
    });

    const client = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter><BriefingPage /></MemoryRouter>
      </QueryClientProvider>
    );

    unmount();
    expect(() => {
      if (resolveNarrative) {
        resolveNarrative(jsonResponse({
          version: 1, status: "ready", model: null, macro: { asOf: null, indicators: [] }, stocks: [],
          narrative: { status: "llm", generatedAt: "2026-10-07T09:00:00Z", llmModel: "gemini", inputHash: "", fallbackReason: null, overview: "", marketNote: "", stocks: [], citations: [] },
          disclaimer: "", data_meta: { source: "live", asOf: null }
        }));
      }
    }).not.toThrow();
  });

  it("displays target session in title and shows asOf metadata", async () => {
    mockBackend(path => {
      if (path.includes("/api/korean-market/next-session")) {
        return Promise.resolve(jsonResponse({ baseDate: "2026-10-07", nextSession: "2026-10-08" }));
      }
      return undefined;
    });
    mount();
    await screen.findByRole("heading", { name: /10\/08\(목\) 대상 브리핑/ });
    expect(screen.getByTestId("briefing-title-meta")).toHaveTextContent("기준일 10/07 · 대상 10/08(목)");
  });
});

describe("briefing generation polling budget", () => {
  it("polls every five seconds for at most one minute and resets for a new generation", () => {
    vi.useFakeTimers();
    try {
      const refetch = vi.fn(async () => undefined);
      const { result, rerender, unmount } = renderHook(({ active }) => useBriefingGenerationPolling(active, refetch), { initialProps: { active: true } });
      act(() => { vi.advanceTimersByTime(4999); }); expect(refetch).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); }); expect(refetch).toHaveBeenCalledTimes(1);
      act(() => { vi.advanceTimersByTime(55_000); }); expect(refetch).toHaveBeenCalledTimes(12); expect(result.current).toBe(true);
      act(() => { vi.advanceTimersByTime(60_000); }); expect(refetch).toHaveBeenCalledTimes(12);
      rerender({ active: false }); expect(result.current).toBe(false);
      rerender({ active: true }); act(() => { vi.advanceTimersByTime(5000); }); expect(refetch).toHaveBeenCalledTimes(13);
      unmount(); act(() => { vi.advanceTimersByTime(60_000); }); expect(refetch).toHaveBeenCalledTimes(13);
    } finally { vi.useRealTimers(); }
  });
});

beforeEach(() => window.sessionStorage.setItem("kospi-admin-token.v1", "fixture-admin"));

describe("target session ended badge in BriefingPage", () => {
  it("shows ended badge when current time is past 15:30 on the target session", async () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T16:00:00+09:00"));
    try {
      mockBackend(path => {
        if (path.includes("/api/korean-market/next-session")) {
          return Promise.resolve(jsonResponse({ baseDate: "2026-10-07", nextSession: "2026-10-08" }));
        }
        return undefined;
      });
      mount();
      await screen.findByRole("heading", { name: /10\/08\(목\) 대상 브리핑/ });
      expect(screen.getByTestId("briefing-target-ended")).toHaveTextContent("예측 대상 종료");
      expect(screen.getByTestId("briefing-target-ended-hint")).toHaveTextContent("다음 거래일 순위는 새 분석 후 표시됩니다.");
      expect(screen.getByRole("link", { name: "분석 실행 안내" }).getAttribute("href")).toContain("/about#analysis-guide");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not show ended badge before 15:30 on the target session", async () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T11:00:00+09:00"));
    try {
      mockBackend(path => {
        if (path.includes("/api/korean-market/next-session")) {
          return Promise.resolve(jsonResponse({ baseDate: "2026-10-07", nextSession: "2026-10-08" }));
        }
        return undefined;
      });
      mount();
      await screen.findByRole("heading", { name: /10\/08\(목\) 대상 브리핑/ });
      expect(screen.queryByTestId("briefing-target-ended")).not.toBeInTheDocument();
      expect(screen.queryByTestId("briefing-target-ended-hint")).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});
