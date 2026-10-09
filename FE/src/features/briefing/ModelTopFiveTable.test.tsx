import { describe, expect, it } from "vitest";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow } from "../../test/dataFixtures";
import { modelTopFive } from "./ModelTopFiveTable";

describe("original model Top-5 selection", () => {
  it("excludes absent and invalid ranks without renumbering, fabricating predictions or mutating the input", () => {
    const ranks = [42, null, 17, 6, 29, 8, 11, 0, -1, 1.5, NaN];
    const rows = ranks.map((rank, index) => ({ ...adaptCandidate(pipelineRow()).data, code: String(100001 + index), rank, predictedReturn: index === 3 ? null : index === 5 ? 0 : -.01, finalRank: index + 1 }));
    const before = rows.map(row => row.rank), top = modelTopFive(rows);
    expect(top.map(row => row.rank)).toEqual([6, 8, 11, 17, 29]);
    expect(top[0].predictedReturn).toBeNull(); expect(top[1].predictedReturn).toBe(0);
    expect(rows.map(row => row.rank)).toEqual(before);
    expect(modelTopFive([])).toEqual([]);
  });
});
