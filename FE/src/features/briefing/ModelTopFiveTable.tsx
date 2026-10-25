import type { CandidateData } from "../../entities/candidate";
import { useEffect, useState } from "react";
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
  const articles = [...new Map(candidate.news.filter(article => isRelatedArticle(article.title, candidate.name) && safeArticleUrl(article.url)).map(article => [safeArticleUrl(article.url)!, article])).values()].slice(0, 3);
  return <div className="briefing-related-news"><h3>관련 기사</h3>{articles.length ? <ul>{articles.map(article => <li key={safeArticleUrl(article.url)!}>
    <a href={safeArticleUrl(article.url)!} target="_blank" rel="noopener noreferrer" title={article.title ?? undefined}>{article.title}</a>
    <small>{[article.source, article.publishedAt ? formatDate(article.publishedAt, true) : null, new URL(safeArticleUrl(article.url)!).hostname === "news.google.com" ? "Google News 경유" : null].filter(Boolean).join(" · ")}</small>
  </li>)}</ul> : <p className="briefing-muted" role="status">{candidate.newsStatus === "collection_failed" ? "기사 수집 실패 · 다시 분석하면 재수집합니다." : candidate.newsStatus === "collected" && candidate.newsCollected ? "최근 7일 검색에서 관련 기사 0건" : "현재 분석의 기사 수집 기록 없음"}</p>}</div>;
}

export function ModelTopFiveList({ rows, selectedCode, onSelect }: { rows: CandidateData[]; selectedCode: string | null; onSelect: (code: string, reason?: "pointer" | "keyboard") => void }) {
  const [focusedCode, setFocusedCode] = useState(selectedCode);
  useEffect(() => setFocusedCode(selectedCode), [selectedCode]);
  const entryCode = rows.some(row => row.code === selectedCode) ? selectedCode : rows[0]?.code;
  const tabCode = rows.some(row => row.code === focusedCode) ? focusedCode : entryCode;
  const sessionBase = rows[0]?.baseDate ?? null, nextSession = useNextSession(sessionBase).data;
  const quotes = useQueries({ queries: rows.map(row => ({ ...queries.quote(row.code), retry: false, staleTime: 30_000, refetchOnMount: false })) });
  return <ol className="briefing-top-five" aria-label="모델 순위 TOP5" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedCode(entryCode ?? null); }}>{rows.map((row, index) => {
    const quote = quotes[index], price = quote.isError || quote.data?.source === "sample" ? null : quote.data?.data;
    return <li key={row.code} data-model-code={row.code} data-selected={row.code === selectedCode ? "true" : undefined}>
      <div className="briefing-top-stock"><span className="briefing-top-rank">{String(row.rank).padStart(2, "0")}</span>
        <button type="button" className="briefing-stock-button" tabIndex={row.code === tabCode ? 0 : -1} onFocus={() => setFocusedCode(row.code)} aria-label={(row.name ?? "종목명 미확인") + " " + row.code + " 상세 보기"} aria-pressed={row.code === selectedCode} onClick={() => onSelect(row.code)} onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.code, "keyboard"); return; }
          const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index + offset;
          if (!offset && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault(); const next = rows[Math.max(0, Math.min(rows.length - 1, nextIndex))];
          event.currentTarget.closest("ol")?.querySelector<HTMLButtonElement>('[data-model-code="' + next.code + '"] .briefing-stock-button')?.focus();
        }}><strong>{row.name ?? "종목명 미확인"}</strong>{" "}<small>{row.code}</small></button><WatchToggle code={row.code} name={row.name} />
      </div>
      <div className="briefing-top-prediction"><span>{row.scoreKind === "rank_zscore" ? "순위 점수" : "모델 예측"}</span><strong><PredictionDirection value={row.predictedReturn} rankScore={row.rankScore} scoreKind={row.scoreKind} /></strong><small>{predictionPeriod(row, row.baseDate === sessionBase ? nextSession : null)} · 기준일 {formatDate(row.baseDate)}</small>{row.predictedReturn === null && row.rankScore == null && <small>{row.scoreKind === "rank_zscore" ? "순위 점수 없음" : "원본 예측값 없음"}</small>}</div>
      <div className="briefing-top-price"><span>현재가</span><strong>{quote.isPending ? "조회 중" : formatWon(price?.currentPrice)}</strong><small>{quote.isError ? "가격 조회 실패" : quote.data?.source === "sample" ? "실제 가격 없음" : "시세 기준 " + formatDate(quote.data?.asOf, true)}</small></div>
      <RelatedArticles candidate={row} />
    </li>;
  })}</ol>;
}
