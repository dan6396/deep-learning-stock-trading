import { expect, it } from "vitest";
import { analysisProgressText, visibleAnalysisText } from "./analysisDisplay";
import { aiCandidates } from "../../data/aiCandidates";

it("hides retired evidence prose without changing model text or its input", () => {
  const original = "모델 예측은 1.25%입니다. 외국인·기관 수급은 순매도입니다. 예측은 실제 성과가 아닙니다.";
  expect(visibleAnalysisText(original)).toBe("모델 예측은 1.25%입니다. 예측은 실제 성과가 아닙니다.");
  expect(original).toContain("외국인·기관 수급");
  expect(visibleAnalysisText("기관 순매수 흐름입니다.")).toBe("");
  expect(visibleAnalysisText(null)).toBe("");
});
it("uses a neutral progress message for retired server stages", () => {
  expect(analysisProgressText("외국인·기관 수급 조회 중")).toBe("서버에서 분석을 진행하고 있습니다.");
  expect(analysisProgressText("모델 추론 중")).toBe("모델 추론 중");
});
it("preserves ordinary institution and foreign participant sentences", () => {
  const text = "금융기관 협약을 체결했습니다. 전문기관 연구 결과를 공개했습니다. 외국인 고객 대상 서비스를 확대합니다.";
  expect(visibleAnalysisText(text)).toBe(text);
  expect(analysisProgressText("전문기관 연구 결과 확인 중")).toBe("전문기관 연구 결과 확인 중");
  expect(visibleAnalysisText(`${text} 기관의 매도세가 이어집니다. 외국인 자금 유입이 늘었습니다.`)).toBe(text);
  for (const ordinary of ["기관 리포트에서 매수 의견을 제시했습니다.", "기관이 부지 매수 계약을 체결했습니다.", "삼성생명의 삼성전자 지분율을 공개했습니다."]) expect(visibleAnalysisText(ordinary)).toBe(ordinary);
});
it("removes investor trading commentary from every saved sample without changing raw records or articles", () => {
  const original = JSON.stringify(aiCandidates);
  const expected = new Map([
    ["000270", ["기아는 환율 효과, 친환경차 제품 믹스 개선, EV3 신차 효과 등으로 견조한 판매 성장과 실적 기대감을 높이고 있습니다.", "강력한 전기차 모멘텀과 애널리스트의 긍정적 전망은 단기 주가 상승 동력을 제공할 것으로 보입니다."]],
    ["005490", ["", ""]],
    ["007660", ["이수페타시스는 최근 AI 반도체 산업 성장과 함께 주요 자산운용사의 ETF 편입 및 하반기 실적 개선 기대로 긍정적인 평가를 받고 있습니다.", ""]],
  ]);
  for (const candidate of aiCandidates) {
    const [summary, insight] = expected.get(candidate.ticker) ?? [candidate.summary, candidate.tradingInsight];
    expect(visibleAnalysisText(candidate.summary), `${candidate.ticker} summary`).toBe(summary);
    expect(visibleAnalysisText(candidate.tradingInsight), `${candidate.ticker} insight`).toBe(insight);
  }
  expect(JSON.stringify(aiCandidates)).toBe(original);
});
