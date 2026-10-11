import type { CandidateData } from "../../entities/candidate";
import { useQueries, useQuery } from "@tanstack/react-query";
import { queries } from "../../shared/api/queries";
import { formatDate, formatSessionDate, formatWon } from "../../shared/lib/format";
import { PredictionDirection } from "./PredictionDirection";
import { safeArticleUrl } from "../stock/reportData";
import { isRelatedArticle } from "../../shared/lib/relatedArticles";
import { WatchToggle } from "../watchlist/WatchToggle";

export function modelTopFive(rows: readonly CandidateData[]) {
  return rows.filter(row => row.rank !== null && Number.isInteger(row.rank) && row.rank >= 1)
    .sort((left, right) => left.rank! - right.rank! || left.code.localeCompare(right.code)).slice(0, 5);
}

export function predictionPeriod(row: Pick<CandidateData, "predictionTarget">, nextSession?: string | null): string {
  if (row.predictionTarget !== "next_session_open_to_close") return "예측 기간 미확인";
  return nextSession ? `${formatSessionDate(nextSession)} 시가→종가` : "다음 거래일 시가→종가";
}
/** Next KRX session after a base date (KIS calendar); undefined while unknown. */
export function useNextSession(baseDate: string | null | undefined) {
  return useQuery({ ...queries.nextSession(baseDate ?? ""), enabled: Boolean(baseDate && /^\d{4}-\d{2}-\d{2}$/.test(baseDate)) });
}

export function RelatedArticles({ candidate }: { candidate: CandidateData }) {
  const articles = candidate.news.filter(article => isRelatedArticle(article.title, candidate.name) && safeArticleUrl(article.url)).slice(0, 3);
  return <div className="briefing-related-news"><h3>관련 기사</h3>{articles.length ? <ul>{articles.map((article, index) => <li key={index}>
    <a href={safeArticleUrl(article.url)!} target="_blank" rel="noopener noreferrer">{article.title}</a>
    <small>{article.source || "매체 미확인"} · {article.publishedAt ? formatDate(article.publishedAt, true) : "발행 시각 미확인"}{new URL(safeArticleUrl(article.url)!).hostname === "news.google.com" && " · Google News 경유"}</small>
  </li>)}</ul> : <p className="briefing-muted" role="status">{candidate.newsStatus === "collection_failed" ? "기사 수집 실패 · 다시 분석하면 재수집합니다." : candidate.newsStatus === "collected" && candidate.newsCollected ? "최근 7일 검색에서 관련 기사 0건" : "현재 분석의 기사 수집 기록 없음"}</p>}</div>;
}

export function ModelTopFiveList({ rows, selectedCode, onSelect }: { rows: CandidateData[]; selectedCode: string | null; onSelect: (code: string, reason?: "pointer" | "keyboard") => void }) {
  const sessionBase = rows[0]?.baseDate ?? null, nextSession = useNextSession(sessionBase).data;
  const quotes = useQueries({ queries: rows.map(row => ({ ...queries.quote(row.code), retry: false, staleTime: 30_000, refetchOnMount: false })) });
  return <ol className="briefing-top-five" aria-label="모델 예측 순위 TOP5">{rows.map((row, index) => {
    const quote = quotes[index], price = quote.isError || quote.data?.source === "sample" ? null : quote.data?.data;
    return <li key={row.code} data-model-code={row.code} data-selected={row.code === selectedCode ? "true" : undefined}>
      <div className="briefing-top-stock"><span className="briefing-top-rank">{String(row.rank).padStart(2, "0")}</span>
        <button type="button" className="briefing-stock-button" aria-label={row.name + " " + row.code + (row.code === selectedCode ? " · 선택됨" : "") + " 상세 보기"} aria-pressed={row.code === selectedCode} onClick={() => onSelect(row.code)} onKeyDown={event => {
          const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index + offset;
          if (!offset && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault(); const next = rows[Math.max(0, Math.min(rows.length - 1, nextIndex))]; onSelect(next.code, "keyboard");
          event.currentTarget.closest("ol")?.querySelector<HTMLButtonElement>('[data-model-code="' + next.code + '"] .briefing-stock-button')?.focus();
        }}><strong>{row.name ?? "종목명 미확인"}</strong>{" "}<small>{row.code}</small></button><WatchToggle code={row.code} name={row.name} />
      </div>
      <div className="briefing-top-prediction"><span>모델 예측</span><strong><PredictionDirection value={row.predictedReturn} /></strong><small>{predictionPeriod(row, row.baseDate === sessionBase ? nextSession : null)} · 기준일 {formatDate(row.baseDate)}</small>{row.predictedReturn === null && <small>원본 예측값 없음</small>}</div>
      <div className="briefing-top-price"><span>현재가</span><strong>{quote.isPending ? "조회 중" : formatWon(price?.currentPrice)}</strong><small>{quote.isError ? "가격 조회 실패" : quote.data?.source === "sample" ? "실제 가격 없음" : "시세 기준 " + formatDate(quote.data?.asOf, true)}</small></div>
      <RelatedArticles candidate={row} />
    </li>;
  })}</ol>;
}
