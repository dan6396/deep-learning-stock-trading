import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { StockReportPage } from "./StockReportPage";
import { backendStatusBody, deferred, jsonResponse } from "../../test/dataFixtures";
import { reportRow, chartBundle } from "../../test/fixtures/reportFixtures";
import { expectReadableUserText } from "../../test/assertUserText";
import { modelEvidence } from "../../entities/modelEvidence";

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
    if (path.includes("quote")) return jsonResponse({ code, currentPrice: code === "005930" ? 12300 : 99000, change: 0, changeRate: 0, accumulatedVolume: 0, tradingValue: 0, source: "cache", asOf: "2026-10-07T09:00:00Z" });
    throw new Error(`Unexpected test request ${path}`);
  }); vi.stubGlobal("fetch", fetcher); return fetcher;
}
function mount(path: string | { pathname: string; state: { rankReturnTo: string } } = "/next/stock/005930") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Link to="/next/stock/000660">테스트 B</Link><Routes><Route path="/next/stock/:code" element={<StockReportPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
function insightBody() {
  return { version: 1, code: "005930", name: "종목 A", status: "ready", baseDate: "2026-10-07",
    model: modelEvidence({ prediction_status: "ok", score_kind: "rank_zscore", pred_rank: 1, pred_pool_size: 199, rank_score: 1.601514, rank_lb20: 2, rank_lb120: 3, score_lb20: 1.5, score_lb120: 1.7, model_agreement: "일치", feat_pct_f_close: 95 }),
    sensitivity: { status: "preparing", metrics: [], samples: 0, complete: false }, cautions: [],
    news: { summary: "기사 제목에서 서비스 개편을 확인했습니다.", source: "llm", summarySource: "llm" as "llm" | "template" | undefined, limitation: "기사 본문을 수집하지 않았습니다.", articles: [{ id: "N:005930:1", title: "원본 기사", url: "https://news.example/article", source: "발행처", pubDate: "2026-10-07T09:00:00Z" }], citations: ["N:005930:1"] },
    data_meta: { source: "cache", asOf: "2026-10-07T09:00:00Z" } };
}
describe("stock report using actual fetch fixtures", () => {
  it("keeps a validated rank return URL and exposes missing values without filling them", async () => {
    backend(path => path.includes("stock-insight") || path.includes("stock-analysis") ? Promise.resolve(jsonResponse(null)) : path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : undefined);
    const from = "/next/rank?query=005930&sort=name&direction=desc&page=2";
    mount({ pathname: "/next/stock/005930", state: { rankReturnTo: from } });
    expect(screen.getByRole("link", { name: "전체 순위로" })).toHaveAttribute("href", from);
    const compact = document.querySelector(".report-model-compact");
    await waitFor(() => expect(compact).toHaveTextContent("미제공"));
    expect(compact?.querySelectorAll("dd")).toHaveLength(4);
    expect(screen.getByRole("navigation", { name: "리포트 빠른 탐색" })).toHaveTextContent("모델 근거");
  });
  it("consolidates the aggregate rank once while retaining comparisons, features, cautions and opinion anchors", async () => {
    const row = reportRow();
    Object.assign(row.input_row, { score_kind: "rank_zscore", rank_score: 1.601514, pred_rank: 1, pred_pool_size: 199 });
    const body = { ...insightBody(), aiOpinion: { source: "llm", text: "모집단 안에서 모델 순위와 입력 특징을 확인했습니다. 점수는 확률이 아니며 기사 본문은 수집하지 않았습니다.", citations: ["R:005930", "E:005930:1", "C:005930:1", "E:005930:999", "R:005930:raw", "R:005930:20", "R:005930:120", "E:005930:feature:f_rsi", "M:NASDAQ"] } };
    body.model = modelEvidence({ prediction_status: "ok", score_kind: "rank_zscore", pred_rank: 1, pred_pool_size: 199, rank_score: 1.601514, rank_lb20: 2, rank_lb120: 3, score_lb20: 1.5, score_lb120: 1.7, model_agreement: "일치", feat_pct_f_close: 95, feat_pct_f_rsi: 90, feat_pct_f_high: 92 });
    backend(path => path.includes("stock-insight") ? Promise.resolve(jsonResponse(body)) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : path === "/api/backend/status" ? Promise.resolve(jsonResponse(backendStatusBody({ state: "not_produced" }))) : undefined);
    mount();
    const model = await screen.findByRole("region", { name: "모델 순위" });
    await screen.findByRole("heading", { name: /^20일·120일 모델 비교/ });
    expect(document.querySelectorAll(".report-model-card")).toHaveLength(1);
    expect(model.querySelectorAll(".report-card")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "순위와 분석 근거" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "모델 순위와 주요 지표" })).not.toBeInTheDocument();
    expect(within(model).getAllByText("1위")).toHaveLength(1);
    expect((model.textContent!.match(/상위 0\.5%/g) ?? [])).toHaveLength(1);
    expect(within(model).getAllByText("1.60")).toHaveLength(1);
    expect(within(model).getByTestId("report-prediction")).toHaveAttribute("title", "1.601514");
    expect(model).toHaveTextContent("199종목 중 1위");
    expect(model).toHaveTextContent("모델 상위권");
    expect(model).toHaveTextContent("분석 기준일"); expect(model).toHaveTextContent("다음 거래일 시가→종가"); expect(model).toHaveTextContent("분석 시각");
    expect(within(model).getAllByText(/상승이나 양의 수익률을 뜻하지 않습니다/)).toHaveLength(1);
    expect(within(model).getAllByText(/입력 특징의 상대적 위치이며 모델 기여도나 순위의 원인을 뜻하지 않습니다/)).toHaveLength(1);
    expect(within(model).getByRole("img", { name: "20일 모델 2위, 상위 1%" })).toBeInTheDocument();
    expect(within(model).getByRole("img", { name: "120일 모델 3위, 상위 1.5%" })).toBeInTheDocument();
    expect(within(model).getByTitle("모델 일치도")).toHaveTextContent("일치");
    expect(within(model).getAllByRole("meter")).toHaveLength(3);
    const opinion = screen.getByRole("region", { name: "AI 최종 의견" });
    expect(within(opinion).getByTitle("E:005930:1")).toHaveTextContent("모델 순위 근거");
    expect(opinion.querySelector('[title="E:005930:999"]')).toBeNull();
    const original = HTMLElement.prototype.scrollIntoView, scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
    try {
      fireEvent.click(within(opinion).getByTitle("R:005930")); expect(document.activeElement).toBe(model);
      fireEvent.click(within(opinion).getByTitle("E:005930:1")); expect(document.activeElement).toBe(model);
      fireEvent.click(within(opinion).getByTitle("C:005930:1")); expect(document.activeElement).toBe(within(model).getByText("순위 점수는 수익률·확률이 아닙니다."));
      for (const [id, target] of [["R:005930:raw", "stock-model-raw-005930"], ["R:005930:20", "stock-model-005930-20"], ["R:005930:120", "stock-model-005930-120"], ["E:005930:feature:f_rsi", "stock-feature-005930-f_rsi"]]) {
        fireEvent.click(within(opinion).getByTitle(id)); expect(document.activeElement).toBe(document.getElementById(target));
      }
      expect(opinion.querySelector('[title="M:NASDAQ"]')).toBeNull();
      expect(scroll).toHaveBeenCalledTimes(7);
    } finally { HTMLElement.prototype.scrollIntoView = original; }
  });
  it.each(["llm", "template"] as const)("renders a disclosed %s opinion before news and keeps news summaries with the articles", async source => {
    const body = { ...insightBody(), aiOpinion: { source, text: "동일 기준일 모집단에서 모델 순위를 확인했습니다. 기사 제목에 서비스 개편이 언급되었으며 본문은 수집하지 않았습니다.", citations: ["R:005930", "N:005930:1", "M:NASDAQ", "E:005930:999", "C:005930:999"], generatedAt: "2026-10-07T09:00:00Z" } };
    body.news.source = source;
    body.news.summarySource = source;
    const row = reportRow(); row.news[0].url = "https://news.example/article";
    const fetcher = backend(path => path.includes("stock-insight") ? Promise.resolve(jsonResponse(body)) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : undefined);
    mount();
    const opinion = await screen.findByRole("region", { name: source === "llm" ? "AI 최종 의견" : "모델·근거 요약" });
    expect(within(opinion).getByText(`${source === "llm" ? "AI 의견" : "참고 요약"} · 투자 권유 아님 · 방향 판단 아님`)).toBeInTheDocument();
    expect(within(opinion).getAllByText(source === "llm" ? "AI 요약" : "규칙 기반 기본 안내")[0]).toBeInTheDocument();
    expect(opinion.querySelector(".stock-ai-summary p")).toHaveTextContent(body.aiOpinion.text);
    expect(opinion.querySelector(".stock-ai-summary p")).toHaveStyle({ WebkitLineClamp: "5" });
    expect(opinion.querySelector("time")).toHaveTextContent("생성 시각 2026. 10. 07. 18:00 (KST)");
    const news = screen.getByRole("region", { name: "관련 뉴스" });
    const summary = within(opinion).getByText(body.news.summary);
    expect(summary.parentElement).toHaveClass("stock-ai-summary");
    if (source === "llm") expect(opinion).toHaveTextContent("제목 기반");
    expect(within(opinion).getAllByText(`${source === "llm" ? "AI 요약 · 제목 기반" : "규칙 기반 기본 안내"}`)[0]).toBeInTheDocument();
    expect(within(opinion).getByRole("heading", { name: "관련 뉴스 요약" })).toBeInTheDocument();
    expect(within(news).queryByText(body.news.summary)).not.toBeInTheDocument();
    expect(within(opinion).getByRole("group", { name: "뉴스 요약 인용 근거" })).toHaveTextContent("관련 기사 1");
    expect(news).toHaveTextContent("기사 본문을 수집하지 않았습니다.");
    expect(summary.compareDocumentPosition(news.querySelector("ul")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(news.querySelectorAll("li")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "뉴스 이슈와 출처" })).not.toBeInTheDocument();
    const price = screen.getByRole("region", { name: "가격" }), model = document.querySelector(".report-model-card")!;
    expect(price.compareDocumentPosition(opinion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(opinion.compareDocumentPosition(news) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(news.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(opinion).getAllByRole("button").filter(button => button.hasAttribute("title"))).toHaveLength(2);
    expect(opinion.querySelector('[title="M:NASDAQ"]')).toBeNull();
    expect(opinion.querySelector('[title="E:005930:999"]')).toBeNull();
    expect(opinion.querySelector('[title="C:005930:999"]')).toBeNull();
    const original = HTMLElement.prototype.scrollIntoView, scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
    try {
      fireEvent.click(within(opinion).getByRole("button", { name: "관련 기사 1" }));
      expect(document.activeElement).toBe(news.querySelector("li"));
      fireEvent.click(within(opinion).getByRole("button", { name: "모델 순위" }));
      expect(document.activeElement).toBe(model);
      expect(scroll).toHaveBeenCalledTimes(2);
    } finally { HTMLElement.prototype.scrollIntoView = original; }
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("stock-insight"))).toHaveLength(1);
  });
  it.each(["llm", "template", undefined] as const)("keeps news-only summaries with articles and uses summarySource %s", async summarySource => {
    const body = insightBody(), row = reportRow(); row.news[0].url = body.news.articles[0].url;
    body.news.summarySource = summarySource;
    backend(path => path.includes("stock-insight") ? Promise.resolve(jsonResponse(body)) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : undefined);
    mount();
    const summary = await screen.findByText(body.news.summary), news = screen.getByRole("region", { name: "관련 뉴스" });
    expect(screen.queryByRole("region", { name: "AI 최종 의견" })).not.toBeInTheDocument();
    expect(news).toContainElement(summary);
    expect(summary.parentElement).toHaveClass("stock-ai-summary");
    expect(within(news).getByText(`${summarySource === "llm" ? "AI 요약 · 제목 기반" : "규칙 기반 기본 안내"}`)).toBeInTheDocument();
    expect(summary.compareDocumentPosition(news.querySelector("ul")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(news).getByRole("group", { name: "뉴스 요약 인용 근거" })).toHaveTextContent("관련 기사 1");
    expect(document.querySelectorAll('.insight-news-chips')).toHaveLength(0);
  });
  it("hides missing, pending and failed opinions without placeholders, and preserves the no-article notice", async () => {
    const pending = deferred<Response>(); let fail = false;
    const body = insightBody(); body.news.articles = []; body.news.citations = []; body.news.summary = "현재 연결된 관련 기사가 없습니다.";
    const row = reportRow(); row.news = [];
    backend(path => path.includes("stock-insight") ? fail ? Promise.resolve(new Response("error", { status: 502 })) : pending.promise : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : undefined);
    const client = mount(); await screen.findByRole("heading", { name: "종목 A" });
    expect(screen.queryByRole("region", { name: "AI 최종 의견" })).not.toBeInTheDocument();
    pending.resolve(jsonResponse(body)); await screen.findByText("현재 연결된 관련 기사가 없습니다.");
    expect(screen.queryByRole("region", { name: "AI 최종 의견" })).not.toBeInTheDocument();
    fail = true; await client.refetchQueries({ queryKey: ["stock-insight", "005930"] });
    expect(screen.queryByRole("region", { name: "AI 최종 의견" })).not.toBeInTheDocument();
    expect(document.querySelector(".report-ai-opinion-card")).toBeNull();
  });
  it("presents rank scores and unexecuted news as neutral factual data", async () => {
    const row = reportRow("005930", "순위 종목");
    Object.assign(row.input_row, { score_kind: "rank_zscore", rank_score: 1.601514, pred_rank: 1, pred_pool_size: 199 });
    backend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : path === "/api/backend/status" ? Promise.resolve(jsonResponse(backendStatusBody({ state: "not_produced" }))) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : undefined);
    mount(); await screen.findByRole("heading", { name: "순위 종목" });
    expect(screen.queryByText("뉴스 보정 미실행")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-prediction")).toHaveTextContent("1.60");
    expect(screen.getByTestId("report-prediction")).toHaveAttribute("title", "1.601514");
    expect(screen.getByRole("heading", { name: "모델 순위" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-report-signal=model]')).toHaveTextContent("모델 상위권"));
    expect(document.querySelector('[data-report-signal=model] [data-signal]')).toHaveAttribute("data-signal", "neutral");
    expect(document.querySelector('[data-candidate-production=unproduced]')).toBeNull();
    expect(document.querySelector('.stock-report')).not.toHaveTextContent(/모델 긍정|원본 예측/);
    expectReadableUserText(document.querySelector('.stock-report')!);
  });
  it("merges authoritative candidate model fields and preserves raw news without unsafe links", async () => {
    const fetcher = backend(); mount(); await screen.findByRole("heading", { name: "종목 A" });
    expect(screen.getByRole("button", { name: "다시 조회" })).toHaveClass("stock-report-button");
    expect(document.querySelector(".report-button")).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-report-signal="news"] [data-signal]')).toHaveAttribute("data-signal", "unavailable"));
    expect(screen.getByTestId("report-prediction")).toHaveTextContent("+2.00%");
    expect(screen.getByTestId("report-final-prediction")).toHaveTextContent("+2.50%"); expect(screen.getByTestId("report-final-rank")).toHaveTextContent("2위");
    expect(screen.getByText("판정 불명 원본 근거")).toBeInTheDocument(); expect(screen.queryByText("감성 미확인")).not.toBeInTheDocument(); expect(screen.queryByText("판정 방법 미확인")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /원본 기사/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("report-price")).toHaveTextContent("12,300원");
    expect(screen.queryByText("외국인 합계")).not.toBeInTheDocument();
    expect(document.querySelector('[data-report-signal="supply"]')).toBeNull();
    expect(document.querySelector(".report-agreement")).toBeNull();
    expect(document.querySelector(".report-rules")).toBeNull();
    expect(screen.queryByRole("region", { name: "종목 성과 기록" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([path]) => String(path).startsWith("/api/performance"))).toBe(false);
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
  it("preserves final-candidate precedence for a negative legacy value outside the top five percent while displaying a neutral rank badge", async () => {
    const row = reportRow("005930", "종목 A", -.02);
    backend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([row])) : undefined); mount();
    await screen.findByRole("heading", { name: "종목 A" }); expect(screen.getByTestId("report-prediction")).toHaveTextContent("-2.00%"); expect(screen.getByTestId("report-prediction")).not.toHaveClass("report-fall");
    const model = document.querySelector('[data-report-signal="model"]')!;
    await waitFor(() => expect(model).toHaveTextContent("원본 예측값이 있는 최종 후보입니다."));
    expect(model.querySelector('[data-signal]')).toHaveAttribute("data-signal", "neutral");
    expect(model.querySelector('[data-signal]')).toHaveTextContent("모델 순위");
    expect(model.querySelector('[data-signal]')).not.toHaveTextContent("50위");
    expect(model.querySelector('.report-model-one-liner')).toHaveTextContent("50위");
    expect(model).not.toHaveTextContent("원본 예측수익률이 0 이하입니다.");
  });
  it("never renders a missing model prose zero or invents final rank", async () => {
    const row = reportRow("005930", "원본 누락", null); row.result.summary = "Huber 예상수익률 0.00%."; Object.assign(row.input_row, { final_pred_return: null, final_rank: null });
    backend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([row])) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : undefined); mount();
    await screen.findByRole("heading", { name: "원본 누락" }); expect(screen.getByTestId("report-prediction")).toHaveTextContent("—"); expect(screen.queryByTestId("report-final-rank")).not.toBeInTheDocument(); expect(document.body).not.toHaveTextContent("Huber 예상수익률 0.00%");
  });
  it("cancels late A stock/quote/chart on code change and renders B only", async () => {
    const pending = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    const fetcher = backend(path => path.includes("005930") ? path.includes("stock-analysis") ? pending[0].promise : path.includes("quote") ? pending[1].promise : pending[2].promise : undefined);
    mount(); await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => String(path).includes("005930") && !String(path).startsWith("/api/performance")).map(([path]) => new URL(String(path), "http://localhost").pathname).sort()).toEqual([
      "/api/korean-market/quote", "/api/korean-market/stock-chart", "/api/stock-analysis", "/api/stock-insight",
    ]));
    fireEvent.click(screen.getByRole("link", { name: "테스트 B" })); await screen.findByRole("heading", { name: "종목 B" });
    await waitFor(() => expect(screen.getByTestId("report-price")).toHaveTextContent("99,000원"));
    expect(fetcher.mock.calls.filter(([path]) => String(path).includes("005930")).every(([, options]) => options?.signal?.aborted)).toBe(true);
    pending[0].resolve(jsonResponse(reportRow("005930", "늦은 A"))); pending[1].resolve(jsonResponse({ code: "005930", currentPrice: 1 })); pending[2].resolve(jsonResponse(chartBundle())); await Promise.resolve();
    expect(document.querySelector('[data-report-code]')).toHaveAttribute("data-report-code", "000660"); expect(document.body).not.toHaveTextContent("늦은 A");
    await waitFor(() => expect(document.querySelector('[data-chart-code]')).toHaveAttribute("data-chart-code", "000660"));
  });
  it("keeps cached ranges visible and isolates a late refresh from the selected range", async () => {
    const late = deferred<Response>(); let chartReads = 0;
    backend(path => path.includes("stock-chart") && ++chartReads === 2 ? late.promise : undefined); mount(); await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "1개월" })); expect(screen.getByRole("img")).toHaveAttribute("data-chart-range", "1M");
    expect(screen.queryByText("선택한 기간의 가격 이력을 조회하고 있습니다.")).not.toBeInTheDocument(); expect(chartReads).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "가격 이력 다시 조회" })); await screen.findByText("가격 이력 갱신 중"); expect(screen.getByRole("img")).toHaveAttribute("data-chart-range", "1M");
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
    await screen.findByText("상세 분석 결과가 없습니다."); expect(document.body).toHaveTextContent("분석 근거가 없습니다"); expect(screen.getByTestId("report-prediction")).toHaveTextContent("—");
  });
  it.each(["sample", "mismatch"])("rejects %s stock responses explicitly rather than rendering their report", async kind => {
    const row = reportRow(kind === "mismatch" ? "000660" : "005930", "허용되지 않은 분석");
    if (kind === "sample") Object.assign(row.data_meta, { source: "sample" });
    backend(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : path.includes("stock-analysis") ? Promise.resolve(jsonResponse(row)) : undefined); mount();
    await screen.findByText(kind === "sample" ? "예시 분석 응답은 제공하지 않습니다. 후보 목록의 분석을 표시합니다." : "종목 코드가 일치하지 않아 분석 응답을 표시하지 않습니다.");
    expect(screen.queryByRole("heading", { name: "허용되지 않은 분석" })).not.toBeInTheDocument(); expect(screen.getByTestId("report-prediction")).toHaveTextContent("—");
  });
  it("keeps previous analysis/quote data with background failure warnings", async () => {
    let failure = false; backend(path => failure && (path.includes("stock-analysis") || path.includes("quote")) ? Promise.resolve(new Response("error", { status: 502 })) : undefined); mount(); await screen.findByRole("heading", { name: "종목 A" }); await waitFor(() => expect(screen.getByTestId("report-price")).toHaveTextContent("12,300원"));
    failure = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" })); await screen.findByText("이전 조회 결과 · 분석 갱신 실패"); await screen.findByText("이전 조회 결과 · 시세 갱신 실패"); expect(screen.getByTestId("report-price")).toHaveTextContent("12,300원");
  });
  it("keeps the stock page and article links usable when the strict sentence gate replaces both fields", async () => {
    const saved = insightBody();
    const body = { ...saved, aiOpinion: { source: "template", text: "모집단 199개 중 모델 순위 1위이며 순위 점수는 1.6015입니다. 입력 지표는 비교 종목 안에서의 상대적 위치이며 순위의 원인이 아닙니다.", citations: ["R:005930"] },
      news: { ...saved.news, source: "template", summarySource: "template", summaryBasis: "title", summary: "관련 기사 1건의 제목·출처·발행 시각을 확인할 수 있습니다." } };
    backend(path => path.includes("stock-insight") ? Promise.resolve(jsonResponse(body)) : undefined);
    mount();
    const opinion = await screen.findByRole("region", { name: "모델·근거 요약" });
    expect(within(opinion).getAllByText("규칙 기반 기본 안내")[0]).toBeInTheDocument();
    expect(within(opinion).getAllByText("규칙 기반 기본 안내")[1]).toBeInTheDocument();
    expect(within(opinion).getByRole("heading", { name: "관련 뉴스 요약" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /^모델 순위/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "가격" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /원본 기사/ })).toHaveAttribute("href", "https://news.example/article");
    expectReadableUserText(document.body, { abnormal: true });
  });
  it("combines quote and history in one card, preserving observations before news and model rank", async () => {
    backend(); mount();
    await screen.findByRole("heading", { name: "종목 A" });
    await screen.findByRole("img");

    const report = document.querySelector(".stock-report")!;
    const priceCard = screen.getByRole("region", { name: "가격" });
    const chart = within(priceCard).getByRole("group", { name: "가격 이력" });
    const newsCard = screen.getByRole("region", { name: "관련 뉴스" });
    const modelCard = report.querySelector(".report-model-card")!;
    const disclaimer = report.querySelector(".report-disclaimer")!;

    expect(chart.closest(".report-card")).toBe(priceCard);
    expect(within(priceCard).getAllByRole("heading")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "조회 가격" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "가격 이력" })).not.toBeInTheDocument();
    const price = within(priceCard).getByTestId("report-price");
    expect(price).toHaveTextContent("12,300원");
    expect(within(priceCard).getByText(/전일 대비/)).toHaveTextContent("전일 대비 0.00% · 0원");
    expect(priceCard.querySelector(".report-price-meta")).toHaveTextContent("시세 기준 시각");
    expect(priceCard.querySelector(".report-price-stats")).toHaveTextContent("거래량0거래대금0원");
    expect(chart).toHaveTextContent(/마지막 관측.*107원/);
    expect(chart).toHaveTextContent(/조회기간 1일/);
    expect(chart).toHaveTextContent(/전체 관측 표시/);
    expect(within(chart).getByText("데이터 출처·기간")).toBeInTheDocument();
    expect(within(chart).getByRole("button", { name: "가격 이력 다시 조회" })).toBeInTheDocument();
    expect(within(chart).getByRole("button", { name: "1일" })).toHaveAttribute("aria-pressed", "true");
    expect(price.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chart.compareDocumentPosition(newsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(newsCard.compareDocumentPosition(modelCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(report.querySelector(".report-evidence-group")).toBeNull();
    expect(report.querySelector(".report-rules")).toBeNull();
    expect(modelCard.compareDocumentPosition(disclaimer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("retains distinct old quote and chart timestamps and all source and coverage information", async () => {
    backend(path => path.includes("quote") ? Promise.resolve(jsonResponse({ code: "005930", currentPrice: 44800, changeRate: -1.97, change: -900, accumulatedVolume: 1234, tradingValue: 567890, source: "cache", asOf: "2026-10-06T09:00:00Z" })) : undefined);
    mount(); await screen.findByRole("img");
    const priceCard = screen.getByRole("region", { name: "가격" });
    const summary = priceCard.querySelector(".report-price-summary")!;
    expect(summary).toHaveTextContent("44,800원");
    expect(summary).toHaveTextContent("전일 대비 -1.97% · -900원");
    expect(summary).toHaveTextContent(/시세 기준 시각.*2026.*10.*06/);
    expect(summary).toHaveTextContent("지난 관측");
    expect(priceCard.querySelector(".report-price-stats")).toHaveTextContent("거래량1,234거래대금567,890원");
    const chart = within(priceCard).getByRole("group", { name: "가격 이력" });
    const sources = chart.querySelector("details")!;
    fireEvent.click(within(chart).getByText("데이터 출처·기간"));
    expect(sources).toHaveAttribute("open");
    expect(sources).toHaveTextContent(/확인 시각.*2026.*10.*07/);
    expect(sources).toHaveTextContent("실제 제공 관측 범위");
    expect(sources).toHaveTextContent("가격이 없는 구간은 선으로 잇지 않습니다.");
    expect(chart).toHaveTextContent("지난 관측");
  });
});
