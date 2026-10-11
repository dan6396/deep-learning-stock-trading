import { describe, expect, it } from "vitest";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow } from "../../test/dataFixtures";
import { modelTopFive, predictionPeriod, RelatedArticles } from "./ModelTopFiveTable";
import { render, screen } from "@testing-library/react";

describe("original model Top-5 selection", () => {
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
