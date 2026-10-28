import { describe, expect, it } from "vitest";
import { stockOpinionSentenceReason } from "../../server/stockOpinion";
import { headlineSentenceReason, validateMarketOutlook } from "../../server/briefingExtensions";
import { stockNameAliases } from "../../server/stockNewsLanguage";
const data = { model: null, macro: { indicators: [], preOpen: [{ id: "NASDAQ", name: "나스닥", status: "ok", unit: "pt", value: 100, change: 1, changePct: 1, fiveDayChange: 2, fiveDayChangePct: 2, history: [] }] }, stocks: [{ code: "005930", name: "삼성전자", rank: 1, rankScore: 1.7, poolSize: 200, topPercent: .5, evidence: [{ id: "E:005930:1", kind: "model", text: "모델 순위 1위입니다." }], cautions: [], news: { articles: [{ id: "N:005930:1", title: "삼성전자 공시 발표", source: "가일보", url: "https://paper.example/a" }] } }] };
const bad = ["순위 1위 종목으로 급등 가능성이 큽니다.", "저평가 상태이며 상방 여지가 있습니다.", "주가가 좋아질 수 있습니다.", "삼성전자가 급등할 가능성이 있다고 보도했습니다.", "저평가 상태라고 보도했습니다.", "주가가 좋아질 수 있다고 보도했습니다.",
  ...["급등", "급락", "오름세", "내림세", "저평가", "고평가", "상방", "하방", "랠리", "돌파", "overweight", "underweight", "지지선", "저항선", "과열", "바닥", "반등", "추가 상승", "추가 하락", "모멘텀", "목표 주가", "저점 매수", "고점 매수", "bullish", "bearish", "upside", "downside", "outperform", "underperform", "rally", "breakout"].map(term => `${term} 상태라고 보도했습니다.`),
  "주가가 좋아질 전망입니다.", "실적이 개선될 것이라고 보도했습니다.", "상 승 할 것이라고 보도했습니다.", "주가가 좋아질 수 있어 보입니다.", "코스피 시장은 좋아질 가능성이 있습니다.", "하이닉스 관련 내용입니다.", "에너지솔루션 관련 내용입니다.", "상·방 여지가 있습니다.", "ｂｕｌｌｉｓｈ 입니다.", "매·수 하세요.", "기·회입니다.", "유·망하다고 보도했습니다.", "주. 가가 좋. 아질 수 있습니다.", "계속 보유하세요.", "담는 것이 좋습니다."];
describe("reviewed stock/news language boundary", () => {
  it.each(bad)("rejects both stock opinion and news sentence: %s", text => {
    expect(stockOpinionSentenceReason(text, data, 0)).not.toBeNull(); expect(headlineSentenceReason(text, data, 0)).not.toBeNull();
  });
  it.each(["모델 순위 1위이며 순위 점수는 1.7입니다.", "입력 근거 1건을 확인했습니다."])("retains a grounded stock fact: %s", text => expect(stockOpinionSentenceReason(text, data, 0)).toBeNull());
  it.each(["공시 내용을 다룬 기사입니다.", "공시를 발표했다고 보도했습니다."])("retains neutral article attribution: %s", text => expect(headlineSentenceReason(text, data, 0)).toBeNull());
  it("preserves marketOutlook's explicit direction exception", () => {
    expect(validateMarketOutlook({ stance: "상승 우위", text: "코스피 시장 장 초반은 상승 우위로 출발할 가능성이 있습니다.", citations: ["M:NASDAQ"] }, data)).toBeNull();
  });
  it("allows own generated aliases and excludes short ambiguous group-stripped aliases", () => {
    expect(stockNameAliases("SK하이닉스")).toContain("하이닉스"); expect(stockNameAliases("LG에너지솔루션")).toContain("에너지솔루션");
    expect(stockNameAliases("삼성전자")).not.toContain("전자");
    const own = { ...data, stocks: [{ ...data.stocks[0], code: "000660", name: "SK하이닉스" }] };
    expect(stockOpinionSentenceReason("하이닉스의 모델 순위 1위입니다.", own, 0)).toBeNull();
    expect(headlineSentenceReason("하이닉스의 공시를 다룬 기사입니다.", own, 0)).toBeNull();
  });
});
