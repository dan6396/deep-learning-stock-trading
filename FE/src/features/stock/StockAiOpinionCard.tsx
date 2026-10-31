import type { StockAiOpinion, StockInsight } from "../../entities/stockInsight";
import { formatDate } from "../../shared/lib/format";
import { CollapsibleNote } from "./StockInsightSection";
import { StockNewsSummary } from "./StockNewsCard";
import { StockCitationChips, type OpinionCitationTarget } from "./StockCitationChips";
import "./stockInsight.css";

export function StockAiOpinionCard({ opinion, targets, news }: { opinion?: StockAiOpinion; targets: Map<string, OpinionCitationTarget>; news?: StockInsight["news"] }) {
  if (!opinion) return null;
  const title = opinion.source === "llm" ? "AI 최종 의견" : "모델·근거 요약";
  const newsCitations = news?.summary ? news.citations : [];
  return <section className="report-card report-ai-opinion-card" aria-labelledby="report-ai-opinion-title">
    <h2 id="report-ai-opinion-title">{title}</h2>
    <p className="stock-ai-opinion-notice">{opinion.source === "llm" ? "AI 의견" : "참고 요약"} · 투자 권유 아님 · 방향 판단 아님</p>
    <CollapsibleNote className="stock-ai-summary" collapsedLines={5} text={opinion.text} />
    <div className="stock-ai-opinion-meta report-muted"><span>{opinion.source === "llm" ? "AI 요약" : "규칙 기반 기본 안내"}</span>{opinion.generatedAt && <time dateTime={opinion.generatedAt}>생성 시각 {formatDate(opinion.generatedAt, true)} (KST)</time>}</div>
    <StockCitationChips ids={opinion.citations.filter(id => !newsCitations.includes(id))} targets={targets} label={`${title} 인용 근거`} />
    {news?.summary && <StockNewsSummary news={news} targets={targets} />}
  </section>;
}
