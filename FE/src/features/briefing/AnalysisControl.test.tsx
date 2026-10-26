import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AnalysisControl } from "./AnalysisControl";
import { backendStatusBody, deferred, jsonResponse, pipelineRow } from "../../test/dataFixtures";
import { adaptCandidate } from "../../entities/candidate";
import { adaptBriefing } from "../../entities/briefing";
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
  it("shows the final narrative stage while keeping execution disabled", async () => {
    setup({ run: { status: "running", progress: { stage: "AI 요약 생성", stageIndex: 7, stageCount: 8, progressPercent: 99, message: "AI 요약 생성 중 · 현재 결과는 그대로 표시합니다." } } });
    expect(await screen.findByText("AI 요약 생성 · 8/8단계")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분석 진행 중" })).toBeDisabled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "99");
  });
  it("always sends adhoc and does not offer official execution", async () => {
    const test = setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    expect(screen.queryByRole("checkbox", { name: "공식 성과 기록 요청" })).not.toBeInTheDocument();
    expect(test.posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await waitFor(() => expect(test.posts()).toHaveLength(1));
    expect(test.posts()[0][0]).toBe("/api/candidates/run?mode=model_only&kind=adhoc");
  });
  it("does not launch on mount and explains model-only output", async () => {
    const test = setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    expect(test.posts()).toHaveLength(0);
    expect(screen.getByText(/모델 순위를 계산한 뒤 TOP5의 관련 기사를 수집/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "전체 순위 보기" })).toHaveAttribute("href", "/next/rank");
  });
  it("keeps existing data while requesting the server briefing refresh flag on launch", async () => {
    const test = setup(), rank = [{ code: "005930", rankScore: 1.2 }], briefing = { status: "ready", stocks: rank };
    test.client.setQueryData(["rank"], rank); test.client.setQueryData(["briefing"], briefing);
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await screen.findByRole("button", { name: "분석 진행 중" });
    expect(test.client.getQueryData(["rank"])).toEqual(rank);
    expect(test.client.getQueryData(["briefing"])).toEqual(briefing);
    expect(test.client.getQueryState(["rank"])?.isInvalidated).toBe(false);
    expect(test.client.getQueryState(["briefing"])?.isInvalidated).toBe(true);
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
  it.each([401, 403, 429])("renders recovery guidance for a rejected HTTP %s launch without retrying it", async status => {
    const test = setup({ post: async () => new Response("", { status, headers: { "Retry-After": "30" } }) });
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await screen.findByText(status === 401 ? /관리자 인증이 필요합니다/ : status === 403 ? /수시 실행으로 요청/ : /30초 후 다시 시도/);
    if (status === 401) expect(screen.getByRole("link", { name: "관리자 인증하기" })).toHaveAttribute("href", "/next?admin=");
    expect(test.posts()).toHaveLength(1);
  });
  it("shows server percent and stage position with viewer labels, keeping identifiers collapsed", async () => {
    setup({ run: { status: "running", runId: "fixture-run", elapsedMs: 23000, progress: { stage: "OHLCV 수집·앙상블 예측", stageIndex: 2, stageCount: 7, progressPercent: 62, message: "OHLCV 수집·앙상블 예측 중 · 199종목 중 124종목 처리" } } });
    expect(await screen.findByText("종목 가격 수집·모델 예측 · 3/7단계")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("199종목 중 124종목 처리 · 0분 23초 경과")).toBeInTheDocument();
    expect(screen.getAllByText(/종목 가격 수집·모델 예측/)).toHaveLength(1);
    expect(screen.queryByText(/OHLCV/)).not.toBeInTheDocument();
    const information = screen.getByText("실행 정보").closest("details");
    expect(information).not.toHaveAttribute("open");
    expect(screen.getByText(/실행 식별자 fixture-run/)).not.toBeVisible();
  });
  it("preserves unknown stage messages without inventing percent or stage positions", async () => {
    setup({ run: { status: "running", progress: { stage: "새 단계", stageIndex: 7, stageCount: 7, message: "새 작업 처리 중" } } });
    expect(await screen.findByText(/새 작업 처리 중/)).toBeInTheDocument();
    expect(screen.getByText("새 단계")).toBeInTheDocument();
    expect(screen.getByText("진행률 확인 중")).toBeInTheDocument();
    expect(screen.queryByText(/8\/7단계/)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  });
  it("refreshes existing result queries on completion and explains model-only candidates", async () => {
    const test = setup({ post: async () => jsonResponse({ status: "completed", startedAt: Date.parse("2026-10-26T04:00:00Z"), result: { mode: "model_only", rows: 0 } }) });
    test.client.setQueryData(queryKeys.rank(), { data: [adaptCandidate(pipelineRow()).data], source: "cache", asOf: "2026-10-23T04:00:00Z" });
    test.client.setQueryData(queryKeys.candidates(), { data: [] });
    await waitFor(() => expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await screen.findByText(/분석 완료 · 모델 TOP5가 준비됐습니다/);
    expect(test.client.getQueryState(queryKeys.rank())?.isInvalidated).toBe(true);
    expect(test.client.getQueryState(queryKeys.candidates())?.isInvalidated).toBe(true);
  });
  it("refreshes active briefing and rank when a polled running job completes", async () => {
    let revision = "old";
    const startedAt = Date.parse("2026-10-26T04:00:00Z"), resultTime = () => new Date(startedAt + (revision === "old" ? -60000 : 1000)).toISOString();
    const test = setup({ run: { status: "running" } });
    const rank = new QueryObserver(test.client, { queryKey: queryKeys.rank(), queryFn: async () => {
      const row = pipelineRow(); row.result.company_name = revision;
      return { data: [adaptCandidate(row).data], source: "cache" as const, asOf: resultTime() };
    } });
    const briefing = new QueryObserver(test.client, { queryKey: queryKeys.briefing(), queryFn: async () => adaptBriefing({ status: "ready",
      model: { modelId: "fixture", baseDate: "2026-10-23", runStartedAt: revision === "old" ? resultTime() : new Date(startedAt).toISOString() }, narrative: { overview: revision } }) });
    const stopRank = rank.subscribe(() => {}), stopBriefing = briefing.subscribe(() => {});
    try {
      await screen.findByRole("progressbar");
      await waitFor(() => expect([rank.getCurrentResult().data?.data[0]?.name, briefing.getCurrentResult().data?.narrative.overview]).toEqual(["old", "old"]));
      revision = "new"; test.setRun({ status: "completed", startedAt, elapsedMs: 42000, result: { runId: "new-run" } });
      await test.client.refetchQueries({ queryKey: queryKeys.analysisRun() });
      await waitFor(() => expect([rank.getCurrentResult().data?.data[0]?.name, briefing.getCurrentResult().data?.narrative.overview]).toEqual(["new", "new"]));
      expect(test.posts()).toHaveLength(0);
    } finally { stopRank(); stopBriefing(); }
  });
  it("shows a server failure and lets the user recheck without a new launch", async () => {
    const test = setup({ run: { status: "failed", error: "결과 파일 확인 필요" } });
    await screen.findByText(/분석 실패 · 결과 파일 확인 필요/);
    fireEvent.click(screen.getByRole("button", { name: "실행 상태 다시 확인" }));
    await waitFor(() => expect(test.fetcher.mock.calls.filter(([url]) => String(url) === "/api/candidates/run").length).toBeGreaterThan(1));
    expect(test.posts()).toHaveLength(0);
  });
});

beforeEach(() => window.sessionStorage.setItem("kospi-admin-token.v1", "fixture-admin"));
