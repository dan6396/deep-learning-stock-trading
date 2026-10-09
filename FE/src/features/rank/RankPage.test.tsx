import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { RankPage } from "./RankPage";
import { wholeRank } from "./rankFixtures";
import { backendStatusBody, deferred, jsonResponse } from "../../test/dataFixtures";
const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/next/rank"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RankPage /></MemoryRouter></QueryClientProvider>);
}
function mockFetch(handler?: (path: string) => Promise<Response> | undefined) {
  const fetcher = vi.fn<typeof fetch>(async path => handler?.(String(path)) ?? (String(path) === "/api/backend/status" ? jsonResponse(backendStatusBody()) : jsonResponse(String(path) === "/api/rank" ? wholeRank() : wholeRank().slice(0, 5))));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
describe("whole-rank page fetch interactions", () => {
  it("paginates 199 rows, exposes native sort state and searches beyond five candidates", async () => {
    mockFetch(); mount(); await screen.findByText("199종목");
    expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(20);
    expect(screen.getByRole("columnheader", { name: "최종 보정 순위" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "최종 보정 예측" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "뉴스" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "최종 후보만" })).toBeInTheDocument();
    const header = screen.getByRole("columnheader", { name: "모델 예측" });
    fireEvent.click(screen.getByRole("button", { name: "모델 예측" })); expect(header).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: "모델 예측" })); expect(header).toHaveAttribute("aria-sort", "ascending");
    for (let page = 1; page < 10; page++) fireEvent.click(screen.getByRole("button", { name: "다음 순위 페이지" }));
    expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(19);
    expect(document.querySelector("[data-rank-code]:last-child [data-value=predictedReturn]")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "다음 순위 페이지" })).toBeDisabled();
  });
  it("searches the full universe and keeps zero separate from missing in filters", async () => {
    mockFetch(); mount(); await screen.findByText("199종목");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "100199" } });
    expect(await screen.findByRole("link", { name: "검증종목199 100199" })).toHaveAttribute("href", "/next/stock/100199");
    expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "negative" } });
    expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(2);
    expect(document.querySelector('[data-rank-code="100001"] [data-value="predictedReturn"]')).toHaveTextContent("0.00%");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "missing" } });
    expect(document.querySelector('[data-rank-code="100003"]')).toBeInTheDocument();
  });
  it("returns a hidden candidate filter and final sort to model controls after a mode change", async () => {
    let modelOnly = false;
    mockFetch(path => path === "/api/backend/status" ? Promise.resolve(jsonResponse(backendStatusBody({ state: "not_produced" }))) : path === "/api/candidates" && modelOnly ? Promise.resolve(jsonResponse([])) : undefined);
    mount(); await screen.findByText("199종목");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "candidate" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 보정 예측" }));
    modelOnly = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText("뉴스 보정 미사용 · 모델 예측 순위 기준");
    expect(screen.getByRole("combobox")).toHaveValue("all");
    expect(screen.getByRole("columnheader", { name: "원본 모델 순위" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.queryByRole("option", { name: "최종 후보만" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(20);
  });
  it("never fills an authoritative empty rank using candidates and distinguishes initial error", async () => {
    let fail = false; mockFetch(path => path === "/api/rank" ? Promise.resolve(fail ? new Response("{}", { status: 502 }) : jsonResponse([])) : undefined); mount();
    expect(await screen.findByText("최신 전체 분석 결과가 비어 있습니다.")).toBeInTheDocument(); expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(0);
    fail = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" })); await screen.findByText("이전 조회 결과 · 전체 순위 갱신 실패");
  });
  it("uses the active all filter for an empty search after hiding a previously selected candidate filter", async () => {
    let modelOnly = false;
    mockFetch(path => path === "/api/backend/status" ? Promise.resolve(jsonResponse(backendStatusBody({ state: "not_produced" }))) : path === "/api/candidates" && modelOnly ? Promise.resolve(jsonResponse([])) : undefined);
    mount(); await screen.findByText("199종목");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "candidate" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "검색결과없음" } });
    modelOnly = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    await screen.findByText("뉴스 보정 미사용 · 모델 예측 순위 기준");
    expect(screen.getByRole("combobox")).toHaveValue("all");
    expect(screen.getByText("검색 조건에 맞는 종목이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("최종 후보 목록을 확인할 수 없어 필터 결과를 제공하지 않습니다.")).not.toBeInTheDocument();
  });
  it.each([false, true])("keeps final columns hidden throughout initial production loading (produced=%s)", async produced => {
    const candidates = deferred<Response>(), status = deferred<Response>();
    mockFetch(path => path === "/api/candidates" ? candidates.promise : path === "/api/backend/status" ? status.promise : undefined);
    mount(); await screen.findByText("199종목");
    expect(screen.queryByRole("columnheader", { name: "최종 보정 순위" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "최종 보정 예측" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "뉴스" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "근거 일치도" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "최종 후보만" })).not.toBeInTheDocument();
    candidates.resolve(jsonResponse(produced ? wholeRank().slice(0, 5) : []));
    if (produced) {
      expect(await screen.findByRole("columnheader", { name: "최종 보정 순위" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "뉴스" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "근거 일치도" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "최종 후보만" })).toBeInTheDocument();
    }
    else {
      await waitFor(() => expect(document.querySelector('[data-rank-code]')).toHaveAttribute("data-membership", "pending"));
      expect(screen.queryByRole("columnheader", { name: "최종 보정 순위" })).not.toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "뉴스" })).not.toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "근거 일치도" })).not.toBeInTheDocument();
      status.resolve(jsonResponse(backendStatusBody({ state: "not_produced" })));
      await screen.findByText("뉴스 보정 미사용 · 모델 예측 순위 기준");
      expect(screen.queryByRole("columnheader", { name: "최종 보정 순위" })).not.toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "뉴스" })).not.toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "근거 일치도" })).toBeInTheDocument();
    }
  });
  it("hides news, agreement and candidate filter when production is unknown", async () => {
    mockFetch(path => path === "/api/candidates" ? Promise.resolve(jsonResponse([])) : path === "/api/backend/status" ? Promise.resolve(new Response("{}", { status: 502 })) : undefined);
    mount(); await screen.findByText(/최종 후보 생성 여부를 확인하지 못했습니다/);
    expect(screen.queryByRole("columnheader", { name: "뉴스" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "근거 일치도" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "최종 후보만" })).not.toBeInTheDocument();
  });
  it("retains raw rank rows but hides all final and mode-dependent columns after a candidate refresh error", async () => {
    let fail = false; mockFetch(path => path === "/api/candidates" && fail ? Promise.resolve(new Response("{}", { status: 502 })) : undefined);
    mount(); await screen.findByRole("columnheader", { name: "최종 보정 순위" });
    fail = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" })); await screen.findByText(/최종 후보 조회 실패/);
    expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(20);
    for (const name of ["최종 보정 순위", "최종 보정 예측", "뉴스", "근거 일치도"]) expect(screen.queryByRole("columnheader", { name })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "최종 후보만" })).not.toBeInTheDocument();
  });
  it("fails model membership closed while retaining actual non-candidate LLM news", async () => {
    const candidates = deferred<Response>(), rows = wholeRank(); rows[10].news = [{ title: "LLM 기사", sentiment: "POSITIVE" }];
    Object.assign(rows[10].data_meta, { newsMethod: "llm", newsStatus: "analyzed", newsCollected: true });
    mockFetch(path => path === "/api/candidates" ? candidates.promise : path === "/api/backend/status" ? undefined : Promise.resolve(jsonResponse(rows))); mount();
    await screen.findByText("199종목");
    expect(document.querySelector('[data-rank-code="100011"] [data-rank-signal="model"] [data-signal]')).toHaveAttribute("data-signal", "unavailable");
    candidates.resolve(jsonResponse([])); await waitFor(() => expect(document.querySelector('[data-rank-code="100011"]')).toHaveAttribute("data-membership", "nonCandidate"));
    const news = document.querySelector('[data-rank-code="100011"] [data-rank-signal="news"]')!;
    expect(news).toHaveTextContent("긍정"); expect(news).not.toHaveTextContent("미분석");
  });
  it("labels sample responses and retains previous results on background error", async () => {
    let fail = false; mockFetch(path => path === "/api/rank" ? Promise.resolve(fail ? new Response("{}", { status: 502 }) : jsonResponse(wholeRank(), { "x-data-source": "sample" })) : undefined); mount();
    await screen.findByText("예시 데이터 · 실제 전체 분석 결과가 아닙니다.");
    fail = true; fireEvent.click(screen.getByRole("button", { name: "다시 조회" })); await screen.findByText("이전 조회 결과 · 전체 순위 갱신 실패");
    expect(document.querySelectorAll("[data-rank-code]")).toHaveLength(20);
  });
});
