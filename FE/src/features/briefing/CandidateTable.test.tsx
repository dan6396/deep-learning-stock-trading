import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow, jsonResponse } from "../../test/dataFixtures";
import { CandidateTable } from "./CandidateTable";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount(produced = false, sources?: string[]) {
  const rows = [.04, .02, -.01, 0, null].map((prediction, i) => {
    const code = String(100001 + i), raw = pipelineRow({ ticker: code, ensemble_pred_return: prediction, pred_rank: i + 6 }); raw.result.ticker = code;
    return adaptCandidate(raw, produced).data;
  });
  const fetcher = vi.fn<typeof fetch>(async path => { const code = new URL(String(path), "http://localhost").searchParams.get("symbol");
    return code === "100005" && !sources ? new Response("{}", { status: 502 }) : jsonResponse({ code, currentPrice: 10000, changeRate: -1, source: sources?.[Number(code) - 100001] ?? "live", asOf: "2026-10-08T09:00:00Z" }); });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const select = vi.fn();
  render(<QueryClientProvider client={client}><CandidateTable candidates={rows} selectedCode="100001" onSelect={select} production={produced ? "produced" : "unproduced"} /></QueryClientProvider>);
  return { fetcher, select };
}
describe("briefing comparison rows", () => {
  it("queries only the five quotes, keeps source ranks and draws bars only for positive predictions", async () => {
    const { fetcher, select } = mount(); await waitFor(() => expect(document.querySelectorAll(".briefing-quote-cell strong")[4]).toHaveTextContent("—"));
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual(Array.from({ length: 5 }, (_, i) => `/api/korean-market/quote?symbol=${100001 + i}`));
    expect(screen.getByRole("cell", { name: /100005 현재가 조회 실패/ })).toHaveAttribute("title", "현재가 조회 실패");
    expect(document.querySelector(".briefing-quote-meta")).toHaveTextContent("시세 API 조회 · 조회/저장 2026. 10. 08. 18:00 · 1건 조회 실패");
    expect([...document.querySelectorAll('[data-value="rank"]')].map(cell => cell.textContent)).toEqual(["06", "07", "08", "09", "10"]);
    const bars = document.querySelectorAll<HTMLElement>(".briefing-prediction-bar i"); expect(bars).toHaveLength(2); expect(bars[0].style.width).toBe("100%"); expect(bars[1].style.width).toBe("50%");
    expect(screen.queryByRole("columnheader", { name: "뉴스" })).not.toBeInTheDocument(); expect(document.querySelectorAll(".briefing-evidence-dots i")).toHaveLength(10);
    const first = screen.getAllByRole("button")[0]; first.focus(); fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(select).toHaveBeenLastCalledWith("100002", "keyboard"); expect(screen.getAllByRole("button")[1]).toHaveFocus();
    fireEvent.click(document.querySelectorAll("tbody tr")[2]); expect(select).toHaveBeenLastCalledWith("100003");
  });
  it("labels mixed quote provenance and suppresses sample prices and changes", async () => {
    mount(false, ["sample", "cache", "live", "cache", "live"]);
    const sample = await screen.findByRole("cell", { name: /100001 예시 시세 · 실제 가격 미표시/ });
    expect(sample).toHaveTextContent("—예시"); expect(sample).not.toHaveTextContent("10,000"); expect(sample).not.toHaveTextContent("-1.00%");
    expect(document.querySelector(".briefing-quote-meta")).toHaveTextContent("시세 혼합 · 조회/저장");
  });
  it("retains the news column and three evidence dots when final candidates exist", async () => {
    mount(true); await waitFor(() => expect(document.querySelectorAll(".briefing-quote-cell strong")[0]).toHaveTextContent("10,000원"));
    expect(screen.getByRole("columnheader", { name: "뉴스" })).toBeInTheDocument(); expect(document.querySelectorAll(".briefing-evidence-dots i")).toHaveLength(15);
  });
});
