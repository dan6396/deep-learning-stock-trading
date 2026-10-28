import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockNewsSummary } from "./StockNewsCard";
import type { StockInsight } from "../../types/stockInsight";
describe("news summary provenance", () => {
  it.each(["llm", "template", undefined] as const)("uses independent source and basis labels for %s", source => {
    const news: StockInsight["news"] = { source: source ?? "template", summarySource: source, summaryBasis: "body", bodyCollected: true, summary: "기사가 보도한 서비스 개편 내용을 확인했습니다.", limitation: "", articles: [], citations: [] };
    const { rerender } = render(<StockNewsSummary news={news} targets={new Map()} />);
    expect(screen.getByText(`${source === "llm" ? "AI 요약" : "규칙 기반 기본 안내"} · 기사 본문 기반 요약`)).toBeInTheDocument();
    expect(screen.queryByText(/본문 미수집/)).not.toBeInTheDocument();
    rerender(<StockNewsSummary news={{ ...news, summaryBasis: undefined }} targets={new Map()} />);
    expect(screen.getByText(`${source === "llm" ? "AI 요약" : "규칙 기반 기본 안내"} · 기사 제목 기반 요약`)).toBeInTheDocument();
  });
});
