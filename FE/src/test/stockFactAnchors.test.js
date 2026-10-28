import { describe, expect, it } from "vitest";
import { stockOpinionSentenceReason, selectStockOpinion } from "../../server/stockOpinion";
import { headlineSentenceReason, selectHeadlineSummary, validateMarketOutlook } from "../../server/briefingExtensions";
import { forbiddenStockNewsForecast } from "../../server/stockNewsLanguage";
import { stockFactAnchor } from "../../server/stockFactAnchors";
import { extractArticleText } from "../../server/articleText";

const id = "N:005930:1", data = { newsValidation: "on", model: null, macro: { indicators: [], preOpen: [{ id: "NASDAQ", name: "나스닥", status: "ok", unit: "pt", value: 100, change: 1, changePct: 1, fiveDayChange: 2, fiveDayChangePct: 2, history: [] }] }, stocks: [{ code: "005930", name: "삼성전자", rank: 1, rankScore: 1.7, poolSize: 200, topPercent: .5, evidence: [{ id: "E:005930:1", kind: "model", text: "모델 순위 1위입니다." }], cautions: [], news: { articles: [{ id, title: "삼성전자 공시 및 서비스 개편 발표", source: "경제지", url: "https://paper.example/a" }] } }] };
const citations = ["R:005930", "E:005930:1", id, "M:NASDAQ"];
const bypasses = ["밸류에이션 매력이 있습니다.", "좋은 흐름을 보일 것으로 봅니다.", "주가가 한 단계 레벨업할 소지가 있습니다.", "신고가 경신이 점쳐집니다.", "매집 구간입니다.", "저점에서 올라설 것으로 관측됩니다.", "순위가 높아 투자 매력도가 큽니다.", "기사에서 호실적이 언급됩니다.", "수익이 날 것입니다.", "올라갈 여지는 남아 있습니다.", "순위 1위로 시세 분출이 나올 법합니다.", "강세 흐름이 이어질 듯합니다.", "주가는 오르는 방향입니다."];
const normal = ["이 지표는 종목 간 비교에 활용할 수 있습니다.", "시장 지표는 별도로 확인할 수 있습니다.", "주가 예측이 아닙니다.", "순위는 수익률 예측이 아니며 기대수익을 의미하지 않습니다."];

describe("sentence fact allowlist supplements stock/news deny rules", () => {
  it.each(bypasses)("rejects in both fields: %s", text => {
    expect(stockOpinionSentenceReason(text, data, 0)).not.toBeNull();
    expect(headlineSentenceReason(text, data, 0)).not.toBeNull();
    // A valid rank or article attribution must never license an unsafe tail.
    expect(stockOpinionSentenceReason(`모델 순위 1위이며 ${text}`, data, 0)).not.toBeNull();
    expect(headlineSentenceReason(`공시를 다룬 기사이며 ${text}`, data, 0)).not.toBeNull();
  });
  it.each(normal)("retains fixed cautions/functions without future false positives: %s", text => {
    expect(forbiddenStockNewsForecast(text)).toBe(false);
    expect(stockOpinionSentenceReason(text, data, 0)).toBeNull();
  });
  it("does not join two substantive words into a forbidden term", () => {
    expect(forbiddenStockNewsForecast("대상 방식은 지표 비교에 활용할 수 있습니다.")).toBe(false);
    for (const text of ["상 방 여지가 있습니다.", "상·방 여지가 있습니다.", "상 승 할 것 같습니다.", "주가 예측이 아니며 급등할 것입니다."]) expect(forbiddenStockNewsForecast(text)).toBe(true);
  });
  it("requires an actual input item, not generic labels or an unanchored sentence", () => {
    for (const text of ["분석을 살펴봤습니다.", "순위가 높습니다.", "기사 내용을 확인했습니다.", "시장 배경입니다.", "모델은 1%입니다."]) expect(stockOpinionSentenceReason(text, data, 0)).toBe("no_anchor");
    expect(stockOpinionSentenceReason("모델 순위 2위입니다.", data, 0)).toBe("ungrounded_rank");
    expect(stockOpinionSentenceReason("순위 점수는 9.9입니다.", data, 0)).toBe("ungrounded_score");
    expect(stockFactAnchor("공시 주제를 다룬 기사입니다.", data, 0, [])).toBeNull();
    expect(stockFactAnchor("공시 주제를 다룬 기사입니다.", data, 0, [id])).toBe("article_topic");
  });
  it("accepts only attributed cited article topics, never unrelated inventions or notices", () => {
    expect(headlineSentenceReason("공시를 발표했다고 보도했습니다.", { ...data, articleBodies: { [id]: { text: "공시를 발표했습니다." } } }, 0, [id], [id])).toBeNull();
    expect(headlineSentenceReason("서비스 개편을 다룬 기사입니다.", data, 0, undefined, [id])).toBeNull();
    for (const [text, ids] of [["공시를 다룬 기사입니다.", []], ["공시 내용입니다.", [id]], ["우주선 발사를 다룬 기사입니다.", [id]], ["본 기사 내용은 제목 기반으로 확인된 사항입니다.", [id]]]) expect(headlineSentenceReason(text, data, 0, undefined, ids)).not.toBeNull();
    expect(headlineSentenceReason("호실적을 발표했다고 보도했습니다.", data, 0)).toBe("forbidden_content");
  });
  it("uses the cited body's text for a topic absent from its title", () => {
    const bodyInput = { ...data, articleBodies: { [id]: { text: "우주선 발사를 발표했습니다.", url: "https://paper.example/a", collectedAt: "2026-10-28T00:00:00Z" } } };
    expect(headlineSentenceReason("우주선 발사를 발표했다고 보도했습니다.", bodyInput, 0, [id])).toBeNull();
    expect(headlineSentenceReason("우주선 발사를 발표했다고 보도했습니다.", data, 0, [id])).toBe("source_not_grounded");
  });
  it("filters unanchored sentences with the existing minimum and field-local fallback", () => {
    expect(selectStockOpinion({ code: "005930", text: "모델 순위 1위입니다. 공시를 다룬 기사입니다. 설명입니다.", citations }, data, 0)?.text).toBe("모델 순위 1위입니다. 공시를 다룬 기사입니다.");
    expect(selectHeadlineSummary({ code: "005930", text: "공시를 다룬 기사입니다. 서비스 개편을 다룬 기사입니다. 설명입니다.", citations: [id] }, data, 0)?.text).toBe("공시를 다룬 기사입니다. 서비스 개편을 다룬 기사입니다.");
    expect(selectHeadlineSummary({ code: "005930", text: "공시를 다룬 기사입니다. 설명입니다.", citations: [id] }, data, 0)).toBeNull();
  });
  it("preserves market-level direction in marketOutlook", () => {
    expect(validateMarketOutlook({ stance: "상승 우위", text: "나스닥 상승 흐름을 살펴 코스피 장 초반은 상승 우위로 판단합니다.", citations: ["M:NASDAQ"] }, data)).toBeNull();
  });
  it("preserves offsets for Unicode casing and treats HTML void elements as void", () => {
    const body = "공시와 서비스 개편을 설명한 기사 본문입니다. ".repeat(12);
    expect(extractArticleText(`İ<script>hidden</script><article><col><track><param>${body}</article>`)).toBe(body.trim());
    expect(extractArticleText(`<article>${"<col><track><param>".repeat(300)}${body}</article>`)).toBe(body.trim());
  });
});
