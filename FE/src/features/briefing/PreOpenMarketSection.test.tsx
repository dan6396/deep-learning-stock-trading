import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreOpenMarketSection } from "./PreOpenMarketSection";
import type { MacroData, BriefingNarrative } from "../../entities/briefing";
import { macroComment } from "../../../server/macroCommentRules";
const macro: MacroData = { asOf: null, indicators: [], preOpen: [{ id: "UST10Y", name: "미 국채 10년물", unit: "%", source: "yahoo", status: "ok", value: 4.2, change: 0.01, changePct: 0.24, fiveDayChange: 0.15, fiveDayChangePct: 3.7, asOf: "2026-10-26T20:00:00Z", history: ["20", "21", "22", "23", "26"].map((day, i) => ({ date: `2026-10-${day}`, value: 4.05 + i * .0375 })), comment: { text: "관측 구간 금리 상승입니다.", ruleId: "up" } }] };
const narrative: BriefingNarrative = { status: "llm", generatedAt: "", llmModel: "fixture", inputHash: "fixture", fallbackReason: null, overview: "", marketNote: "", stocks: [], citations: [], marketOutlook: { stance: "중립", text: "장 초반 갭 맥락으로만 판단합니다.", citations: ["M:UST10Y"], source: "llm" } };
describe("pre-open market cards", () => {
  it.each(["llm", "template", undefined] as const)("uses the actual outlook source %s in its title", source => {
    render(<PreOpenMarketSection macro={macro} narrative={{ ...narrative, marketOutlook: { ...narrative.marketOutlook!, source: source as "llm" | "template" } }} onCitationClick={vi.fn()} />);
    expect(screen.getByRole("heading", { name: source === "llm" ? "AI 최종 의견" : "지표 기반 참고 요약" })).toBeInTheDocument();
  });
  it("aligns plots and dates across different numeric label lengths after resizing", () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { observers.push(callback); }
      observe() {}
      disconnect() {}
    });
    try {
      const histories = [[26008.86, 25955.34, 25950, 26169.38, 26477.81], [5.146, 4.953, 4.988, 4.986, 4.993], [10799.46, 10731.98, 10740, 11083.47, 11482.5]];
      const ids = ["NASDAQ", "UST10Y", "SOX"] as const;
      const rows = ids.map((id, i) => ({ ...macro.preOpen![0], id, name: id, unit: i === 1 ? "%" as const : "pt" as const, history: macro.preOpen![0].history.map((point, j) => ({ ...point, value: histories[i][j] })) }));
      const { container } = render(<PreOpenMarketSection macro={{ ...macro, preOpen: rows }} narrative={narrative} onCitationClick={vi.fn()} />);
      for (const width of [240, 373, 460]) {
        act(() => observers.forEach(callback => callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)));
        const graphs = [...container.querySelectorAll(".preopen-chart svg")];
        expect(graphs).toHaveLength(3);
        expect(new Set(graphs.map(graph => graph.getAttribute("height"))).size).toBe(1);
        expect(new Set(graphs.flatMap(graph => [...graph.querySelectorAll('[data-chart-label="date"]')].map(date => date.getAttribute("y")))).size).toBe(1);
        expect(container.querySelector('.preopen-chart-values')).toBeNull();
        expect(container.querySelector('[data-chart-label="value"]')).toBeNull();
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it("renders five cards in the requested DOM order and explains incomplete observations", () => {
    const ids = ["NASDAQ", "UST10Y", "SOX", "KOSPI200_FOREIGN_FUTURES", "USDKRW"] as const;
    const rows = ids.map(id => { const base = { ...macro.preOpen![0], id, name: id, unit: id === "KOSPI200_FOREIGN_FUTURES" ? "계약" as const : id === "UST10Y" ? "%" as const : id === "USDKRW" ? "KRW" as const : "pt" as const, fiveDaySum: id === "KOSPI200_FOREIGN_FUTURES" ? 5000 : null }; return { ...base, comment: macroComment(base) }; });
    const { container, rerender } = render(<PreOpenMarketSection macro={{ ...macro, preOpen: [...rows].reverse() }} narrative={narrative} onCitationClick={vi.fn()} />);
    expect([...container.querySelectorAll('.preopen-grid > article')].map(e => e.getAttribute('data-testid'))).toEqual(ids.map(id => `preopen-${id}`));
    expect(screen.getAllByText("분석 의견")).toHaveLength(5);
    expect(screen.queryByText("임시 문구")).not.toBeInTheDocument();
    expect(screen.getByText("분석 의견은 지표 구간에 따라 미리 정해진 문구가 표시되며 투자 권유가 아닙니다")).toBeInTheDocument();
    expect(container.querySelector('.has-five-cards')).not.toBeNull();
    const incomplete = rows.map(row => { const base = { ...row, history: row.history.slice(0, 4) }; return { ...base, comment: macroComment(base) }; });
    rerender(<PreOpenMarketSection macro={{ ...macro, preOpen: incomplete }} narrative={narrative} onCitationClick={vi.fn()} />);
    expect(screen.getAllByText("분석 의견")).toHaveLength(5);
    expect(screen.getAllByText(/추세를 비교할 관측일이 부족합니다/)).toHaveLength(4);
  });
  it("hides the removed legacy SP500 outlook chip and retains live indicator citations", () => {
    render(<PreOpenMarketSection macro={macro} narrative={{ ...narrative, marketOutlook: { ...narrative.marketOutlook!, citations: ["M:SP500", "M:UST10Y"] } }} onCitationClick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /SP500|S&P 500/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "미 국채 10년물" })).toBeInTheDocument();
  });
  it("renders units, provisional wording, actual observation count and linked opinion", () => {
    const click = vi.fn(); render(<PreOpenMarketSection macro={macro} narrative={narrative} onCitationClick={click} />);
    expect(screen.getByText("장전 시장 지표")).toBeInTheDocument(); expect(screen.getByText("분석 의견")).toBeInTheDocument();
    expect(screen.getByText(/전일 대비 \+0.010%p/)).toBeInTheDocument();
    expect(screen.getByText("5일 추세")).toHaveClass("preopen-trend-label");
    expect(screen.getByText("5일 추세").className).not.toMatch(/is-(rise|fall)/);
    expect(screen.queryByText(/첫날 대비|관측일|Yahoo Finance/, { selector: "p" })).not.toBeInTheDocument();
    expect(screen.getByTestId("preopen-UST10Y")).toHaveAttribute("title", "5/5개 관측일 · 단위 % · 10. 27. 05:00 KST · Yahoo Finance");
    const metadata = screen.getByText(/5\/5개 관측일/);
    expect(metadata).toHaveAttribute("hidden"); expect(metadata).not.toBeVisible();
    expect(screen.getByTestId("preopen-UST10Y")).toHaveAccessibleDescription(metadata.textContent!);
    expect(screen.getByTestId("preopen-UST10Y")).toHaveAccessibleName("미 국채 10년물");
    expect(screen.getByTestId("preopen-UST10Y")).toHaveAttribute("aria-labelledby", screen.getByRole("heading", { name: "미 국채 10년물" }).id);
    expect(screen.getByTestId("preopen-UST10Y")).toHaveAttribute("aria-describedby", metadata.id);
    expect(screen.queryByText(/관측일|Yahoo Finance/, { selector: ":not([hidden])" })).not.toBeInTheDocument();
    expect(screen.getByText(/AI 의견 · 투자 권유 아님/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "미 국채 10년물" })); expect(click).toHaveBeenCalledWith("M:UST10Y", "preopen");
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
  it("toggles mobile source details and opinion without replacing the citation target", () => {
    const long = { ...narrative, marketOutlook: { ...narrative.marketOutlook!, text: "직전 관측일의 지표를 함께 확인하며 장 초반 방향은 중립으로 판단합니다. ".repeat(8) } };
    const click = vi.fn(); render(<PreOpenMarketSection macro={macro} narrative={long} onCitationClick={click} />);
    const target = screen.getByTestId("preopen-UST10Y");
    const detailButton = screen.getByRole("button", { name: "미 국채 10년물 자세히" });
    const details = document.getElementById(detailButton.getAttribute("aria-controls")!)!;
    expect(details).toHaveClass("is-collapsed");
    fireEvent.click(detailButton); expect(details).toHaveClass("is-expanded"); expect(detailButton).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(detailButton); expect(details).toHaveClass("is-collapsed");
    const opinionButton = screen.getByRole("button", { name: "AI 최종 의견 더 보기" });
    expect(screen.getByTestId("market-outlook")).toHaveClass("is-collapsed");
    fireEvent.click(opinionButton); expect(screen.getByTestId("market-outlook")).toHaveClass("is-expanded");
    expect(opinionButton).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "미 국채 10년물" })); expect(click).toHaveBeenCalledWith("M:UST10Y", "preopen");
    expect(screen.getByTestId("preopen-UST10Y")).toBe(target);
    fireEvent.click(opinionButton); expect(screen.getByTestId("market-outlook")).toHaveClass("is-collapsed");
  });
  it("keeps short opinions and their citations visible without an expansion button", () => {
    render(<PreOpenMarketSection macro={macro} narrative={narrative} onCitationClick={() => {}} />);
    expect(screen.queryByRole("button", { name: "AI 최종 의견 더 보기" })).not.toBeInTheDocument();
    expect(screen.getByTestId("market-outlook")).not.toHaveClass("is-collapsed");
    expect(screen.getByRole("button", { name: "미 국채 10년물" })).toBeVisible();
  });
  it("promotes available futures to a contract card with a signed five-day total", () => {
    const flow = { ...macro.preOpen![0], id: "KOSPI200_FOREIGN_FUTURES" as const, name: "코스피200 선물 외국인 순매수", unit: "계약" as const, source: "kis" as const, value: -670, fiveDaySum: -4000, asOf: "2026-10-26", history: [1, 2, 3, 4, 5].map(n => ({ date: `2026-10-${20 + n}`, value: -800 })) };
    render(<PreOpenMarketSection macro={{ ...macro, preOpen: [flow] }} narrative={narrative} onCitationClick={() => {}} />);
    expect(screen.getByText("-670계약", { selector: "strong" })).toHaveClass("is-fall");
    expect(screen.getByText("5일 합계 -4,000계약")).toHaveClass("is-fall");
    expect(screen.queryByText(/관측일|KIS 시장별/, { selector: "p" })).not.toBeInTheDocument();
    expect(screen.getByTestId("preopen-KOSPI200_FOREIGN_FUTURES")).toHaveAttribute("title", expect.stringContaining("KIS 시장별 투자자매매동향(일별)"));
    const metadata = screen.getByText(/5\/5개 관측일/);
    expect(metadata).toHaveAttribute("hidden"); expect(metadata).not.toBeVisible();
    expect(metadata).toHaveTextContent("단위 계약 · 기준일 2026-10-26 · KIS 시장별 투자자매매동향(일별)");
    expect(screen.getByTestId("preopen-KOSPI200_FOREIGN_FUTURES")).toHaveAccessibleDescription(metadata.textContent!);
    expect(screen.getByTestId("preopen-KOSPI200_FOREIGN_FUTURES")).toHaveAccessibleName("코스피200 선물 외국인 순매수");
    expect(screen.getByText("10/21", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("10/25", { selector: "text" })).toBeInTheDocument();
    const spark = screen.getByRole("group", { name: /코스피200 선물 외국인 순매수:/ });
    expect(spark).toHaveAccessibleName("코스피200 선물 외국인 순매수: 2026-10-21~2026-10-25 · 5개 관측 · 최소 -800계약 · 최대 -800계약 · 마지막 2026-10-25 -800계약");
    expect(spark.querySelector("title")).toBeNull();
    for (const day of [21,22,23,24,25]) expect(screen.getByRole("button", { name: `2026-10-${day} -800계약` })).toBeInTheDocument();
    expect(screen.getByTestId("preopen-KOSPI200_FOREIGN_FUTURES")).not.toHaveClass("preopen-unavailable");
  });
  it("keeps four-card columns when futures are unavailable", () => {
    const rows = ["UST10Y", "NASDAQ", "USDKRW", "KOSPI200_FOREIGN_FUTURES"].map(id => ({ ...macro.preOpen![0], id, status: id === "KOSPI200_FOREIGN_FUTURES" ? "unavailable" : "ok" })) as MacroData["preOpen"];
    const { container } = render(<PreOpenMarketSection macro={{ ...macro, preOpen: rows }} narrative={narrative} onCitationClick={() => {}} />);
    expect(container.querySelector(".preopen-grid")).toHaveClass("has-four-cards");
    expect(screen.getByTestId("preopen-KOSPI200_FOREIGN_FUTURES")).toHaveClass("preopen-unavailable");
  });
});
