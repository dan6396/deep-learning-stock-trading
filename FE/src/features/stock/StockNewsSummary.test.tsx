import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockNewsSummary } from "./StockNewsCard";
import type { StockInsight } from "../../types/stockInsight";
describe("news summary provenance", () => {
  it("shows the actual source basis without a validation warning", () => {
    const news: StockInsight["news"] = { source: "llm", summarySource: "llm", validation: "off", summary: "시험용 모델 출력", bodyCollected: false, limitation: "", articles: [], citations: [] };
    render(<StockNewsSummary news={news} targets={new Map()} />);
    expect(screen.getByText("AI 요약 · 제목 기반")).toBeInTheDocument();
    expect(screen.queryByText(/검증 꺼짐|시험용\)/)).not.toBeInTheDocument();
  });
  it.each(["llm", "template", undefined] as const)("uses independent source and basis labels for %s", source => {
    const news: StockInsight["news"] = { source: source ?? "template", summarySource: source, summaryBasis: "body", bodyCollected: true, summary: "기사가 보도한 서비스 개편 내용을 확인했습니다.", limitation: "", articles: [], citations: [] };
    const { rerender } = render(<StockNewsSummary news={news} targets={new Map()} />);
    expect(screen.getByText(`${source === "llm" ? "AI 요약 · 기사 본문 기반" : "규칙 기반 기본 안내"}`)).toBeInTheDocument();
    expect(screen.queryByText(/본문 미수집/)).not.toBeInTheDocument();
    rerender(<StockNewsSummary news={{ ...news, summaryBasis: "excerpt" }} targets={new Map()} />);
    expect(screen.getByText(`${source === "llm" ? "AI 요약 · 발췌 기반" : "규칙 기반 기본 안내"}`)).toBeInTheDocument();
    rerender(<StockNewsSummary news={{ ...news, summaryBasis: undefined }} targets={new Map()} />);
    expect(screen.getByText(`${source === "llm" ? "AI 요약 · 제목 기반" : "규칙 기반 기본 안내"}`)).toBeInTheDocument();
  });
});
