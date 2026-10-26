import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BriefingComposition } from "../../entities/briefing";
import { BriefingCompositionCard } from "./BriefingCompositionCard";

const emptyComposition: BriefingComposition = {
  basis: "equal_weight_reference", note: "동일 비중 참고 구성입니다. 투자 권유가 아닙니다.",
  sectors: null, sectorSource: null, performance: null, commonCautions: ["업종 분류를 확인하지 못했습니다."],
};

it("hides a composition containing only unavailable data and boilerplate", () => {
  const { container } = render(<MemoryRouter><BriefingCompositionCard composition={emptyComposition} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});

it("retains real concentration cautions without unavailable-sector or repeated legal notices", () => {
  render(<MemoryRouter><BriefingCompositionCard composition={{ ...emptyComposition, commonCautions: [
    ...emptyComposition.commonCautions, "같은 업종에 3종목이 포함되어 있습니다.",
  ] }} /></MemoryRouter>);
  expect(screen.getByTestId("composition-cautions")).toHaveTextContent("같은 업종에 3종목");
  expect(screen.queryByText("업종 분류를 확인하지 못했습니다.")).not.toBeInTheDocument();
  expect(screen.getByTestId("composition-note")).toHaveTextContent(/^동일 비중 참고 구성입니다\.$/);
  expect(screen.queryByTestId("composition-performance")).not.toBeInTheDocument();
});

it("keeps a composition with independent beta or risk data while its matrix is preparing", () => {
  render(<MemoryRouter><BriefingCompositionCard composition={{ ...emptyComposition, diversification: {
    status: "preparing", codes: ["005930"], samples: 0, periodStart: null, periodEnd: null,
    matrix: [[null]], averageCorrelation: null, highestPair: null, nasdaqBetas: [],
    commonRisks: ["같은 업종에 3종목이 포함되어 있습니다."], note: "",
  } }} /></MemoryRouter>);
  expect(screen.getByText("같은 업종에 3종목이 포함되어 있습니다.")).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
