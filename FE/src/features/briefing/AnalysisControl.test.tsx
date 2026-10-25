import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AnalysisControl } from "./AnalysisControl";
import { backendStatusBody, deferred, jsonResponse } from "../../test/dataFixtures";
import { queryKeys } from "../../shared/api/queries";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });

function setup(options: { mode?: "model_only" | "full" | "unknown"; newsReady?: boolean; run?: Record<string, unknown>; post?: () => Promise<Response> } = {}) {
  let mode = options.mode ?? "model_only";
  let run = options.run ?? { status: "idle" };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, request) => {
    if (String(url) === "/api/backend/status") return jsonResponse({ ...backendStatusBody(), analysisMode: mode, news: { configuration: options.newsReady === false ? "not_configured" : "configured", collectionConfiguration: options.newsReady === false ? "not_configured" : "configured", verification: "unverified" } });
    if (String(url).startsWith("/api/candidates/run")) {
      if (request?.method === "POST") return options.post ? options.post() : jsonResponse(run = { status: "running" });
      return jsonResponse(run);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/next"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AnalysisControl /></MemoryRouter></QueryClientProvider>);
  const posts = () => fetcher.mock.calls.filter(([, request]) => request?.method === "POST");
  return { client, fetcher, posts, setMode: (next: typeof mode) => { mode = next; }, setRun: (next: typeof run) => { run = next; } };
}

describe("analysis launch control", () => {
  it("defaults to adhoc and sends official intent only after the user selects it", async () => {
    const test = setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: "공식 성과 기록 요청" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "공식 성과 기록 요청" }));
    expect(test.posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await waitFor(() => expect(test.posts()).toHaveLength(1));
    expect(test.posts()[0][0]).toBe("/api/candidates/run?mode=model_only&kind=official");
  });
  it("does not launch on mount and explains model-only output", async () => {
    const test = setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    expect(test.posts()).toHaveLength(0);
    expect(screen.getByText(/모델 순위를 계산한 뒤 TOP5의 관련 기사를 수집/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "전체 순위 보기" })).toHaveAttribute("href", "/next/rank");
  });
  it("keeps existing rank and briefing data in cache when a new run starts", async () => {
    const test = setup(), rank = [{ code: "005930", rankScore: 1.2 }], briefing = { status: "ready", stocks: rank };
    test.client.setQueryData(["rank"], rank); test.client.setQueryData(["briefing"], briefing);
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await screen.findByRole("button", { name: "분석 진행 중" });
    expect(test.client.getQueryData(["rank"])).toEqual(rank);
    expect(test.client.getQueryData(["briefing"])).toEqual(briefing);
    expect(test.client.getQueryState(["rank"])?.isInvalidated).toBe(false);
    expect(test.client.getQueryState(["briefing"])?.isInvalidated).toBe(false);
  });
  it("guards rapid clicks while a request is pending and attaches to the running job", async () => {
    const pending = deferred<Response>(), test = setup({ post: () => pending.promise });
    const button = screen.getByRole("button", { name: "분석 시작" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(test.posts()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "실행 요청 중" })).toBeDisabled();
    pending.resolve(jsonResponse({ status: "running", elapsedMs: 65000, progress: { message: "모델 추론 중", progressPercent: 46 } }));
    await screen.findByText("모델 추론 중 · 1분 5초 경과");
    expect(screen.getByRole("button", { name: "분석 진행 중" })).toBeDisabled();
    expect(screen.getByRole("progressbar", { name: "분석 진행률" })).toHaveAttribute("value", "46");
    expect(test.posts()).toHaveLength(1);
  });
  it("reattaches after navigation without launching again and supports unknown progress", async () => {
    const test = setup({ run: { status: "running" } });
    expect(await screen.findByRole("button", { name: "분석 진행 중" })).toBeDisabled();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    expect(test.posts()).toHaveLength(0);
  });
  it.each(["full", "unknown", "model_only"] as const)("always submits model inference + collection for server default %s, without paid options", async mode => {
    const test = setup({ mode, newsReady: false });
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/Gemini/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await waitFor(() => expect(test.posts()).toHaveLength(1));
    expect(test.posts()[0][0]).toBe("/api/candidates/run?mode=model_only&kind=adhoc");
  });
  it("rechecks status after an ambiguous POST failure without retrying the launch", async () => {
    const test = setup({ post: async () => { test.setRun({ status: "running" }); throw new Error("connection lost"); } });
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await screen.findByText(/서버에서 시작됐을 수 있으니/);
    expect(await screen.findByRole("button", { name: "분석 진행 중" })).toBeDisabled();
    expect(test.posts()).toHaveLength(1);
  });
  it("refreshes existing result queries on completion and explains model-only candidates", async () => {
    const test = setup({ post: async () => jsonResponse({ status: "completed", result: { mode: "model_only", rows: 0 } }) });
    test.client.setQueryData(queryKeys.rank(), { data: ["old result"] });
    test.client.setQueryData(queryKeys.candidates(), { data: [] });
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await screen.findByText(/분석 완료 · 모델 TOP5가 준비됐습니다/);
    expect(test.client.getQueryState(queryKeys.rank())?.isInvalidated).toBe(true);
    expect(test.client.getQueryState(queryKeys.candidates())?.isInvalidated).toBe(true);
  });
  it("shows a server failure and lets the user recheck without a new launch", async () => {
    const test = setup({ run: { status: "failed", error: "결과 파일 확인 필요" } });
    await screen.findByText(/분석 실패 · 결과 파일 확인 필요/);
    fireEvent.click(screen.getByRole("button", { name: "실행 상태 다시 확인" }));
    await waitFor(() => expect(test.fetcher.mock.calls.filter(([url]) => String(url) === "/api/candidates/run").length).toBeGreaterThan(1));
    expect(test.posts()).toHaveLength(0);
  });
});
