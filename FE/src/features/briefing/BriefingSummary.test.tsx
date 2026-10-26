import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BriefingExecutionBar, BriefingSummary } from "./BriefingSummary";
import { adaptAnalysisStatus, adaptBackendStatus, queries } from "../../shared/api/queries";
import { adaptBriefing } from "../../entities/briefing";
import { backendStatusBody, jsonResponse, pipelineRow } from "../../test/dataFixtures";
import { adaptCandidate } from "../../entities/candidate";
import { formatDate } from "../../shared/lib/format";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount(pending: boolean) {
  const fetcher = vi.fn<typeof fetch>(async path => jsonResponse(String(path) === "/api/backend/status" ? backendStatusBody({ state: "not_produced" }, { marker: { state: "absent" } }) : { status: "idle" }));
  vi.stubGlobal("fetch", fetcher); const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const rows = [.004, .0039, .00385, .0038, .00376].map((value, index) => adaptCandidate(pipelineRow({ ensemble_pred_return: value, pred_rank: index + 1, prediction_base_date: "2026-10-08" })).data);
  render(<QueryClientProvider client={client}><BriefingSummary indices={[]} pending={pending} error={false} count={199} rows={rows} rankPending={false} rankError={false} rankSource="cache" /></QueryClientProvider>); return fetcher;
}
describe("briefing summary status", () => {
  it.each(["running", "failed"] as const)("shows the previous completed snapshot's time, duration and pool instead of current-run metadata (%s)", reason => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } }); clients.push(client);
    client.setQueryData(queries.backendStatus().queryKey, adaptBackendStatus(backendStatusBody(undefined, { marker: {
      state: "completed", startedAt: "2026-10-09T08:00:00Z", finishedAt: "2026-10-09T08:00:40Z",
    } })));
    client.setQueryData(queries.analysisRun().queryKey, { data: adaptAnalysisStatus({ status: "idle" }), source: "live", asOf: null });
    client.setQueryData(queries.briefing().queryKey, adaptBriefing({ version: 1, status: "ready", previousRun: { reason }, stocks: [],
      model: { modelId: "fixture", scoreKind: "rank_zscore", baseDate: "2026-10-08", poolSize: 6,
        runStartedAt: "2026-10-08T08:00:00Z", finishedAt: "2026-10-08T08:00:35Z", elapsedMs: 35000 } }));
    render(<QueryClientProvider client={client}><BriefingExecutionBar pool={999} /></QueryClientProvider>);
    const bar = screen.getByRole("status", { name: "분석 실행 상태" });
    expect(bar).toHaveTextContent(`분석 완료 ${formatDate("2026-10-08T08:00:35Z", true)}`);
    expect(bar).toHaveTextContent("모집단 6종목 (소요 0분 35초)");
    expect(bar).not.toHaveTextContent("199종목"); expect(bar).not.toHaveTextContent("40초");
    expect(bar).not.toHaveTextContent("999종목");
    expect(bar).toHaveTextContent(reason === "running" ? "새 분석 진행 중 · 이전 결과 표시" : "새 분석 실패 · 이전 결과 표시");
  });
  it("does not invent missing snapshot times from a newer completed marker", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } }); clients.push(client);
    client.setQueryData(queries.backendStatus().queryKey, adaptBackendStatus(backendStatusBody(undefined, { marker: {
      state: "completed", startedAt: "2026-10-09T08:00:00Z", finishedAt: "2026-10-09T08:00:40Z",
    } })));
    client.setQueryData(queries.analysisRun().queryKey, { data: adaptAnalysisStatus({ status: "idle" }), source: "live", asOf: null });
    client.setQueryData(queries.briefing().queryKey, adaptBriefing({ version: 1, status: "ready", previousRun: { reason: "running" },
      model: { modelId: "fixture", baseDate: "2026-10-08", poolSize: 6 }, stocks: [] }));
    render(<QueryClientProvider client={client}><BriefingExecutionBar pool={null} /></QueryClientProvider>);
    const bar = screen.getByRole("status", { name: "분석 실행 상태" });
    expect(bar).toHaveTextContent("분석 완료 —"); expect(bar).toHaveTextContent("모집단 6종목 (—)");
    expect(bar).not.toHaveTextContent("40초");
  });
  it.each(["running", "failed"] as const)("shows the server snapshot flag once in the execution bar (%s)", reason => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } }); clients.push(client);
    client.setQueryData(queries.backendStatus().queryKey, adaptBackendStatus(backendStatusBody()));
    client.setQueryData(queries.analysisRun().queryKey, { data: adaptAnalysisStatus({ status: "idle" }), source: "live", asOf: null });
    client.setQueryData(queries.briefing().queryKey, adaptBriefing({ version: 1, status: "ready", previousRun: { reason }, stocks: [] }));
    render(<QueryClientProvider client={client}><BriefingExecutionBar pool={199} /></QueryClientProvider>);
    expect(screen.getByRole("status", { name: "분석 실행 상태" })).toHaveTextContent(reason === "running" ? "새 분석 진행 중 · 이전 결과 표시" : "새 분석 실패 · 이전 결과 표시");
    expect(screen.queryByText("최신 완료 결과")).not.toBeInTheDocument();
  });
  it.each(["adhoc", "official", "unknown", undefined] as const)("warns about adhoc or unverified result metadata, leaving official results unlabelled (%s)", kind => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } }); clients.push(client);
    // A newer official job must not relabel the adhoc result currently displayed.
    client.setQueryData(queries.backendStatus().queryKey, adaptBackendStatus(backendStatusBody({ state: "not_produced" }, { marker: { state: "completed", kind: "official" } })));
    client.setQueryData(queries.analysisRun().queryKey, { data: adaptAnalysisStatus({ status: "idle" }), source: "live", asOf: null });
    const briefing = adaptBriefing({});
    if (kind === undefined) delete briefing.kind; else briefing.kind = kind;
    client.setQueryData(queries.briefing().queryKey, briefing);
    render(<QueryClientProvider client={client}><BriefingExecutionBar pool={199} /></QueryClientProvider>);
    const notice = screen.queryByText("수시 분석");
    const unknown = screen.queryByText("분류 미확인");
    if (kind === "adhoc") expect(notice).toHaveClass("briefing-execution-error"); else expect(notice).not.toBeInTheDocument();
    if (kind === "unknown" || kind === undefined) expect(unknown).toHaveClass("briefing-execution-error"); else expect(unknown).not.toBeInTheDocument();
  });
  it("shows index loading separately from the displayed TOP5 model summary", async () => {
    const fetcher = mount(true); expect(screen.getByText("지수 조회 중")).toBeInTheDocument(); expect(screen.queryByText(/판정 불가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/모의투자 기록|고정 기록/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "브리핑 요약" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "최근 지수 흐름" })).toHaveTextContent("당일 지수 등락 기반 단순 판단");
    const summary = screen.getByRole("article", { name: "TOP5 예측 요약" });
    expect(summary).toHaveTextContent("상승 5종목"); expect(summary).not.toHaveTextContent("+0.38%");
    expect(within(summary).getByText("원본 순위 1~5위 · 예측 방향")).toBeInTheDocument();
    expect(summary).toHaveTextContent("다음 거래일 시가→종가 · 분석 기준일");
    expect(screen.getByRole("article", { name: "분석 및 데이터" }).querySelector("strong")).toHaveTextContent("—"); expect(fetcher.mock.calls.some(call => String(call[0]).includes("performance"))).toBe(false);
  });
  it("never labels an absent marker as a completed analysis", async () => {
    mount(false); expect(screen.getByRole("article", { name: "분석 및 데이터" }).querySelector("strong")).toHaveTextContent("—");
    expect(screen.queryByText(/최신 완료 결과/)).not.toBeInTheDocument(); expect(screen.queryByText(/미확인/)).not.toBeInTheDocument();
  });
  it.each(["idle", "running"])("uses live analysis status even while backend still describes the previous completion (%s)", status => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    clients.push(client);
    client.setQueryData(queries.backendStatus().queryKey, adaptBackendStatus(backendStatusBody({ state: "not_produced" }, { marker: { state: "completed", kind: "official" } })));
    client.setQueryData(queries.analysisRun().queryKey, { data: adaptAnalysisStatus({ status }), source: "live", asOf: null });
    client.setQueryData(queries.briefing().queryKey, adaptBriefing({}));
    const rows = [.004].map((value, index) => adaptCandidate(pipelineRow({ ensemble_pred_return: value, pred_rank: index + 1, prediction_base_date: "2026-10-08" })).data);
    render(
      <QueryClientProvider client={client}>
        <BriefingExecutionBar pool={199} />
        <BriefingSummary indices={[]} pending={false} error={false} count={199} rows={rows} rankPending={false} rankError={false} rankSource="cache" />
      </QueryClientProvider>
    );
    if (status === "running") {
      expect(screen.getAllByText("새 분석 진행 중 · 이전 결과 표시")).toHaveLength(1);
      expect(screen.getByText("분석 진행 중")).toBeInTheDocument();
      expect(screen.queryByText("최신 완료 결과")).not.toBeInTheDocument();
    } else expect(screen.getAllByText("최신 완료 결과").length).toBeGreaterThanOrEqual(1);
  });
  it("renders KOSPI200 value and change rate when index data is provided", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <BriefingSummary
          indices={[
            {
              source: "live",
              asOf: null,
              data: {
                symbol: "KOSPI200",
                name: "코스피200",
                value: 360.5,
                change: 3.05,
                changeRate: 0.85,
                miniSeries: [],
                miniSeriesSource: "history",
              },
            },
          ]}
          pending={false}
          error={false}
          count={200}
          rows={[]}
          rankPending={false}
          rankError={false}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText(/코스피200 360\.50/)).toBeInTheDocument();
    expect(screen.getByText("+0.85%")).toBeInTheDocument();
  });
});
