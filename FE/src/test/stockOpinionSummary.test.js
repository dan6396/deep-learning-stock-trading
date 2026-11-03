import { describe, expect, it } from "vitest";
import { integratedStockOpinion } from "../../server/stockOpinionSummary";

const base = { code: "005930", rank: 1, poolSize: 200 };
const outlook = (stance, text = "나스닥은 전일 1.2% 상승 마감했습니다. 원/달러 환율은 5일 동안 보합 흐름입니다.", source = "llm") => ({ stance, text, citations: ["M:NASDAQ", "M:USDKRW"], source });
const news = { code: "005930", source: "llm", text: "해당 기사는 신규 반도체 설비 투자 계획을 다뤘습니다. 다른 기사는 분기 실적 발표 일정을 전했습니다.", citations: ["N:005930:1", "N:005930:2"] };
const opinion = { code: "005930", source: "llm", text: "모집단 200개 중 모델 순위 1위입니다. 20일·120일 모델은 일치 상태입니다. 상대강도 지표는 상위 12%입니다.", citations: ["R:005930", "R:005930:20", "R:005930:120", "E:005930:feature:f_rsi"] };
const CAUSAL = /때문|덕분|영향으로|인해|따라서|그래서|힘입어/;

describe("integrated stock opinion", () => {
  it("opens with the transformer rank and quotes the briefing market stance in one paragraph", () => {
    const result = integratedStockOpinion({ ...base, outlook: outlook("중립"), news, opinion, generatedAt: "2026-11-03T00:00:00Z" });
    expect(result.text.startsWith("트랜스포머 모델 순위는 전체 200개 종목 중 1위이며, 브리핑 기준 현재 시장은 '중립' 의견입니다.")).toBe(true);
    expect(result.text).toContain("시장 의견을 보면, 나스닥은 전일 1.2% 상승 마감했습니다.");
    expect(result.text).toContain("한편 관련 뉴스를 보면, 해당 기사는 신규 반도체 설비 투자 계획을 다뤘습니다.");
    expect(result.text).toContain("또한 20일·120일 모델은 일치 상태입니다.");
    expect(result.text).not.toMatch(/\n/);
    expect(result.text).not.toMatch(CAUSAL);
    expect(result.source).toBe("llm");
    expect(result.generatedAt).toBe("2026-11-03T00:00:00Z");
    expect(result.citations).toEqual(expect.arrayContaining(["R:005930", "M:NASDAQ", "N:005930:1", "R:005930:20"]));
  });

  it("uses a contrast connector only for a diverging market stance", () => {
    expect(integratedStockOpinion({ ...base, outlook: outlook("하락 우위") }).text).toMatch(/^트랜스포머 모델 순위는 전체 200개 종목 중 1위이나, 브리핑 기준 현재 시장은 '하락 우위' 의견입니다\./);
    expect(integratedStockOpinion({ ...base, outlook: outlook("상승 우위") }).text).toMatch(/1위이며, 브리핑 기준 현재 시장은 '상승 우위' 의견입니다\./);
    expect(integratedStockOpinion({ ...base, outlook: outlook("판단 보류") }).text).toMatch(/1위이나, 브리핑은 현재 시장 방향 판단을 보류했습니다\./);
  });

  it("strips leading connectors from source sentences so paragraph connectors are not doubled", () => {
    const { text } = integratedStockOpinion({ ...base, news: { ...news, text: "해당 기사는 설비 투자를 다뤘습니다. 한편 다른 기사는 실적 일정을 전했습니다." }, opinion: { ...opinion, text: "또한 20일·120일 모델은 일치 상태입니다." } });
    expect(text).toContain("한편 관련 뉴스를 보면, 해당 기사는 설비 투자를 다뤘습니다. 다른 기사는 실적 일정을 전했습니다.");
    expect(text.match(/한편/g)).toHaveLength(1);
    expect(text.match(/또한/g)).toHaveLength(1);
  });
  it("does not repeat the rank sentence from the stock analysis", () => {
    const { text } = integratedStockOpinion({ ...base, opinion });
    expect(text.match(/1위/g)).toHaveLength(1);
  });

  it("drops causal or advisory sentences instead of linking facts causally", () => {
    const causal = { ...news, text: "반도체 수요 회복 때문에 실적이 개선됐습니다. 해당 기사는 신규 설비 투자 계획을 다뤘습니다." };
    const advice = { ...opinion, text: "매수를 권합니다. 20일·120일 모델은 일치 상태입니다." };
    const marketCausal = outlook("중립", "금리 하락에 힘입어 증시가 오를 것입니다. 나스닥은 전일 1.2% 상승 마감했습니다.");
    const { text } = integratedStockOpinion({ ...base, outlook: marketCausal, news: causal, opinion: advice });
    expect(text).not.toMatch(CAUSAL);
    expect(text).not.toMatch(/매수|권합니다/);
    expect(text).toContain("해당 기사는 신규 설비 투자 계획을 다뤘습니다.");
    expect(text).toContain("나스닥은 전일 1.2% 상승 마감했습니다.");
  });

  it("omits missing parts naturally and falls back to a template source", () => {
    const onlyRank = integratedStockOpinion({ ...base, opinion: { ...opinion, source: "template", text: "입력 근거 1건·주의 0건·기사 2건이 확인됩니다." } });
    expect(onlyRank).toEqual({ source: "template", text: "트랜스포머 모델 순위는 전체 200개 종목 중 1위입니다.", citations: ["R:005930"] });
    const templateNews = integratedStockOpinion({ ...base, news: { ...news, source: "template" }, outlook: outlook("중립", "장전 지표를 확인했습니다.", "template") });
    expect(templateNews.text).not.toContain("관련 뉴스");
    expect(templateNews.source).toBe("template");
    expect(templateNews.citations).not.toContain("N:005930:1");
  });

  it("never states a direction for the stock itself", () => {
    const { text } = integratedStockOpinion({ ...base, outlook: outlook("상승 우위"), news, opinion });
    expect(text).not.toMatch(/(?:종목|주가|삼성전자)[^.]{0,20}(?:상승|하락|오를|내릴)/);
  });
});
