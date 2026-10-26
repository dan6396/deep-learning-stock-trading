import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow } from "../../test/dataFixtures";
import { ModelTopFiveList, modelTopFive, predictionPeriod, RelatedArticles } from "./ModelTopFiveTable";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { jsonResponse } from "../../test/dataFixtures";
import { chartBundle } from "../../test/fixtures/reportFixtures";

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

    const quoteCalls = () => fetcher.mock.calls.filter(([url]) => String(url).includes("/api/korean-market/quote"));
    const chartCalls = () => fetcher.mock.calls.filter(([url]) => String(url).includes("/api/korean-market/stock-chart"));

    // 초기 시세 및 추세선 요청이 행마다 발생 확인 (상세 패널과 동일한 stock-chart 엔드포인트 키 사용)
    await waitFor(() => expect(quoteCalls()).toHaveLength(3));
    await waitFor(() => expect(chartCalls()).toHaveLength(3));

    act(() => buttons[1].focus());
    fireEvent.keyDown(buttons[1], { key: "ArrowDown" }); expect(buttons[2]).toHaveFocus();
    fireEvent.keyDown(buttons[2], { key: "Home" }); expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "ArrowUp" }); expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "End" }); expect(buttons[2]).toHaveFocus();
    fireEvent.keyDown(buttons[2], { key: "ArrowUp" }); expect(buttons[1]).toHaveFocus();
    expect(buttons.filter(button => button.tabIndex === 0)).toHaveLength(1);

    // 포커스 이동만으로는 상세·선택 관련 요청(quote/chart)이 늘지 않음
    expect(onSelect).not.toHaveBeenCalled();
    expect(quoteCalls()).toHaveLength(3);
    expect(chartCalls()).toHaveLength(3);

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

  it("formats rank score with 2 decimal places and enforces 6% minimum bar fill on minimum row", () => {
    const client = new QueryClient();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({})));
    const rows = [
      { ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 1, rankScore: 1.529, scoreKind: "rank_zscore" as const },
      { ...adaptCandidate(pipelineRow()).data, code: "000660", rank: 2, rankScore: 0.812, scoreKind: "rank_zscore" as const },
    ];
    const { container } = render(
      <QueryClientProvider client={client}>
        <ModelTopFiveList rows={rows} selectedCode={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );

    // 2자리 소수점 확인 (1.5290 대신 1.53)
    expect(screen.getByText("1.53")).toBeInTheDocument();
    expect(screen.getByText("0.81")).toBeInTheDocument();

    // 중립 막대 존재 및 최솟값 행의 6% 하한 스타일 검증
    const bars = container.querySelectorAll(".briefing-top-score-bar");
    expect(bars.length).toBe(2);
    expect(bars[0]).toHaveAttribute("title", expect.stringContaining("100%"));
    expect(bars[1]).toHaveAttribute("title", expect.stringContaining("0%"));

    const fills = container.querySelectorAll(".briefing-top-score-bar-fill");
    expect(fills[0]).toHaveStyle({ width: "100%" });
    expect(fills[1]).toHaveStyle({ width: "6%" }); // 0%라도 최소 6% 하한 적용

    client.clear();
  });

  it("handles identical scores and single score row properly", () => {
    const client = new QueryClient();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({})));

    // 1) 점수가 모두 같을 때
    const equalRows = [
      { ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 1, rankScore: 1.5, scoreKind: "rank_zscore" as const },
      { ...adaptCandidate(pipelineRow()).data, code: "000660", rank: 2, rankScore: 1.5, scoreKind: "rank_zscore" as const },
    ];
    const { container, rerender } = render(
      <QueryClientProvider client={client}>
        <ModelTopFiveList rows={equalRows} selectedCode={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    const equalFills = container.querySelectorAll(".briefing-top-score-bar-fill");
    expect(equalFills[0]).toHaveStyle({ width: "100%" });
    expect(equalFills[1]).toHaveStyle({ width: "100%" });

    // 2) 점수가 1개일 때
    const singleRow = [
      { ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 1, rankScore: 1.5, scoreKind: "rank_zscore" as const },
    ];
    rerender(
      <QueryClientProvider client={client}>
        <ModelTopFiveList rows={singleRow} selectedCode={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    const singleFill = container.querySelector(".briefing-top-score-bar-fill");
    expect(singleFill).toHaveStyle({ width: "100%" });

    client.clear();
  });

  it("handles changeRate variants: positive, negative, zero (flat), and null", async () => {
    const client = new QueryClient();

    // 1) 양수 (+2.13%) -> is-rise
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("quote")) return jsonResponse({ source: "live", code: "005930", currentPrice: 72000, changeRate: 2.13 });
      return jsonResponse({});
    }));
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ModelTopFiveList rows={[{ ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 1 }]} selectedCode={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByText("+2.13%")).toHaveClass("is-rise");
    });

    // 2) 음수 (-1.50%) -> is-fall
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("quote")) return jsonResponse({ source: "live", code: "005930", currentPrice: 70000, changeRate: -1.5 });
      return jsonResponse({});
    }));
    client.clear();
    rerender(
      <QueryClientProvider client={client}>
        <ModelTopFiveList rows={[{ ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 1 }]} selectedCode={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByText("-1.50%")).toHaveClass("is-fall");
    });

    // 3) 보합 0.00% -> is-flat (반올림 표시값 기준)
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("quote")) return jsonResponse({ source: "live", code: "005930", currentPrice: 71000, changeRate: 0.001 }); // 반올림 0.00%
      return jsonResponse({});
    }));
    client.clear();
    rerender(
      <QueryClientProvider client={client}>
        <ModelTopFiveList rows={[{ ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 1 }]} selectedCode={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByText("0.00%")).toHaveClass("is-flat");
    });

    // 4) changeRate가 null일 때 -> 등락률 미표시
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("quote")) return jsonResponse({ source: "live", code: "005930", currentPrice: 71000, changeRate: null });
      return jsonResponse({});
    }));
    client.clear();
    rerender(
      <QueryClientProvider client={client}>
        <ModelTopFiveList rows={[{ ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 1 }]} selectedCode={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByText("71,000원")).toBeInTheDocument();
      expect(screen.queryByText(/%/)).toBeNull();
    });

    client.clear();
  });

  describe("sequential chart query activation (cold state protection)", () => {
    it("ensures at most 1 in-flight chart request, prioritizes selectedCode, and advances on failure", async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const rows = ["005930", "000660", "035420"].map(code => ({
        ...adaptCandidate(pipelineRow()).data,
        code,
        rank: code === "005930" ? 1 : code === "000660" ? 2 : 3,
      }));

      let inFlightChartCalls = 0;
      let maxInFlightChartCalls = 0;
      const chartCallOrder: string[] = [];
      const resolvers = new Map<string, (resp: Response) => void>();

      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("/quote")) {
          return jsonResponse({ source: "live", code: "005930", currentPrice: 50000 });
        }
        if (u.includes("/stock-chart")) {
          const match = u.match(/symbol=(\d+)/);
          const code = match ? match[1] : "";
          chartCallOrder.push(code);
          inFlightChartCalls++;
          maxInFlightChartCalls = Math.max(maxInFlightChartCalls, inFlightChartCalls);

          return new Promise<Response>((resolve) => {
            resolvers.set(code, resolve);
          }).finally(() => {
            inFlightChartCalls--;
          });
        }
        return jsonResponse({});
      }));

      // 2위(000660)를 선택된 종목으로 전달
      render(
        <QueryClientProvider client={client}>
          <ModelTopFiveList rows={rows} selectedCode="000660" onSelect={vi.fn()} />
        </QueryClientProvider>
      );

      // 1. 선택 종목("000660")이 가장 먼저 요청되어야 함
      await waitFor(() => {
        expect(chartCallOrder).toEqual(["000660"]);
      });
      expect(maxInFlightChartCalls).toBe(1);

      // 2. 000660의 요청을 에러(502)로 실패 완료시킴 -> 앞 요청이 실패해도 다음 요청이 진행되어야 함!
      act(() => {
        resolvers.get("000660")?.(new Response("{}", { status: 502 }));
      });

      // 3. 000660 완료 후 남은 순서의 첫 번째(005930)가 활성화됨
      await waitFor(() => {
        expect(chartCallOrder).toEqual(["000660", "005930"]);
      });
      // 동시에 진행 중인 요청은 여전히 최대 1개!
      expect(maxInFlightChartCalls).toBe(1);

      // 4. 005930 성공 완료
      act(() => {
        resolvers.get("005930")?.(jsonResponse(chartBundle("005930", "live")));
      });

      // 5. 005930 완료 후 035420 활성화됨
      await waitFor(() => {
        expect(chartCallOrder).toEqual(["000660", "005930", "035420"]);
      });
      expect(maxInFlightChartCalls).toBe(1);

      act(() => {
        resolvers.get("035420")?.(jsonResponse(chartBundle("035420", "live")));
      });

      client.clear();
    });

    it("immediately activates rows with existing cache without waiting for sequence", async () => {
      const client = new QueryClient();
      const rows = ["005930", "000660"].map(code => ({
        ...adaptCandidate(pipelineRow()).data,
        code,
        rank: code === "005930" ? 1 : 2,
      }));

      // 000660의 차트 데이터를 미리 캐시에 채워둠
      const preloadedBundle = chartBundle("000660", "live");
      client.setQueryData(["chart", "000660", "1M"], {
        source: "live",
        asOf: "2026-10-07T09:00:00Z",
        data: {
          code: "000660",
          range: "1M",
          prices: [
            { date: "2026-09-25", price: 50000, timestamp: 1000, rawTimeVerified: true },
            { date: "2026-10-25", price: 55000, timestamp: 2000, rawTimeVerified: true },
          ],
          coverage: { requestedRange: "1M", sourceRange: "1M", method: "requested", status: "unverified" },
          candles: [],
        },
      });

      const chartCalls: string[] = [];
      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("/stock-chart")) {
          const match = u.match(/symbol=(\d+)/);
          if (match) chartCalls.push(match[1]);
          return new Promise(() => {}); // 005930 요청은 아직 대기 중
        }
        return jsonResponse({});
      }));

      const { container } = render(
        <QueryClientProvider client={client}>
          <ModelTopFiveList rows={rows} selectedCode="005930" onSelect={vi.fn()} />
        </QueryClientProvider>
      );

      // 005930은 콜드로 요청 진행 중
      await waitFor(() => {
        expect(chartCalls).toEqual(["005930"]);
      });

      // 캐시가 있던 000660은 005930이 끝나기를 기다리지 않고 즉시 svg sparkline을 그림!
      const sparkline000660 = container.querySelector('[data-model-code="000660"] .briefing-sparkline');
      expect(sparkline000660).not.toBeNull();

      client.clear();
    });

    it("reproduction (a): skips cached row C and proceeds to D without permanent stop", async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const codes = ["005930", "000660", "035420", "005380"]; // A, B, C, D
      const rows = codes.map((code, index) => ({
        ...adaptCandidate(pipelineRow()).data,
        code,
        rank: index + 1,
      }));

      // C("035420")에만 캐시 사전 주입
      client.setQueryData(["chart", "035420", "1M"], {
        source: "live",
        asOf: "2026-10-07T09:00:00Z",
        data: {
          code: "035420",
          range: "1M",
          prices: [
            { date: "2026-09-25", price: 100000, timestamp: 1000, rawDate: "2026-09-25", rawTimeVerified: true },
            { date: "2026-10-25", price: 110000, timestamp: 2000, rawDate: "2026-10-25", rawTimeVerified: true },
          ],
          coverage: { requestedRange: "1M", sourceRange: "1M", method: "requested", status: "unverified" },
          candles: [],
        },
      });

      const chartCallOrder: string[] = [];
      const resolvers = new Map<string, (resp: Response) => void>();

      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("/stock-chart")) {
          const match = u.match(/symbol=(\d+)/);
          const code = match ? match[1] : "";
          chartCallOrder.push(code);
          return new Promise<Response>((resolve) => {
            resolvers.set(code, resolve);
          });
        }
        return jsonResponse({});
      }));

      const { container } = render(
        <QueryClientProvider client={client}>
          <ModelTopFiveList rows={rows} selectedCode="005930" onSelect={vi.fn()} />
        </QueryClientProvider>
      );

      // C는 캐시가 있으므로 즉시 svg가 렌더링됨
      expect(container.querySelector('[data-model-code="035420"] .briefing-sparkline')).not.toBeNull();

      // 1. 선택 종목 A("005930") 요청
      await waitFor(() => {
        expect(chartCallOrder).toEqual(["005930"]);
      });

      // 2. A 완료 -> B("000660") 요청
      act(() => {
        resolvers.get("005930")?.(jsonResponse(chartBundle("005930", "live")));
      });
      await waitFor(() => {
        expect(chartCallOrder).toEqual(["005930", "000660"]);
      });

      // 3. B 완료 -> C("035420")는 이미 캐시가 있으므로 건너뛰고 D("005380") 요청!
      act(() => {
        resolvers.get("000660")?.(jsonResponse(chartBundle("000660", "live")));
      });
      await waitFor(() => {
        expect(chartCallOrder).toEqual(["005930", "000660", "005380"]);
      });

      // 4. D 완료
      act(() => {
        resolvers.get("005380")?.(jsonResponse(chartBundle("005380", "live")));
      });

      // 체인이 영구 정지하지 않고 D까지 완료됨 (C는 네트워크 호출 없음)
      expect(chartCallOrder).not.toContain("035420");

      client.clear();
    });

    it("reproduction (b): resets priority on selection change during cold loading and completes all rows", async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const codes = ["005930", "000660", "035420"]; // A, B, C
      const rows = codes.map((code, index) => ({
        ...adaptCandidate(pipelineRow()).data,
        code,
        rank: index + 1,
      }));

      const chartCallOrder: string[] = [];
      const resolvers = new Map<string, (resp: Response) => void>();

      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("/stock-chart")) {
          const match = u.match(/symbol=(\d+)/);
          const code = match ? match[1] : "";
          chartCallOrder.push(code);
          return new Promise<Response>((resolve) => {
            resolvers.set(code, resolve);
          });
        }
        return jsonResponse({});
      }));

      // A 선택 상태로 렌더링
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <ModelTopFiveList rows={rows} selectedCode="005930" onSelect={vi.fn()} />
        </QueryClientProvider>
      );

      // A가 in-flight 상태
      await waitFor(() => {
        expect(chartCallOrder).toEqual(["005930"]);
      });

      // 로딩 중 사용자가 B("000660")를 클릭하여 선택 변경
      rerender(
        <QueryClientProvider client={client}>
          <ModelTopFiveList rows={rows} selectedCode="000660" onSelect={vi.fn()} />
        </QueryClientProvider>
      );

      // B가 최우선순위로 요청됨
      await waitFor(() => {
        expect(chartCallOrder).toContain("000660");
      });

      // 이전 A 요청 resolve
      act(() => {
        resolvers.get("005930")?.(jsonResponse(chartBundle("005930", "live")));
      });

      // B 요청 resolve
      act(() => {
        resolvers.get("000660")?.(jsonResponse(chartBundle("000660", "live")));
      });

      // 남은 C("035420")가 멈추지 않고 순차적으로 요청되어 완료됨
      await waitFor(() => {
        expect(chartCallOrder).toEqual(expect.arrayContaining(["005930", "000660", "035420"]));
      });

      act(() => {
        resolvers.get("035420")?.(jsonResponse(chartBundle("035420", "live")));
      });

      client.clear();
    });

    it("prevents request surge when rows update to new analysis results", async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const oldRows = ["005930", "000660"].map((code, index) => ({
        ...adaptCandidate(pipelineRow()).data,
        code,
        rank: index + 1,
      }));
      const newRows = ["035420", "005380", "035720"].map((code, index) => ({
        ...adaptCandidate(pipelineRow()).data,
        code,
        rank: index + 1,
      }));

      let inFlightChartCalls = 0;
      let maxInFlightChartCalls = 0;
      const chartCalls: string[] = [];

      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("/stock-chart")) {
          const match = u.match(/symbol=(\d+)/);
          const code = match ? match[1] : "";
          chartCalls.push(code);
          inFlightChartCalls++;
          maxInFlightChartCalls = Math.max(maxInFlightChartCalls, inFlightChartCalls);
          return new Promise(() => {}); // 진행 중 유지
        }
        return jsonResponse({});
      }));

      const { rerender } = render(
        <QueryClientProvider client={client}>
          <ModelTopFiveList rows={oldRows} selectedCode="005930" onSelect={vi.fn()} />
        </QueryClientProvider>
      );

      await waitFor(() => expect(chartCalls).toEqual(["005930"]));
      expect(maxInFlightChartCalls).toBe(1);

      // 새 분석 결과(newRows)로 교체
      rerender(
        <QueryClientProvider client={client}>
          <ModelTopFiveList rows={newRows} selectedCode="035420" onSelect={vi.fn()} />
        </QueryClientProvider>
      );

      // 새 목록에서도 한 번에 1개씩(최우선 035420)만 활성화되어 폭증하지 않음
      await waitFor(() => {
        expect(chartCalls).toContain("035420");
      });
      // 035420 외 다른 새 종목(005380, 035720)은 아직 호출되지 않음
      expect(chartCalls).not.toContain("005380");
      expect(chartCalls).not.toContain("035720");

      client.clear();
    });
  });
});
