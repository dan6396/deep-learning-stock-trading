import { ExternalLink } from "lucide-react";
import type { CandidateNews } from "../../entities/candidate";
import type { StockInsight } from "../../entities/stockInsight";
import { formatDate } from "../../shared/lib/format";
import { safeArticleUrl } from "./reportData";
import { CollapsibleNote } from "./StockInsightSection";
import { StockCitationChips, type OpinionCitationTarget } from "./StockCitationChips";

export type ReportNewsArticle = { article: CandidateNews; citationIds: string[]; targetId: string };

export function reportNewsArticles(code: string, raw: CandidateNews[], news?: StockInsight["news"]): ReportNewsArticle[] {
  const articles = raw.map((article, index) => ({ article, citationIds: [] as string[], targetId: `stock-news-${code}-${index + 1}` }));
  for (const article of news?.articles ?? []) {
    const match = articles.find(row => safeArticleUrl(row.article.url) === article.url);
    if (match) match.citationIds.push(article.id);
    else articles.push({ article: { title: article.title, url: article.url, source: article.source, publishedAt: article.pubDate, sentiment: null }, citationIds: [article.id], targetId: `stock-news-${code}-${articles.length + 1}` });
  }
  return articles;
}

export function StockNewsSummary({ news, targets }: { news: StockInsight["news"]; targets: Map<string, OpinionCitationTarget> }) {
  if (!news.summary) return null;
  return <div className="report-news-summary">
    <h3>관련 뉴스 요약</h3>
    <p className="report-muted">{news.summarySource === "llm" ? `AI 요약 · ${news.summaryBasis === "body" ? "기사 본문 기반" : news.summaryBasis === "excerpt" ? "발췌 기반" : "제목 기반"}` : "규칙 기반 기본 안내"}</p>
    <CollapsibleNote className="stock-ai-summary" text={news.summary} />
    <StockCitationChips ids={news.citations} targets={targets} label="뉴스 요약 인용 근거" />
  </div>;
}

export function StockNewsCard({ articles, news, targets, showSummary = true }: { articles: ReportNewsArticle[]; news?: StockInsight["news"]; targets: Map<string, OpinionCitationTarget>; showSummary?: boolean }) {
  return <section className="report-card report-news-card" aria-labelledby="report-news-title">
    <div className="report-section-heading"><h2 id="report-news-title">관련 뉴스</h2></div>
    {showSummary && articles.length > 0 && news && <StockNewsSummary news={news} targets={targets} />}
    {articles.length ? <ul className="report-news">
      {articles.map(({ article, targetId, citationIds }) => {
        const url = safeArticleUrl(article.url);
        return <li key={targetId} id={targetId} className="stock-citation-target" tabIndex={-1} data-stock-citations={citationIds.join(" ")}>
          <div className="report-news-heading"><h3>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{article.title ?? "제목 미확인"}<ExternalLink aria-hidden="true" size={14} /></a> : article.title ?? "제목 미확인"}</h3>
            {article.sentiment && <span className="report-news-sentiment" data-article-sentiment={article.sentiment}>{article.sentiment === "positive" ? "긍정" : article.sentiment === "negative" ? "부정" : "중립"}</span>}
          </div>
          <p className="report-muted">{article.source ?? "발행처 미확인"} · {formatDate(article.publishedAt, true)}{url && new URL(url).hostname === "news.google.com" ? " · Google News 경유" : ""}</p>
          {article.reason && <p>{article.reason}</p>}
          {article.description && <p className="report-muted">{article.description}</p>}
        </li>;
      })}
    </ul> : <p className="report-empty">현재 연결된 관련 기사가 없습니다.</p>}
    {news && <p className="report-muted">{news.limitation}</p>}
  </section>;
}
