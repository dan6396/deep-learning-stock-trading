import { pipelineRow } from "../../test/dataFixtures";
export function rankFixture(index: number, prediction: unknown = index === 0 ? 0 : index === 1 ? -.01 : index === 2 ? null : .02) {
  const code = String(100001 + index), name = `검증종목${String(index + 1).padStart(3, "0")}`;
  const row = pipelineRow({ ticker: code, company_name: name, ensemble_pred_return: prediction, pred_rank: index + 1, pred_pool_size: 199 }, { rawFinalRank: index < 5 ? index + 1 : null });
  row.result.ticker = code; row.result.company_name = name; return row;
}
export function wholeRank() { return Array.from({ length: 199 }, (_, index) => rankFixture(index)); }
