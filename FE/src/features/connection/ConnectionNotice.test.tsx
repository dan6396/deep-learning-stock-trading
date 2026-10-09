import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionNotice } from "./ConnectionNotice";
import { backendStatusBody, jsonResponse } from "../../test/dataFixtures";
import { queryKeys } from "../../shared/api/queries";
import { formatDate } from "../../shared/lib/format";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function mount(response: () => Promise<Response> = async () => jsonResponse(backendStatusBody())) {
  vi.stubGlobal("fetch", vi.fn(response));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><ConnectionNotice /></QueryClientProvider>);
  return client;
}
describe("compact connection status", () => {
  it("starts collapsed without claiming that configuration verifies a quote, and can be expanded", async () => {
    mount();
    await screen.findByText(/모델 결과 저장됨 · 저장 시각/);
    expect(document.querySelector(".connection-disclosure")).not.toHaveAttribute("open");
    fireEvent.click(document.querySelector(".connection-notice-heading")!);
    await waitFor(() => expect(document.querySelector(".connection-disclosure")).toHaveAttribute("open"));
    expect(screen.getByRole("button", { name: "연결 상태 다시 확인" })).toBeVisible();
    expect(screen.getByText(/이 상태 API는 키 설정 유무만 확인/)).toBeVisible();
  });
  it("automatically exposes a failed status request and offers a read-only retry", async () => {
    mount(async () => new Response("{}", { status: 502 }));
    await screen.findByText("확인 필요");
    await waitFor(() => expect(document.querySelector(".connection-disclosure")).toHaveAttribute("open"));
    expect(screen.getByRole("status")).toHaveTextContent("연결 상태 미확인");
    expect(screen.getByRole("button", { name: "연결 상태 다시 확인" })).toBeVisible();
  });
  it("opens when a previously healthy connection reports a failed run", async () => {
    const client = mount();
    await screen.findByText(/모델 결과 저장됨 · 저장 시각/);
    expect(document.querySelector(".connection-disclosure")).not.toHaveAttribute("open");
    const failure = backendStatusBody({ state: "blocked" }, { marker: { state: "failed" } });
    client.setQueryData(queryKeys.backendStatus(), failure);
    await waitFor(() => expect(document.querySelector(".connection-disclosure")).toHaveAttribute("open"));
    expect(screen.getByText(/최근 저장된 분석 실패/)).toBeVisible();
  });
  it("keeps available model-only results neutral even without market key configuration", async () => {
    const body = backendStatusBody({ state: "not_produced" });
    body.market.configuration = "not_configured";
    const savedAt = "2026-10-09T12:33:37.171Z";
    mount(async () => jsonResponse({ ...body, results: { ...body.results, rank: { ...body.results.rank, asOf: savedAt } } }));
    await screen.findByText(`모델 결과 저장됨 · 저장 시각 ${formatDate(savedAt, true)}`);
    expect(document.querySelector(".connection-disclosure")).not.toHaveAttribute("open");
    expect(screen.queryByText("키 설정 확인 · 접속 별도 확인")).not.toBeInTheDocument();
    expect(document.querySelector(".connection-notice-heading")).not.toHaveTextContent("검증됨");
  });
  it.each(["missing", "empty", "invalid", "stale", "sample", "unknown"])("opens when model results are %s", async state => {
    const body = backendStatusBody({ state: "not_produced" }); body.results.rank.state = state;
    mount(async () => jsonResponse(body));
    await screen.findByText("확인 필요");
    await waitFor(() => expect(document.querySelector(".connection-disclosure")).toHaveAttribute("open"));
  });
});
