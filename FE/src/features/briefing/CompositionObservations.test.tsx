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
    expect(screen.getByRole("region")).toHaveAttribute("tabindex", "0"); expect(screen.getByText(/분석 기간 59거래일/)).toBeInTheDocument();
    expect(screen.queryByText(data.note)).not.toBeInTheDocument();
  });
  it("omits a correlation section before common historical samples are available", () => {
    const { container } = render(<CompositionObservations data={{ status: "preparing", codes: ["005930"], samples: 0,
      periodStart: null, periodEnd: null, matrix: [[null]], averageCorrelation: null, highestPair: null,
      nasdaqBetas: [], commonRisks: [], note: "자료 준비 중" }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("retains beta data and concentration risks while the correlation matrix is preparing", () => {
    render(<CompositionObservations data={{ status: "preparing", codes: ["005930"], samples: 0,
      periodStart: null, periodEnd: null, matrix: [[null]], averageCorrelation: null, highestPair: null,
      nasdaqBetas: [{ code: "005930", closeToClose: 0.82, openToClose: 0.13, samples: 210 }],
      commonRisks: ["같은 업종에 3종목이 포함되어 있습니다."], note: "최근 1년 표본에 한정된 관측이며 미래 결과를 보장하지 않습니다." }} stocks={[{ code: "005930", name: "삼성전자" }]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/삼성전자 · 종가→종가 0.82 \/ 시가→종가 0.13 · 210일/)).toBeInTheDocument();
    expect(screen.getByText("같은 업종에 3종목이 포함되어 있습니다.")).toBeVisible();
    expect(screen.getByText("최근 1년 표본에 한정된 관측입니다.")).toBeVisible();
    expect(screen.queryByText(/데이터 준비 중/)).not.toBeInTheDocument();
  });
});
