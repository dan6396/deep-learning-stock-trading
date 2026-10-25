import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CompositionObservations } from "./CompositionObservations";
import type { Diversification } from "../../entities/stockInsight";
describe("TOP5 historical correlation", () => {
  it("keeps every heatmap value accessible as a scoped table cell and labels the shared sample", () => {
    const codes = ["005930", "000660", "042660", "035420", "005380"];
    const data: Diversification = { status: "ready", codes, samples: 59, periodStart: "2026-07-28", periodEnd: "2026-10-22", matrix: codes.map((_, i) => codes.map((__, j) => i === j ? 1 : .5)), averageCorrelation: .5, highestPair: { codes: ["005930", "000660"], correlation: .5 }, nasdaqBetas: [], commonRisks: [], note: "과거 상관은 미래 결과를 보장하지 않습니다." };
    render(<CompositionObservations data={data} stocks={codes.map((code, i) => ({ code, name: `종목 ${i + 1}` }))} />);
    const table = screen.getByRole("table"); expect(within(table).getAllByRole("cell")).toHaveLength(25); expect(within(table).getAllByRole("rowheader")).toHaveLength(5);
    expect(screen.getByRole("region")).toHaveAttribute("tabindex", "0"); expect(screen.getByText(/공통 관측 59일/)).toBeInTheDocument();
  });
});
