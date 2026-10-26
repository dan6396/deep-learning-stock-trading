import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { elapsedLabel, HistoryPage, progressUpdatedLabel } from "./HistoryPage";
import { backendStatusBody, jsonResponse, pipelineRow } from "../../test/dataFixtures";
import { expectReadableUserText } from "../../test/assertUserText";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/next/history"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><HistoryPage /></MemoryRouter></QueryClientProvider>);
  return client;
}
function backend(state: () => unknown, candidates: unknown[] = [], status: Parameters<typeof backendStatusBody>[0] = { state: "empty", count: 0 }, overrides: Parameters<typeof backendStatusBody>[1] = {}, rank: Record<string, unknown> = {}) {
  const body = backendStatusBody(status, overrides); Object.assign(body.results.rank, rank);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url) === "/api/candidates/run" ? jsonResponse(state())
    : String(url) === "/api/backend/status" ? jsonResponse(body) : jsonResponse(candidates));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("keeps a measured zero and raw progress separate from unknown official records", async () => {
  const fetcher = backend(() => ({ status: "completed", elapsedMs: 0, progress: { updatedAt: 0, message: "완료" }, result: { rows: 25, runId: "not-an-official-proof" } }), [pipelineRow()]); mount();
  await screen.findByText("최신 실행 완료");
  expect(screen.getByTestId("history-elapsed")).toHaveTextContent("0초");
  expect(screen.getByTestId("history-progress-updated")).toHaveTextContent(/^미확인$/);
  expect(screen.getByTestId("history-candidate-count")).toHaveTextContent("1개");
  expect(screen.getAllByText("미확인")).toHaveLength(1);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText("not-an-official-proof")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "브리핑에서 근거 확인" })).toHaveAttribute("href", "/next");
  expect(screen.getByText("실측 성과는 실제 주문 손익이 아니며 미래 수익을 보장하지 않습니다.")).toBeVisible();
  expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
});
it("shows only result provenance without borrowing the last marker classification or reference", async () => {
  const runId = "unknown-kind-run-id";
  backend(() => ({ status: "idle" }), [pipelineRow()], { state: "available", count: 1 }, { marker: { state: "completed", kind: "unknown", runId } });
  mount();
  await waitFor(() => expect(screen.getByTestId("history-candidate-count")).toHaveTextContent("1개"));
  const card = screen.getByRole("region", { name: "현재 분석 결과" });
  expect(within(card).getByText("결과 출처")).not.toBeVisible();
  expect(within(card).queryByText("공식 / 수시 구분")).not.toBeInTheDocument();
  expect(within(card).queryByText("실행 정보")).not.toBeInTheDocument();
  expect(within(card).queryByText(runId)).not.toBeInTheDocument();
  fireEvent.click(within(card).getByText("자세히"));
  expect(within(card).getByText("결과 출처")).toBeVisible();
});
it("does not turn missing elapsed/progress/candidate information into zero", async () => {
  backend(() => ({ status: "idle", elapsedMs: null, progress: null })); mount();
  await screen.findByText("실행 중인 분석 없음");
  expect(screen.getByTestId("history-elapsed")).toHaveTextContent(/^—$/);
  expect(screen.getByTestId("history-progress-updated")).toHaveTextContent(/^미확인$/);
  expect(await screen.findByText("현재 조회된 최종 후보가 없습니다.")).toBeInTheDocument();
  expect(screen.getByTestId("history-candidate-count")).toHaveTextContent("0개");
});
it("does not turn an unproduced model-only candidate list into zero final candidates", async () => {
  backend(() => ({ status: "completed", elapsedMs: 5000, progress: { updatedAt: 0, message: "완료" }, result: { mode: "model_only", candidateKind: "not_produced", rows: 199, modelSelectionRows: 10, newsRows: 0 } }), [], { state: "not_produced" }); mount();
  await screen.findByText("모델 실행 완료");
  expect(screen.queryByText("최신 실행 완료")).not.toBeInTheDocument();
  expect(screen.queryByTestId("history-model-only")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("history-candidate-count")).toHaveTextContent(/^199종목$/));
  expect(screen.queryByText(/뉴스 보정은 실행하지 않았습니다/)).not.toBeInTheDocument();
  expect(screen.queryByText("현재 조회된 최종 후보가 없습니다.")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "전체 모델 순위 보기" })).toHaveAttribute("href", "/next/rank");
});
it("keeps an empty list unconfirmed when the analysis result is missing", async () => {
  backend(() => ({ status: "idle" }), [], { state: "missing" }); mount();
  await waitFor(() => expect(screen.getByTestId("history-candidate-count")).toHaveTextContent(/^미확인$/));
  expect(screen.queryByText("현재 조회된 최종 후보가 없습니다.")).not.toBeInTheDocument();
});
it("keeps an empty list unconfirmed when the status read fails", async () => {
  const fetcher = vi.fn<typeof fetch>(async url => String(url) === "/api/backend/status" ? new Response("{}", { status: 502 }) : String(url) === "/api/candidates/run" ? jsonResponse({ status: "idle" }) : jsonResponse([]));
  vi.stubGlobal("fetch", fetcher); mount();
  await waitFor(() => expect(screen.getByTestId("history-candidate-count")).toHaveTextContent(/^미확인$/));
  expect(screen.queryByText("현재 조회된 최종 후보가 없습니다.")).not.toBeInTheDocument();
});
const stored = { startedAt: "2026-10-09T09:00:00.000Z", finishedAt: "2026-10-09T09:01:05.000Z" };
it("combines the stored execution facts with the matching result card after a restart", async () => {
  const runId = "confirmed-result-run";
  backend(() => ({ status: "idle" }), [], { state: "not_produced" }, { marker: { state: "completed", mode: "model_only", kind: "adhoc", runId, ...stored } }, { asOf: stored.finishedAt }); mount();
  const card = await screen.findByRole("region", { name: "현재 분석 결과" });
  await waitFor(() => expect(within(card).getByTestId("history-saved-run")).toBeInTheDocument());
  expect(screen.queryByRole("region", { name: "마지막 분석" })).not.toBeInTheDocument();
  expect(within(card).getByTestId("history-candidate-count")).toHaveTextContent("199종목");
  fireEvent.click(within(card).getByText("분석 실행 정보"));
  expect(within(card).getByTestId("history-saved-elapsed")).toBeVisible();
  expect(within(card).getAllByText(runId)).toHaveLength(1);
  expect(within(card).getAllByText("공식 / 수시 구분")).toHaveLength(1);
  expect(screen.getByText("실측 성과는 실제 주문 손익이 아니며 미래 수익을 보장하지 않습니다.")).toBeVisible();
});
it.each(["missing timestamp", "sample source"])("keeps the marker separate for a result with %s", async scenario => {
  backend(() => ({ status: "idle" }), [], { state: "not_produced" }, { marker: { state: "completed", mode: "model_only", runId: "last-marker", ...stored } },
    { asOf: scenario === "missing timestamp" ? null : stored.finishedAt, source: scenario === "sample source" ? "sample" : "cache" }); mount();
  await screen.findByRole("region", { name: "마지막 분석" });
  const card = screen.getByRole("region", { name: "현재 분석 결과" });
  expect(within(card).queryByTestId("history-saved-run")).not.toBeInTheDocument();
  expect(within(card).queryByText("last-marker")).not.toBeInTheDocument();
  if (scenario === "sample source") expect(within(card).getByText("예시 데이터 · 실제 분석 결과가 아닙니다.")).toBeVisible();
});
it("keeps a failed marker's identity out of the previous completed result", async () => {
  const oldAsOf = "2026-10-07T09:00:00Z";
  backend(() => ({ status: "failed" }), [], { state: "not_produced" }, { marker: { state: "failed", mode: "model_only", kind: "official", runId: "new-failed-run", ...stored } }, { asOf: oldAsOf }); mount();
  const marker = await screen.findByRole("region", { name: "마지막 분석" });
  expect(within(marker).getByText("new-failed-run")).toBeInTheDocument();
  const card = screen.getByRole("region", { name: "현재 분석 결과" });
  expect(within(card).getByTestId("history-candidate-count")).toHaveTextContent("199종목");
  expect(within(card).queryByText("new-failed-run")).not.toBeInTheDocument();
  expect(within(card).queryByText("공식 / 수시 구분")).not.toBeInTheDocument();
  expect(within(card).queryByText("공식")).not.toBeInTheDocument();
});
it.each(["running", "failed"])("keeps the stored card separate during a %s runtime", async status => {
  backend(() => ({ status }), [], { state: "not_produced" }, { marker: { state: "completed", mode: "model_only", ...stored }, runtime: { state: status } }); mount();
  await screen.findByRole("region", { name: "마지막 분석" });
  expect(screen.getByRole("region", { name: "현재 분석 결과" })).toBeInTheDocument();
  expect(screen.queryByText("분석 실행 정보")).not.toBeInTheDocument();
});
it("keeps an older displayed result separate from the last completed marker", async () => {
  backend(() => ({ status: "idle" }), [pipelineRow()], { state: "available", count: 1 }, { marker: { state: "completed", mode: "full", ...stored } }); mount();
  await screen.findByRole("region", { name: "마지막 분석" });
  expect(screen.getByRole("region", { name: "현재 분석 결과" })).toBeInTheDocument();
});
it("maps a saved model-only universe while the restarted server is idle and folds the full run reference", async () => {
  const runId = "12345678-1234-1234-1234-123456789abc";
  backend(() => ({ status: "idle" }), [], { state: "not_produced" }, { marker: { state: "completed", mode: "model_only", ...stored, runId } });
  mount();
  await screen.findByText("모델 순위 종목 수");
  expect(screen.getByTestId("history-candidate-count")).toHaveTextContent("199종목");
  expect(screen.getByText(/상위 목록 5종목/)).toBeInTheDocument();
  expect(screen.queryByText("해당 없음 · 최종 후보 미생성")).not.toBeInTheDocument();
  expect(screen.getByTestId("history-status")).toHaveTextContent("실행 중인 분석 없음");
  expect(screen.queryByText("실행 기록 12345678")).not.toBeInTheDocument();
  expect(screen.getAllByText(runId)[0]).not.toBeVisible();
  expectReadableUserText(document.querySelector('.history-page')!);
});
it("shows the stored last run from the disk marker while the current runtime is idle", async () => {
  backend(() => ({ status: "idle" }), [], { state: "not_produced" }, { marker: { state: "completed", mode: "model_only", ...stored } }); mount();
  const card = await screen.findByTestId("history-saved-run");
  expect(screen.getByTestId("history-saved-status")).toHaveTextContent(/^완료$/);
  expect(screen.getByTestId("history-saved-mode")).toHaveTextContent("모델 분석");
  expect(screen.getByTestId("history-saved-elapsed")).toHaveTextContent("1분 5초");
  expect(screen.getByTestId("history-saved-rank")).toHaveTextContent("전체 순위 199종목");
  expect(card).not.toHaveTextContent("뉴스 보정 최종 후보는 생성되지 않았습니다");
  expect(card).not.toHaveTextContent("기록 번호 없음");
  expect(screen.getByTestId("history-status")).toHaveTextContent("실행 중인 분석 없음");
});
it("shows a stored failed run as failed, not as the current run", async () => {
  backend(() => ({ status: "idle" }), [], { state: "blocked" }, { marker: { state: "failed", mode: "full", ...stored } }); mount();
  await screen.findByTestId("history-saved-run");
  expect(screen.getByTestId("history-saved-status")).toHaveTextContent(/^실패$/);
  expect(screen.getByTestId("history-status")).toHaveTextContent("실행 중인 분석 없음");
});
it("does not repeat the saved facts when the current runtime is the same run", async () => {
  backend(() => ({ status: "idle" }), [], { state: "available", count: 5 }, { marker: { state: "completed", mode: "full", ...stored }, runtime: { state: "completed", ...stored } }); mount();
  expect(await screen.findByTestId("history-saved-same")).toBeInTheDocument();
  expect(screen.queryByTestId("history-saved-status")).not.toBeInTheDocument();
  expect(screen.getByTestId("history-saved-rank")).toBeInTheDocument();
});
it("never turns an inverted stored time range into a zero duration", async () => {
  backend(() => ({ status: "idle" }), [], { state: "empty", count: 0 }, { marker: { state: "completed", mode: "full", startedAt: stored.finishedAt, finishedAt: stored.startedAt } }); mount();
  await screen.findByTestId("history-saved-run");
  expect(screen.getByTestId("history-saved-elapsed")).toHaveTextContent(/^—$/);
});
it.each([["absent", { state: "absent" }], ["running", { state: "running", ...stored }], ["completed without times", { state: "completed" }], ["invalid", { state: "invalid" }]])("shows no stored run for a %s marker", async (_name, marker) => {
  backend(() => ({ status: "idle" }), [], { state: "empty", count: 0 }, { marker }); mount();
  await screen.findByText("실행 중인 분석 없음");
  await waitFor(() => expect(screen.getByTestId("history-candidate-count")).toHaveTextContent("0개"));
  expect(screen.queryByTestId("history-saved-run")).not.toBeInTheDocument();
});
it("formats measured durations but never guesses a timestamp unit", () => {
  expect(elapsedLabel(0)).toBe("0초");
  expect(elapsedLabel(1)).toBe("0.001초");
  expect(elapsedLabel(61200)).toBe("1분 1.2초");
  expect(elapsedLabel(null)).toBe("—");
  expect(elapsedLabel(-1)).toBe("—");
  expect(progressUpdatedLabel(1791354000000)).not.toBe("미확인");
  expect(progressUpdatedLabel(0)).toBe("미확인");
  expect(progressUpdatedLabel(NaN)).toBe("미확인");
  expect(progressUpdatedLabel("2026-10-07T09:00:00Z")).not.toBe("미확인");
  expect(progressUpdatedLabel("2026-02-30T09:00:00Z")).toBe("미확인");
});
it("shows a failed run independently of saved candidates and refreshes with GET", async () => {
  let failed = true;
  const fetcher = backend(() => ({ status: failed ? "failed" : "idle", elapsedMs: null, error: failed ? "원본 오류" : null }), [pipelineRow()]); mount();
  await screen.findByText("최신 실행 실패"); expect(screen.getByText("원본 오류")).toBeInTheDocument();
  expect(screen.getByTestId("history-candidate-count")).toHaveTextContent("1개");
  failed = false; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
  await screen.findByText("실행 중인 분석 없음");
  expect(screen.queryByText("원본 오류")).not.toBeInTheDocument();
  expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(4);
  expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
});
it("hides supply progress and errors while preserving unrelated messages after refresh", async () => {
  let hidden = true;
  const fetcher = backend(() => ({ status: "failed", progress: { message: hidden ? "외국인·기관 수급 조회 중" : "전문기관 연구 결과 확인 중" }, error: hidden ? "기관 순매수 조회 실패" : "원본 오류" }));
  mount(); await screen.findByText("최신 실행 실패");
  expect(screen.getByText("분석 데이터 처리 중")).toBeInTheDocument();
  expect(screen.getByText("분석 기록을 확인해 주세요.")).toBeInTheDocument();
  expect(document.querySelector(".history-facts")).not.toHaveTextContent(/수급|순매수/);
  hidden = false; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
  expect(await screen.findByText("전문기관 연구 결과 확인 중")).toBeInTheDocument();
  expect(screen.getByText("원본 오류")).toBeInTheDocument();
  expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
});
it("reports an unavailable status without inventing a completed record and recovers", async () => {
  let broken = true;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async url => {
    if (String(url) === "/api/candidates") return jsonResponse([]);
    return broken ? new Response(JSON.stringify({ error: "offline" }), { status: 502, headers: { "content-type": "application/json" } }) : jsonResponse({ status: "running", elapsedMs: 1200, progress: { message: "진행 중" } });
  }));
  mount(); await screen.findByText("실행 상태 조회 실패 · 다시 조회해 주세요.");
  expect(screen.getByTestId("history-status")).toHaveTextContent("상태 미확인");
  broken = false; fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
  await screen.findByText("분석 진행 중");
  await waitFor(() => expect(screen.getByText("진행 중인 동안 5초마다 상태를 확인합니다.")).toBeInTheDocument());
});
it("does not show zero candidates when the current result could not be retrieved", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async url => String(url) === "/api/candidates/run" ? jsonResponse({ status: "idle" }) : new Response("{}", { status: 502, headers: { "content-type": "application/json" } })));
  mount(); await screen.findByText("현재 결과 조회 실패");
  expect(screen.getByTestId("history-candidate-count")).toHaveTextContent(/^—$/);
});
