import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow } from "../../test/dataFixtures";
import { ModelTopFiveList, modelTopFive, predictionPeriod, RelatedArticles } from "./ModelTopFiveTable";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { jsonResponse } from "../../test/dataFixtures";

afterEach(() => vi.unstubAllGlobals());

describe("original model Top-5 selection", () => {
  it("uses the visible fallback name in the accessible label when a name is missing", () => {
    const client = new QueryClient(), row = { ...adaptCandidate(pipelineRow()).data, code: "005930", name: null, baseDate: null };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({})));
    const view = render(<QueryClientProvider client={client}><ModelTopFiveList rows={[row]} selectedCode={row.code} onSelect={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "종목명 미확인 005930 상세 보기" })).toHaveTextContent("종목명 미확인");
    expect(screen.queryByRole("button", { name: /null/ })).not.toBeInTheDocument();
    view.unmount(); client.clear();
  });
  it("moves focus without selection or further requests, and activates only explicitly", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({})); vi.stubGlobal("fetch", fetcher);
    const rows = ["005930", "000660", "035420"].map((code, index) => ({ ...adaptCandidate(pipelineRow()).data, code, name: `stock ${index}`, baseDate: null }));
    const onSelect = vi.fn();
    const view = render(<QueryClientProvider client={client}><ModelTopFiveList rows={rows} selectedCode="000660" onSelect={onSelect} /></QueryClientProvider>);
    const buttons = rows.map(row => screen.getByRole("button", { name: `${row.name} ${row.code} 상세 보기` }));
    expect(buttons.map(button => button.tabIndex)).toEqual([-1, 0, -1]);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    act(() => buttons[1].focus());
    fireEvent.keyDown(buttons[1], { key: "ArrowDown" }); expect(buttons[2]).toHaveFocus();
    fireEvent.keyDown(buttons[2], { key: "Home" }); expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "ArrowUp" }); expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "End" }); expect(buttons[2]).toHaveFocus();
    fireEvent.keyDown(buttons[2], { key: "ArrowUp" }); expect(buttons[1]).toHaveFocus();
    expect(buttons.filter(button => button.tabIndex === 0)).toHaveLength(1);
    expect(onSelect).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(buttons[1], { key: "Enter" }); expect(onSelect).toHaveBeenLastCalledWith("000660", "keyboard");
    fireEvent.keyDown(buttons[2], { key: " " }); expect(onSelect).toHaveBeenLastCalledWith("035420", "keyboard");
    fireEvent.click(buttons[0], { detail: 1 }); expect(onSelect).toHaveBeenLastCalledWith("005930");
    view.unmount(); client.clear();
  });
  it("renders evidence by code and retains related articles only for rows without evidence", () => {
    const client = new QueryClient();
    const rows = ["005930", "000660"].map(code => ({ ...adaptCandidate(pipelineRow()).data, code, name: code, baseDate: null }));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({})));
    const onSelect = vi.fn();
    const evidence = (code: string) => code === "000660" ? <div data-testid="evidence-body">근거 본문<button type="button">자세히</button></div> : null;
    const view = render(<QueryClientProvider client={client}><ModelTopFiveList rows={rows} selectedCode="005930" onSelect={onSelect} renderEvidence={evidence} /></QueryClientProvider>);
    const first = view.container.querySelector('[data-model-code="005930"]')!;
    const second = view.container.querySelector('[data-model-code="000660"]')!;
    expect(first.querySelector(".briefing-related-news")).not.toBeNull();
    expect(second.querySelector(".briefing-related-news")).toBeNull();
    expect(second.contains(screen.getByTestId("evidence-body"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "자세히" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".briefing-stock-button")].map(button => button.tabIndex)).toEqual([0, -1]);
    view.rerender(<QueryClientProvider client={client}><ModelTopFiveList rows={rows} selectedCode="005930" onSelect={onSelect} /></QueryClientProvider>);
    expect(view.container.querySelectorAll(".briefing-related-news")).toHaveLength(2);
    expect(screen.queryByTestId("evidence-body")).not.toBeInTheDocument();
    view.unmount(); client.clear();
  });
  it("uses the first selection tab stop when no row is selected", () => {
    const client = new QueryClient(), rows = ["005930", "000660"].map(code => ({ ...adaptCandidate(pipelineRow()).data, code, baseDate: null }));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({})));
    const view = render(<QueryClientProvider client={client}><ModelTopFiveList rows={rows} selectedCode={null} onSelect={vi.fn()} /></QueryClientProvider>);
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".briefing-stock-button")].map(button => button.tabIndex)).toEqual([0, -1]);
    view.unmount(); client.clear();
  });
  it.each([null, "close_to_close"])("does not claim a target for %s", predictionTarget => {
    expect(predictionPeriod({ ...adaptCandidate(pipelineRow()).data, predictionTarget })).toBe("예측 기간 미확인");
  });
  it("shows only safe related links with publisher and Korean-time timestamp", () => {
    const candidate = adaptCandidate(pipelineRow()).data;
    candidate.name = "삼성전자";
    candidate.news = [
      { title: "삼성전자는 실적 발표", url: "https://example.com/real", source: "테스트일보", publishedAt: "2026-10-10T10:30:00Z", sentiment: null },
      { title: "삼성전자서비스 실적", url: "https://example.com/peer", source: "다른일보", publishedAt: null, sentiment: null },
      { title: "삼성전자 실적", url: "javascript:alert(1)", source: "위험", publishedAt: null, sentiment: null },
    ];
    render(<RelatedArticles candidate={candidate} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/real");
    expect(screen.getByText(/테스트일보/)).toHaveTextContent("19:30");
    expect(screen.queryByRole("group")).toBeNull();
  });
  it("folds additional related articles into a details disclosure when multiple articles exist", () => {
    const candidate = adaptCandidate(pipelineRow()).data;
    candidate.name = "삼성전자";
    candidate.news = [
      { title: "삼성전자 1번 기사", url: "https://example.com/1", source: "언론사1", publishedAt: null, sentiment: null },
      { title: "삼성전자 2번 기사", url: "https://example.com/2", source: "언론사2", publishedAt: null, sentiment: null },
      { title: "삼성전자 3번 기사", url: "https://example.com/3", source: "언론사3", publishedAt: null, sentiment: null },
    ];
    const { container, rerender } = render(<RelatedArticles candidate={candidate} />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    const firstArticle = screen.getByText("삼성전자 1번 기사");
    expect(details?.contains(firstArticle)).toBe(false);
    const secondArticle = screen.getByText("삼성전자 2번 기사");
    const thirdArticle = screen.getByText("삼성전자 3번 기사");
    expect(details?.contains(secondArticle)).toBe(true);
    expect(details?.contains(thirdArticle)).toBe(true);
    expect(screen.getByText("기사 2건 더 보기")).toBeInTheDocument();

    const twoArticles = { ...candidate, news: candidate.news.slice(0, 2) };
    rerender(<RelatedArticles candidate={twoArticles} />);
    expect(screen.getByText("기사 1건 더 보기")).toBeInTheDocument();

    const oneArticle = { ...candidate, news: candidate.news.slice(0, 1) };
    rerender(<RelatedArticles candidate={oneArticle} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("삼성전자 1번 기사")).toBeInTheDocument();
  });
  it.each([["collection_failed", false, "기사 수집 실패"], ["collected", true, "관련 기사 0건"], ["not_collected", false, "기사 수집 기록 없음"]] as const)("distinguishes %s from successful zero", (newsStatus, newsCollected, expected) => {
    render(<RelatedArticles candidate={{ ...adaptCandidate(pipelineRow()).data, newsStatus, newsCollected }} />);
    expect(screen.getByRole("status")).toHaveTextContent(expected);
  });
  it("excludes absent and invalid ranks without renumbering, fabricating predictions or mutating the input", () => {
    const ranks = [42, null, 17, 6, 29, 8, 11, 0, -1, 1.5, NaN];
    const rows = ranks.map((rank, index) => ({ ...adaptCandidate(pipelineRow()).data, code: String(100001 + index), rank, predictedReturn: index === 3 ? null : index === 5 ? 0 : -.01, finalRank: index + 1 }));
    const before = rows.map(row => row.rank), top = modelTopFive(rows);
    expect(top.map(row => row.rank)).toEqual([6, 8, 11, 17, 29]);
    expect(top[0].predictedReturn).toBeNull(); expect(top[1].predictedReturn).toBe(0);
    expect(rows.map(row => row.rank)).toEqual(before);
    expect(modelTopFive([])).toEqual([]);
  });
});
