import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignalView } from "./SignalView";
import { adaptCandidate } from "../../entities/candidate";
import { modelSignal, SIGNAL_RULE_VERSION } from "../../entities/signals";
import { pipelineRow } from "../../test/dataFixtures";

it.each([[10, "모델 상위권"], [11, "모델 순위 11위"]])("automatically renders model rank %s without directional colour or arrows", (rank, label) => {
  const candidate = adaptCandidate(pipelineRow({ score_kind: "rank_zscore", rank_score: -1, pred_rank: rank, pred_pool_size: 200 })).data;
  const { container } = render(<SignalView signal={modelSignal(candidate)} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(container.querySelector('[data-signal]')).toHaveAttribute("data-signal", "neutral");
  expect(container.querySelector('.lucide-triangle')).not.toBeInTheDocument();
});
it("describes unexecuted news without a positive or negative label", () => {
  render(<SignalView signal={{ state: "unavailable", reason: "모델 전용 · 뉴스 미사용", ruleVersion: SIGNAL_RULE_VERSION }} />);
  expect(screen.getByText("뉴스 보정 미실행")).toBeInTheDocument();
  expect(screen.queryByText(/긍정|부정/)).not.toBeInTheDocument();
});
