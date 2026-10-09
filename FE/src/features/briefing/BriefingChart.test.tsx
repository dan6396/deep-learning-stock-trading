import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BriefingChart } from "./BriefingChart";
import { chartBundle } from "../stock/reportFixtures";
import { jsonResponse } from "../../test/dataFixtures";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount(bundle: unknown, error = false) {
  const fetcher = vi.fn<typeof fetch>(async () => error ? new Response("{}", { status: 502 }) : jsonResponse(bundle)); vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><BriefingChart code="005930" /></QueryClientProvider>); return fetcher;
}
describe("briefing month chart provenance", () => {
  it("requests the stock chart and splits explicit missing observations instead of joining them", async () => {
    const bundle = chartBundle(); Object.assign(bundle.chartData.ranges["1M"].prices[1], { price: null });
    const fetcher = mount(bundle), chart = await screen.findByRole("img", { name: /2개 가격 관측/ });
    expect(chart).toHaveAttribute("data-chart-range", "1M"); expect(chart.querySelectorAll("[data-chart-segment]")).toHaveLength(2);
    expect(fetcher.mock.calls[0][0]).toBe("/api/korean-market/stock-chart?symbol=005930"); expect(screen.getByText("저장된 결과")).toBeInTheDocument();
  });
  it("labels explicit interpolation instead of describing it as observed history", async () => {
    const bundle = chartBundle(); Object.assign(bundle.chartData.ranges["1M"], { interpolated: true }); mount(bundle);
    expect(await screen.findByRole("img", { name: /보간 가격점/ })).toBeInTheDocument(); expect(screen.getByText("보간값 · 결측 미연결")).toBeInTheDocument();
    expect(screen.getByText(/보간값이며 실제 관측 이력이 아닙니다/).closest("details")).not.toHaveAttribute("open");
  });
  it("shows the actual observed dates rather than claiming a month for a longer 1M API response", async () => {
    const bundle = chartBundle(), range = bundle.chartData.ranges["1M"];
    Object.assign(range.prices[0], { date: "2026-08-25", rawDate: "2026-08-25" });
    Object.assign(range, { coverage: { requestedRange: "1M", sourceRange: "3M", method: "subset", status: "unverified" } }); mount(bundle);
    await screen.findByRole("img"); expect(screen.getByRole("heading", { name: "가격 이력" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "최근 1개월" })).not.toBeInTheDocument(); expect(screen.getByText("2026. 08. 25. – 2026. 10. 07.")).toBeInTheDocument();
    expect(screen.getByText(/3M 원본에서 제공 · 전체 기간 제공 여부 미확인/).closest("details")).not.toHaveAttribute("open");
  });
  it.each(["sample", "unknown"])("does not draw unverified %s provenance as real history", async source => {
    mount(chartBundle("005930", source)); await screen.findByText(source === "sample" ? "예시 가격 이력 · 실제 관측 차트 미제공" : "가격 이력 출처 미확인");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("shows no chart or fabricated prices on a failed GET", async () => {
    mount(null, true); await screen.findByText("가격 이력 조회 실패 · —"); expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
