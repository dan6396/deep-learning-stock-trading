import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DetailPanel, mergeCandidateDetail } from "./DetailPanel";
import { adaptCandidate, type CandidateData } from "../../entities/candidate";
import { jsonResponse, pipelineRow } from "../../test/dataFixtures";

describe("DetailPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const path = String(url);
        if (path.includes("/quote")) {
          return jsonResponse({
            code: "005930",
            currentPrice: 70000,
            changeRate: 0.01,
            source: "cache",
            asOf: "2026-10-07T09:00:00Z",
          });
        }
        if (path.includes("/stock-chart")) {
          return jsonResponse({
            code: "005930",
            source: "cache",
            asOf: "2026-10-07T09:00:00Z",
            data: { prices: [] },
          });
        }
        if (path.includes("/next-session")) {
          return jsonResponse({ nextSession: null });
        }
        return jsonResponse({});
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderPanel(candidate?: CandidateData) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <DetailPanel
            code="005930"
            candidate={candidate}
            membership="candidate"
            production="unproduced"
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("renders rank summary and does not render evidenceSummary when rank and poolSize are both present", () => {
    const candidate: CandidateData = {
      ...adaptCandidate(pipelineRow()).data,
      code: "005930",
      name: "삼성전자",
      rank: 1,
      poolSize: 199,
    };

    const { container } = renderPanel(candidate);

    const rankElement = container.querySelector(".briefing-detail-rank");
    expect(rankElement).not.toBeNull();
    expect(rankElement).toHaveTextContent("모델 순위 1위 / 199");

    expect(container.querySelector(".briefing-template-summary")).toBeNull();
    expect(screen.queryByText(/199종목 중/)).not.toBeInTheDocument();
  });

  it("does not render rank summary and renders evidenceSummary when rank is null", () => {
    const candidate: CandidateData = {
      ...adaptCandidate(pipelineRow()).data,
      code: "005930",
      name: "삼성전자",
      rank: null,
      poolSize: 199,
    };

    const { container } = renderPanel(candidate);

    expect(container.querySelector(".briefing-detail-rank")).toBeNull();
    const summary = container.querySelector(".briefing-template-summary");
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("모델 원본 순위 미제공");
  });

  it("does not render rank summary and renders evidenceSummary when poolSize is null", () => {
    const candidate: CandidateData = {
      ...adaptCandidate(pipelineRow()).data,
      code: "005930",
      name: "삼성전자",
      rank: 2,
      poolSize: null,
    };

    const { container } = renderPanel(candidate);

    expect(container.querySelector(".briefing-detail-rank")).toBeNull();
    const summary = container.querySelector(".briefing-template-summary");
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("모델 순위 —종목 중 2위");
  });

  it("renders fallback summary when candidate is not provided", () => {
    const { container } = renderPanel(undefined);

    expect(container.querySelector(".briefing-detail-rank")).toBeNull();
    const summary = container.querySelector(".briefing-template-summary");
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("분석 근거가 없습니다.");
  });

  describe("mergeCandidateDetail", () => {
    it("returns detail when candidate is undefined", () => {
      const detail = { ...adaptCandidate(pipelineRow()).data, code: "005930" };
      expect(mergeCandidateDetail(undefined, detail)).toBe(detail);
      expect(mergeCandidateDetail(undefined, null)).toBeNull();
    });

    it("returns candidate when detail is null or code does not match", () => {
      const candidate = { ...adaptCandidate(pipelineRow()).data, code: "005930" };
      expect(mergeCandidateDetail(candidate, null)).toBe(candidate);
      const detailOther = { ...adaptCandidate(pipelineRow()).data, code: "000660" };
      expect(mergeCandidateDetail(candidate, detailOther)).toBe(candidate);
    });

    it("merges candidate rank fields into detail", () => {
      const candidate = { ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 1, poolSize: 199 };
      const detail = { ...adaptCandidate(pipelineRow()).data, code: "005930", rank: 10, poolSize: 50 };
      const merged = mergeCandidateDetail(candidate, detail);
      expect(merged?.rank).toBe(1);
      expect(merged?.poolSize).toBe(199);
      expect(merged?.isFinalCandidate).toBe(true);
    });
  });
});
