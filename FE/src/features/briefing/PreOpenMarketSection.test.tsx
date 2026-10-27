import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreOpenMarketSection } from "./PreOpenMarketSection";
import type { MacroData, BriefingNarrative } from "../../entities/briefing";
const macro: MacroData = { asOf: null, indicators: [], preOpen: [{ id: "UST10Y", name: "미 국채 10년물", unit: "%", source: "yahoo", status: "ok", value: 4.2, change: 0.01, changePct: 0.24, fiveDayChange: 0.15, fiveDayChangePct: 3.7, asOf: "2026-10-26T20:00:00Z", history: [{ date: "2026-10-20", value: 4.05 }, { date: "2026-10-26", value: 4.2 }], comment: { text: "관측 구간 금리 상승입니다.", placeholder: true, ruleId: "up" } }] };
const narrative: BriefingNarrative = { status: "llm", generatedAt: "", llmModel: "fixture", inputHash: "fixture", fallbackReason: null, overview: "", marketNote: "", stocks: [], citations: [], marketOutlook: { stance: "중립", text: "장 초반 갭 맥락으로만 판단합니다.", citations: ["M:UST10Y"], source: "llm" } };
describe("pre-open market cards", () => {
  it("renders units, provisional wording, actual observation count and linked opinion", () => {
    const click = vi.fn(); render(<PreOpenMarketSection macro={macro} narrative={narrative} onCitationClick={click} />);
    expect(screen.getByText("장전 시장 지표")).toBeInTheDocument(); expect(screen.getByText("임시 문구")).toBeInTheDocument();
    expect(screen.getByText(/전일 대비 \+0.010%p/)).toBeInTheDocument(); expect(screen.getByText(/5일 · 첫날 대비 \+0.150%p/)).toBeInTheDocument();
    expect(screen.getByText(/AI 의견 · 투자 권유 아님/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "미 국채 10년물" })); expect(click).toHaveBeenCalledWith("M:UST10Y");
  });
  it("shows small yield moves precisely and keeps a rounded zero neutral", () => {
    const row = macro.preOpen![0];
    const { rerender } = render(<PreOpenMarketSection macro={{ ...macro, preOpen: [{ ...row, change: -0.002 }] }} narrative={narrative} onCitationClick={() => {}} />);
    expect(screen.getByText("전일 대비 -0.002%p")).toHaveClass("is-fall");
    rerender(<PreOpenMarketSection macro={{ ...macro, preOpen: [{ ...row, change: -0.0001 }] }} narrative={narrative} onCitationClick={() => {}} />);
    expect(screen.getByText("전일 대비 0.000%p")).not.toHaveClass("is-fall");
  });
  it("collapses unavailable futures to a low-emphasis source notice", () => {
    render(<PreOpenMarketSection macro={{ ...macro, preOpen: [{ ...macro.preOpen![0], id: "KOSPI200_FOREIGN_FUTURES", name: "코스피200 선물 외국인 순매수", status: "unavailable", value: null, history: [] }] }} narrative={narrative} onCitationClick={() => {}} />);
    expect(screen.getByTestId("preopen-KOSPI200_FOREIGN_FUTURES")).toHaveClass("preopen-unavailable");
    expect(screen.getByText("출처 확인 중")).toBeInTheDocument();
    expect(screen.queryByText("자료 없음")).not.toBeInTheDocument(); expect(screen.queryByText(/전일 대비/)).not.toBeInTheDocument();
  });
  it("keeps old responses without the optional section compatible", () => {
    render(<PreOpenMarketSection macro={{ indicators: [], asOf: null }} narrative={narrative} onCitationClick={() => {}} />);
    expect(screen.queryByText("장전 시장 지표")).not.toBeInTheDocument();
  });
});
