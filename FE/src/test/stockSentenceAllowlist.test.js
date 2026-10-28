import replay from "./fixtures/narrative-0154-replay.json";
import { describe, expect, it } from "vitest";
import { checkStockSentence, neutralTopicReason, normalizeSentence, STOCK_SENTENCE_FORMS } from "../../server/stockSentenceAllowlist";
import { stockOpinionSentenceReason } from "../../server/stockOpinion";
import { headlineSentenceReason, validateMarketOutlook } from "../../server/briefingExtensions";

const stock = { code: "030200", name: "KT", rank: 1, poolSize: 199, topPercent: .5, rankScore: 1.7031,
  evidence: [{ id: "E:030200:1", kind: "model", text: "모델 순위 1위입니다." }], cautions: [{ id: "C:030200:1", kind: "data", text: "모델 기준일은 2026-10-27이며 오늘 날짜와 다릅니다." }],
  analysisMetrics: { rawRank: 2, adjustedRank: 1, lookbacks: [{ sessions: 20, rank: 1, topPercent: .5 }, { sessions: 120, rank: 2, topPercent: 1 }], agreement: "일치", features: [{ key: "f_rsi", percentile: 79, side: "upper", tailPercent: 21 }] } };
// Sample-specific words are no longer global nouns; this explicit quoted slot
// supplies the same neutral control without silently adding article vocabulary.
const sources = [{ articleId: "N:030200:1", sourceKind: "title", publisher: "가일보", text: "'관중석' 개방 신제품 공개 공시 발표" }];
const context = { field: "opinion", stock, sources, citations: ["R:030200", "R:030200:raw", "R:030200:adjusted", "R:030200:20", "R:030200:120", "E:030200:feature:f_rsi", "E:030200:1", "C:030200:1", "N:030200:1"], articleCount: 1, baseDate: "2026-10-27", today: "2026-10-28" };
const attacks = ["상위 0.5%라 투자 가치가 높습니다.", "20일·120일 모델이 일치해 신뢰할 만합니다.", "모델 순위 1위이며 믿을 수 있습니다.", "모델 순위 1위로 안정적인 종목입니다.", "모델 순위 1위로 안전합니다.", "모델 순위 1위로 위험이 낮습니다.", "모델 순위 1위라 우수한 종목입니다.", "모델 순위 1위라 좋은 종목입니다.", "모델 순위 1위로 확실히 앞서 있습니다.", "순위 1위이며 편입을 고려할 만합니다.", "모델 순위 1위로 눈여겨볼 만합니다.", "모델 순위 1위로 성과가 기대됩니다.", "20일·120일 모델이 일치하므로 예측이 정확할 것입니다.", "상대강도 지표는 상위 21%로 과매수가 아닙니다.", "모델 순위 1위라 유리한 위치입니다.", "모델 순위 1위로 경쟁력이 높습니다.", "모델 순위 1위로 선호됩니다.", "신제품 공개 일정을 다룬 기사이며 긍정적인 소식입니다.", "신제품 공개를 다룬 기사로 성장성이 큽니다.", "신제품 공개를 발표했다고 보도했으며 긍정적입니다.", "신제품 공개를 다룬 기사이며 믿을 만한 성장입니다.", "모델 순위 1위로 밸류에이션 매력이 있습니다.", "모델 순위 1위로 좋은 흐름입니다.", "모델 순위 1위로 레벨업 소지가 있습니다.", "모델 순위 1위로 신고가가 점쳐집니다.", "모델 순위 1위로 매집 구간입니다.", "모델 순위 1위로 수익이 날 것입니다.", "모델 순위 1위로 올라갈 여지가 있습니다.", "모델 순위 1위로 강세 흐름이 이어질 듯합니다."];
const normal = ["순위 점수는 수익률이나 확률을 의미하지 않습니다.", "이 지표는 종목 간 비교에 활용할 수 있습니다.", "주가 예측이 아닙니다.", "기사 본문 확보 여부는 기사마다 다릅니다.", "모집단 199개 중 모델 순위 1위이며 순위 점수는 1.7031입니다.", "관중석 개방을 다룬 기사입니다."];
const reason = (text, input = context) => checkStockSentence(text, input).reason;

