import { describe, expect, it } from "vitest";
import { adaptCandidate } from "../../entities/candidate";
import { pipelineRow } from "../../test/dataFixtures";
import { compareNullable, noNewsEvidence, rankRows, rankSignals } from "./rankData";
const row = (code: string, prediction: number | null, rank = 1) => { const raw = pipelineRow({ ticker: code, ensemble_pred_return: prediction, pred_rank: rank }); raw.result.ticker = code; return adaptCandidate(raw).data; };
describe("whole-universe rank rules", () => {
  it.each([false, true])("puts missing after measured zero and negative in direction %s", descending => {
    const rows = [row("005930", null), row("000660", 0), row("005380", -.01), row("035420", .02)];
    expect(rankRows(rows, [], true, "", "all", "predictedReturn", descending).map(item => item.predictedReturn)).toEqual(descending ? [.02, 0, -.01, null] : [-.01, 0, .02, null]);
    expect(compareNullable(null, null, descending)).toBe(0);
  });
  it("keeps the whole 199-row set, searches non-candidates, never fills an empty rank", () => {
    const rows = Array.from({ length: 199 }, (_, index) => row(String(100001 + index), index / 10000, index + 1));
    const candidates = rows.slice(0, 5);
    expect(rankRows(rows, candidates, true, "", "all", "rank", false)).toHaveLength(199);
    expect(rankRows(rows, candidates, true, "100199", "all", "rank", false)).toHaveLength(1);
    expect(rankRows([], candidates, true, "", "all", "rank", false)).toEqual([]);
  });
  it("keeps zero in 0-or-negative filter, treats missing separately and requires confirmed candidate filter", () => {
    const rows = [row("005930", 0), row("000660", null), row("005380", -.01)];
    expect(rankRows(rows, rows, true, "", "negative", "rank", false).map(item => item.code)).toEqual(["005380", "005930"]);
    expect(rankRows(rows, rows, true, "", "missing", "rank", false).map(item => item.code)).toEqual(["000660"]);
    expect(rankRows(rows, rows, false, "", "candidate", "rank", false)).toEqual([]);
  });
  it("uses authoritative candidate model values and separates actual non-candidate news evidence", () => {
    const detail = row("005930", .01), candidate = { ...detail, predictedReturn: -.02, finalRank: 3 };
    const merged = rankRows([detail], [candidate], true, "", "all", "rank", false)[0];
    expect(merged).toMatchObject({ predictedReturn: -.02, finalRank: 3 });
    expect(rankSignals(merged, "candidate").model.state).toBe("positive");
    const evidenced = { ...detail, newsMethod: "llm" as const, newsStatus: "analyzed", newsCollected: true, news: [{ title: "원본", url: null, source: null, publishedAt: null, sentiment: "positive" as const }] };
    expect(rankSignals(evidenced, "nonCandidate").news.state).toBe("positive");
    expect(rankSignals(evidenced, "pending").model.state).toBe("unavailable");
    expect(rankSignals(evidenced, "unknown").news.state).toBe("positive");
    expect(noNewsEvidence(evidenced)).toBe(false);
    expect(noNewsEvidence({ ...detail, news: [], newsTally: null, newsCollected: false, newsStatus: null })).toBe(true);
    expect(noNewsEvidence({ ...detail, newsCollected: true, newsStatus: "no_usable_article" })).toBe(false);
  });
  it("excludes existing LLM news from model-only agreement while retaining it for produced candidates", () => {
    const detail = row("005930", .01), evidenced = { ...detail, newsMethod: "llm" as const, newsStatus: "analyzed", newsCollected: true,
      news: [{ title: "이전 뉴스", url: null, source: null, publishedAt: null, sentiment: "positive" as const }] };
    expect(rankSignals(evidenced, "unknown", "unproduced").agreement).toMatchObject({ positive: 1, evaluable: 1, unavailable: 1 });
    expect(rankSignals(evidenced, "candidate", "produced").agreement).toMatchObject({ positive: 2, evaluable: 2, unavailable: 1 });
  });
});
