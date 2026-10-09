import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BriefingSummary } from "./BriefingSummary";
import { backendStatusBody, jsonResponse } from "../../test/dataFixtures";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount(pending: boolean) {
  const fetcher = vi.fn<typeof fetch>(async path => jsonResponse(String(path) === "/api/backend/status" ? backendStatusBody({ state: "not_produced" }, { marker: { state: "absent" } }) : { status: "idle" }));
  vi.stubGlobal("fetch", fetcher); const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><BriefingSummary indices={[]} pending={pending} error={false} count={199} /></QueryClientProvider>); return fetcher;
}
describe("briefing summary status", () => {
  it("shows loading before index assessment and labels the fixed record separately", async () => {
    const fetcher = mount(true); expect(screen.getByText("지수 조회 중")).toBeInTheDocument(); expect(screen.queryByText(/판정 불가/)).not.toBeInTheDocument();
    expect(screen.getByText("모의투자 기록 · 10/6–10/8")).toBeInTheDocument(); expect(screen.getByText("고정 기록")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "브리핑 요약" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "최근 지수 흐름" })).toHaveTextContent("당일 지수 등락 기반 단순 판단");
    const paper = screen.getByRole("article", { name: "고정 모의투자 기록" });
    expect(paper.querySelector(".briefing-paper-capital")).toHaveTextContent("976.1만 원 -2.39%");
    expect(within(paper).getByText(/모의투자 · 3거래일/).closest("details")).toBeNull();
    expect(within(paper).getByText("고정 기록").closest("details")).toBeNull();
    await screen.findByText("완료 시각 미확인"); expect(fetcher.mock.calls.some(call => String(call[0]).includes("performance"))).toBe(false);
  });
  it("never labels an absent marker as a completed analysis", async () => {
    mount(false); await screen.findByText("완료 시각 미확인"); expect(screen.getByText(/완료 기록 미확인/)).toBeInTheDocument();
    expect(screen.queryByText(/최근 완료 기록/)).not.toBeInTheDocument(); expect(screen.getByText(/소요 미확인/)).toBeInTheDocument();
  });
});