describe("pure typed sentence allowlist", () => {
  it.each(attacks)("rejects the design attack without relying on a denylist: %s", text => expect(reason(text)).not.toBeNull());
  it.each(normal)("accepts the design control: %s", text => expect(reason(text)).toBeNull());
  it.each(["긍정적인 소식입니다", "성장성이 큽니다", "믿을 만한 성장입니다", "긍정적입니다", "안전합니다", "주가 예측입니다", "안정성은 확인됩니다"])("rejects residue after an actually grounded topic: %s", tail => {
    expect(reason(`관중석 개방을 다룬 기사이며 ${tail}.`)).toBe("evaluative_residue");
  });
  it.each(["입니다하지만 안전합니다.", "입니다; 안전합니다.", "입니다.\n안전합니다.", "입니다 (안전합니다).", "입니다 '안전합니다'."])("covers every appended clause/character: %s", tail => expect(reason(`모델 순위 1위${tail}`)).not.toBeNull());
  it("checks the facts and citations instead of simply removing numbers", () => {
    for (const text of ["모델 순위 2위입니다.", "모집단 200개 중 모델 순위 1위입니다.", "순위 점수는 1.7032입니다.", "20일 모델 순위는 2위입니다.", "원본 순위는 1위입니다.", "최종 보정 순위는 2위입니다.", "상대강도 지표 상위 79%입니다.", "입력 근거 2건이 확인됩니다."]) expect(reason(text), text).toBe("ungrounded_fact");
    expect(reason("모델 순위 1위입니다.", { ...context, citations: [] })).toBe("invalid_citation");
    expect(reason("입력 근거 1건이 확인됩니다.", { ...context, citations: ["R:030200"] })).toBe("invalid_citation");
    expect(reason("20일 모델 순위는 1위입니다.")).toBeNull();
    expect(reason("120일 모델 상위 1%입니다.")).toBeNull();
    expect(reason("20일·120일 모델은 일치 상태입니다.")).toBeNull();
    expect(reason("상대강도 지표는 상위 21%입니다.")).toBeNull();
    expect(reason("상대강도 지표 백분위는 79%입니다.")).toBeNull();
    expect(reason("입력 근거 1건·주의 1건·기사 1건이 확인됩니다.")).toBeNull();
  });
  it("checks topic words, order, locality and publisher without storing private texts", () => {
    expect(neutralTopicReason("관중석 개방", context).reason).toBeNull();
    expect(neutralTopicReason("중석 개방", context).reason).toBe("topic_not_neutral");
    expect(neutralTopicReason("공개 관중석", context).reason).toBe("topic_not_local");
    const split = { ...context, sources: [{ ...sources[0], text: "'관중석'" }, { ...sources[0], articleId: "N:030200:2", text: "개방" }], citations: [...context.citations, "N:030200:2"] };
    expect(neutralTopicReason("관중석 개방", split).reason).toBe("topic_not_grounded");
    const body = { ...context, sources: [{ ...sources[0], sourceKind: "body", text: "'관중석'. 개방을 발표했습니다." }] };
    expect(neutralTopicReason("관중석 개방", body).reason).toBe("topic_not_local");
    expect(neutralTopicReason("관중석 개방", context, ["없는신문"]).reason).toBe("publisher_mismatch");
    const result = neutralTopicReason("관중석 개방", { ...context, sources: [{ ...sources[0], sourceKind: "excerpt" }] });
    expect(result.sourceOffsets.map(row => row.sourceKind)).toEqual(["excerpt", "excerpt"]);
    expect(JSON.stringify(result)).not.toContain("관중석");
    expect(reason("가일보는 관중석 개방을 다룬 기사를 보도했습니다.", { ...context, field: "news" })).toBeNull();
  });
  it("preserves normalized offsets, decimal points and rejects unknown characters", () => {
    const text = "ＫＴ는 모델 순위 １위이며 순위 점수는 1.7031입니다.";
    const result = checkStockSentence(text, context); expect(result.accepted).toBe(true);
    expect(result.spans.map(span => text.slice(span.originalStart, span.originalEnd)).join(" ")).toContain("１위");
    expect(normalizeSentence("ﬃ").offsets).toEqual([{ start: 0, end: 1 }, { start: 0, end: 1 }, { start: 0, end: 1 }]);
    expect(reason("모델 순위 1위입니다.💰")).toBe("unsupported_character");
    expect(reason("모델 순위 1위입니다.＄")).toBe("unsupported_character");
    expect(reason("주가 예측입니다.")).toBe("evaluative_residue"); expect(reason("종목은 일치합니다.")).not.toBeNull();
  });
  it("rejects body-unavailable and date claims inconsistent with the input", () => {
    expect(reason("기사 본문은 수집하지 않았습니다.", { ...context, sources: [{ ...sources[0], sourceKind: "body" }] })).toBe("ungrounded_fact");
    expect(reason("모델 기준일은 2026-10-26입니다.")).not.toBeNull();
    expect(STOCK_SENTENCE_FORMS.examples).toContain("해당 기사는 {approvedTopic}를 다룬 기사입니다.");
  });
  it("checks local observed market fields, directions, units and futures contracts", () => {
    const market = [{ id: "NASDAQ", name: "나스닥", status: "ok", value: 100, change: -1, changePct: -1, unit: "pt" },
      { id: "UST10Y", name: "미 국채 10년물", status: "ok", value: 4.2, change: -.002, changePct: -.05, unit: "%" },
      { id: "KOSPI200_FOREIGN_FUTURES", name: "코스피200 선물 외국인 순매수", status: "ok", value: 670, change: 0, changePct: null, unit: "계약", fiveDaySum: 4218, consecutiveDays: 4 }];
    const data = { ...context, market, citations: [...context.citations, ...market.map(row => `M:${row.id}`)] };
    for (const text of ["나스닥 전일 대비 -1%입니다.", "금리 전일 대비 -0.002%p입니다.", "외국인 선물 최근 5거래일 합계 4,218계약 순매수입니다.", "선물 외국인은 4거래일 연속 순매수입니다."]) expect(reason(text, data), text).toBeNull();
    for (const text of ["나스닥 전일 대비 1%입니다.", "금리 전일 대비 -1%p입니다.", "선물 외국인 직전일 4,218계약 순매수입니다.", "외국인 선물 최근 5거래일 합계 670계약 순매수입니다.", "선물 외국인은 4거래일 연속 순매도입니다.", "나스닥은 좋아질 것입니다."]) expect(reason(text, data), text).not.toBeNull();
  });
  it("requires completed source event clauses rather than a cancelled/planned event noun", () => {
    const sentence = "공시를 발표했다고 보도했습니다.", news = { ...context, field: "news" };
    for (const text of ["공시 발표 취소", "공시를 발표하지 않았습니다.", "공시 발표 예정", "공시를 발표했습니다. 이는 사실이 아닙니다."]) {
      expect(checkStockSentence(sentence, { ...news, sources: [{ ...sources[0], sourceKind: "body", text }] }).accepted).toBe(false);
    }
    expect(checkStockSentence(sentence, { ...news, sources: [{ ...sources[0], sourceKind: "body", text: "공시를 발표했습니다." }] }).accepted).toBe(true);
  });
});

