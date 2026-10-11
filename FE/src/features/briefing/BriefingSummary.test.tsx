import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BriefingSummary } from "./BriefingSummary";
import { backendStatusBody, jsonResponse, pipelineRow } from "../../test/dataFixtures";
import { adaptCandidate } from "../../entities/candidate";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount(pending: boolean) {
  const fetcher = vi.fn<typeof fetch>(async path => jsonResponse(String(path) === "/api/backend/status" ? backendStatusBody({ state: "not_produced" }, { marker: { state: "absent" } }) : { status: "idle" }));
  vi.stubGlobal("fetch", fetcher); const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const rows = [.004, .0039, .00385, .0038, .00376].map((value, index) => adaptCandidate(pipelineRow({ ensemble_pred_return: value, pred_rank: index + 1, prediction_base_date: "2026-10-08" })).data);
  render(<QueryClientProvider client={client}><BriefingSummary indices={[]} pending={pending} error={false} count={199} rows={rows} rankPending={false} rankError={false} rankSource="cache" /></QueryClientProvider>); return fetcher;
}
describe("briefing summary status", () => {
  it("shows index loading separately from the displayed TOP5 model summary", async () => {
    const fetcher = mount(true); expect(screen.getByText("지수 조회 중")).toBeInTheDocument(); expect(screen.queryByText(/판정 불가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/모의투자 기록|고정 기록/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "브리핑 요약" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "최근 지수 흐름" })).toHaveTextContent("당일 지수 등락 기반 단순 판단");
    const summary = screen.getByRole("article", { name: "TOP5 예측 요약" });
    expect(summary).toHaveTextContent("상승 5종목"); expect(summary).not.toHaveTextContent("+0.38%");
    expect(within(summary).getByText("원본 순위 1~5위 · 예측 방향")).toBeInTheDocument();
    expect(summary).toHaveTextContent("다음 거래일 시가→종가 · 분석 기준일");
    await screen.findByText("완료 시각 미확인"); expect(fetcher.mock.calls.some(call => String(call[0]).includes("performance"))).toBe(false);
  });
  it("never labels an absent marker as a completed analysis", async () => {
    mount(false); await screen.findByText("완료 시각 미확인"); expect(screen.getByText(/완료 기록 미확인/)).toBeInTheDocument();
    expect(screen.queryByText(/최근 완료 기록/)).not.toBeInTheDocument(); expect(screen.getByText(/소요 미확인/)).toBeInTheDocument();
  });
});
