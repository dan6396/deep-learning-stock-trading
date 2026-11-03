import type { StockAiOpinion } from "../../entities/stockInsight";
import { formatDate } from "../../shared/lib/format";
import { CollapsibleNote } from "./StockInsightSection";
import { StockCitationChips, type OpinionCitationTarget } from "./StockCitationChips";
import "./stockInsight.css";

/** 모델 순위·브리핑 시장 의견·뉴스 요약·종목 분석을 한 문단으로 보여 준다. 근거 카드는 아래에 따로 남는다. */
export function StockAiOpinionCard({ opinion, targets }: { opinion?: StockAiOpinion; targets: Map<string, OpinionCitationTarget> }) {
  if (!opinion) return null;
  const title = opinion.source === "llm" ? "AI 최종 의견" : "모델·근거 요약";
  return <section className="report-card report-ai-opinion-card" aria-labelledby="report-ai-opinion-title">
    <h2 id="report-ai-opinion-title">{title}</h2>
    <p className="stock-ai-opinion-notice">{opinion.source === "llm" ? "AI 종합 의견" : "참고 요약"} · 투자 권유 아님 · 종목 방향 판단 아님</p>
    <CollapsibleNote className="stock-ai-summary" collapsedLines={5} text={opinion.text} />
    <div className="stock-ai-opinion-meta report-muted"><span>{opinion.source !== "llm" ? "규칙 기반 기본 안내" : opinion.composition === "ai" ? "AI가 모델 순위·브리핑 시장 의견·뉴스 요약을 종합해 작성" : "AI 요약 문장을 규칙에 따라 연결"}</span>{opinion.generatedAt && <time dateTime={opinion.generatedAt}>생성 시각 {formatDate(opinion.generatedAt, true)} (KST)</time>}</div>
    <StockCitationChips ids={opinion.citations} targets={targets} label={`${title} 인용 근거`} />
  </section>;
}
