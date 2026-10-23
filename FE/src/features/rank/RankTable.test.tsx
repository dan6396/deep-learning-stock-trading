import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow } from "../../test/dataFixtures";
import { RankTable } from "./RankTable";
import { rankRows } from "./rankData";

describe("score table model-rank emphasis", () => {
  it("matches the upper-five-percent filter and excludes unverified scores and targets", () => {
    const rows = [
      { code: "100001", rank: 1, score: 1.6, target: "next_session_open_to_close" },
      { code: "100002", rank: 2, score: null, target: "next_session_open_to_close" },
      { code: "100003", rank: 3, score: 1.5, target: null },
      { code: "100010", rank: 10, score: 1.4, target: "next_session_open_to_close" },
      { code: "100011", rank: 11, score: 1.3, target: "next_session_open_to_close" },
    ].map(({ code, rank, score, target }) => {
      const raw = pipelineRow({ ticker: code, score_kind: "rank_zscore", rank_score: score, pred_rank: rank, pred_pool_size: 200, prediction_target: target });
      raw.result.ticker = code;
      return adaptCandidate(raw).data;
    });
    const { container } = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RankTable rows={rows} members={new Set()} membershipState="unknown" production="unproduced" /></MemoryRouter>);
    const highlighted = [...container.querySelectorAll('[data-top-rank="true"]')].map(row => row.getAttribute("data-rank-code"));
    expect(highlighted).toEqual(rankRows(rows, [], false, "", "positive", "rank", false).map(row => row.code));
    expect(highlighted).toEqual(["100001", "100010"]);
    for (const code of ["100002", "100003", "100011"]) {
      const row = container.querySelector(`[data-rank-code="${code}"]`)!;
      expect(row).toHaveAttribute("data-top-rank", "false");
      expect(row.querySelector('[data-signal]')).toBeNull();
      expect(row).not.toHaveTextContent(/모델 상위권|순위 미확인/);
    }
  });
});
