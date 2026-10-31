import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockAiOpinionCard } from "./StockAiOpinionCard";
import type { StockAiOpinion } from "../../entities/stockInsight";

describe("opinion source authority", () => {
  it.each(["llm", "template", undefined] as const)("reserves AI titles for actual llm source %s", source => {
    const opinion = { source, text: "제공된 모델 관측을 확인했습니다.", citations: ["M:USDKRW"] } as StockAiOpinion;
    render(<StockAiOpinionCard opinion={opinion} targets={new Map()} />);
    expect(screen.getByRole("heading", { name: source === "llm" ? "AI 최종 의견" : "모델·근거 요약" })).toBeInTheDocument();
    expect(screen.getByText(/투자 권유 아님 · 방향 판단 아님/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /환율|USDKRW/ })).not.toBeInTheDocument();
  });
});