describe("additional gate in both production sentence validators", () => {
  const input = { model: null, macro: { indicators: [], preOpen: [] }, stocks: [{ ...stock, news: { status: "collected", articles: [{ id: sources[0].articleId, title: sources[0].text, source: sources[0].publisher, url: "https://paper.example/a" }] } }] };
  it.each(attacks)("rejects the design attack in opinion and news: %s", text => {
    expect(stockOpinionSentenceReason(text, input, 0)).not.toBeNull(); expect(headlineSentenceReason(text, input, 0)).not.toBeNull();
  });
  it("preserves the direction exception exclusively in marketOutlook", () => {
    const data = { ...input, macro: { indicators: [], preOpen: [{ id: "NASDAQ", name: "나스닥", status: "ok", value: 100, change: 1, changePct: 1, unit: "pt", history: [] }] } };
    expect(validateMarketOutlook({ stance: "상승 우위", text: "나스닥 관측을 바탕으로 코스피 장 초반은 상승 우위로 판단합니다.", citations: ["M:NASDAQ"] }, data)).toBeNull();
  });
});

describe("01:54 pinned fixture, read-only replay", () => {
  it("matches the design's opinion 10/20 and news 1/15 table sentence by sentence", () => {
    const before = JSON.stringify(replay), data = structuredClone(replay); const summary = {};
    expect(data.sourceHash).toBe("a2942b80046d7ff06e96ab917a9ce9685f3cfbc855b5389be063009aca179735");
    for (const [key, field] of [["stockOpinions", "opinion"], ["newsSummaries", "news"]]) {
      const results = [];
      for (const [i, row] of data.rawFields[key].entries()) {
        const input = { field, stock: data.input.stocks[i], citations: row.citations, articleCount: data.input.stocks[i].news.articles.length,
          sources: data.input.stocks[i].news.articles.map(article => ({ articleId: article.id, sourceKind: "title", publisher: article.source, text: article.title })), baseDate: data.input.model.baseDate, today: "2026-10-28" };
        for (const [j, sentence] of row.text.split(/(?<=[.!?。])\s+/).entries()) {
          const result = checkStockSentence(sentence, input), expected = field === "opinion" ? j === 0 || j === 3 : i === 0 && j === 2;
          expect(result.accepted, `${key}:${row.code}:${j + 1} ${result.reason}`).toBe(expected);
          results.push({ code: row.code, sentence: j + 1, accepted: result.accepted, reason: result.reason });
        }
      }
      summary[key] = { accepted: results.filter(row => row.accepted).length, total: results.length, results };
    }
    expect(summary.stockOpinions).toMatchObject({ accepted: 10, total: 20 }); expect(summary.newsSummaries).toMatchObject({ accepted: 1, total: 15 });
    expect(JSON.stringify(replay)).toBe(before);
    console.info("[sentence allowlist offline replay]", JSON.stringify(summary));
  });
});
