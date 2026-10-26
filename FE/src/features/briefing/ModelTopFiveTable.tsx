import type { CandidateData } from "../../entities/candidate";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { queries, queryKeys } from "../../shared/api/queries";
import { formatDate, formatPercent, formatSessionDate, formatWon } from "../../shared/lib/format";
import { PredictionDirection } from "./PredictionDirection";
import { TopFiveSparkline } from "./TopFiveSparkline";
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

interface RelatedArticleItem {
  key: string;
  url: string;
  title: string | null;
  meta: string;
}

function renderArticleItem(item: RelatedArticleItem) {
  return (
    <li key={item.key}>
      <a href={item.url} target="_blank" rel="noopener noreferrer" title={item.title ?? undefined}>{item.title}</a>
      <small>{item.meta}</small>
    </li>
  );
}

export function RelatedArticles({ candidate }: { candidate: CandidateData }) {
  const items: RelatedArticleItem[] = [];
  const seenUrls = new Set<string>();
  for (const article of candidate.news) {
    if (!isRelatedArticle(article.title, candidate.name)) continue;
    const url = safeArticleUrl(article.url);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    let isGoogleNews = false;
    try {
      isGoogleNews = new URL(url).hostname === "news.google.com";
    } catch { /* safeArticleUrl로 이미 검증된 URL이라 도달하지 않는다. */ }
    const meta = [
      article.source,
      article.publishedAt ? formatDate(article.publishedAt, true) : null,
      isGoogleNews ? "Google News 경유" : null,
    ].filter(Boolean).join(" · ");
    items.push({ key: url, url, title: article.title, meta });
    if (items.length >= 3) break;
  }

  if (!items.length) {
    return (
      <div className="briefing-related-news">
        <h3>관련 기사</h3>
        <p className="briefing-muted" role="status">
          {candidate.newsStatus === "collection_failed"
            ? "기사 수집 실패 · 다시 분석하면 재수집합니다."
            : candidate.newsStatus === "collected" && candidate.newsCollected
            ? "최근 7일 검색에서 관련 기사 0건"
            : "현재 분석의 기사 수집 기록 없음"}
        </p>
      </div>
    );
  }

  const firstArticle = items[0];
  const moreArticles = items.slice(1);

  return (
    <div className="briefing-related-news">
      <h3>관련 기사</h3>
      <ul>{renderArticleItem(firstArticle)}</ul>
      {moreArticles.length > 0 && (
        <details>
          <summary>
            <span>기사 {moreArticles.length}건 더 보기</span>
            <ChevronDown aria-hidden="true" size={14} />
          </summary>
          <ul>{moreArticles.map(renderArticleItem)}</ul>
        </details>
      )}
    </div>
  );
}

export function ModelTopFiveList({ rows, selectedCode, onSelect, renderEvidence }: { rows: CandidateData[]; selectedCode: string | null; onSelect: (code: string, reason?: "pointer" | "keyboard") => void; renderEvidence?: (code: string) => ReactNode }) {
  const queryClient = useQueryClient();
  const [focusedCode, setFocusedCode] = useState(selectedCode);
  useEffect(() => setFocusedCode(selectedCode), [selectedCode]);
  const entryCode = rows.some(row => row.code === selectedCode) ? selectedCode : rows[0]?.code;
  const tabCode = rows.some(row => row.code === focusedCode) ? focusedCode : entryCode;
  const sessionBase = rows[0]?.baseDate ?? null, nextSession = useNextSession(sessionBase).data;
  const quotes = useQueries({ queries: rows.map(row => ({ ...queries.quote(row.code), retry: false, staleTime: 30_000, refetchOnMount: false })) });

  // 차트 활성화 우선순위: 선택 종목 최우선, 나머지 순위 순
  const priorityCodes = useMemo(() => {
    if (!rows.length) return [];
    const primary = rows.find(r => r.code === selectedCode)?.code ?? rows[0]?.code;
    return [primary, ...rows.map(r => r.code).filter(c => c !== primary)].filter(Boolean) as string[];
  }, [rows, selectedCode]);

  // 완료 여부 판정: 데이터가 있거나 에러로 끝났으면 완료
  const isQueryDone = (code: string) => {
    const state = queryClient.getQueryState(queryKeys.chart(code, "1M"));
    return state?.data !== undefined || state?.status === "error" || state?.status === "success";
  };

  // 완료되지 않은 첫 번째 종목만 enabled 후보로 도출 (포인터/이벤트 없이 매 렌더마다 상태에서 도출)
  let activeCandidateCode: string | null = null;
  for (const code of priorityCodes) {
    if (!isQueryDone(code)) {
      activeCandidateCode = code;
      break;
    }
  }

  // useQueries로 1M 차트 쿼리를 반응형으로 구독하여 캐시 유입/상태 변경 시 리렌더링 보장
  const chartQueries = useQueries({
    queries: rows.map(row => {
      const hasData = queryClient.getQueryData(queryKeys.chart(row.code, "1M")) !== undefined;
      const isEnabled = hasData || row.code === activeCandidateCode;
      return {
        ...queries.chart(row.code, "1M"),
        enabled: isEnabled,
        notifyOnChangeProps: "all" as const,
        retry: false,
        staleTime: 30_000,
      };
    }),
  });

  const validScores = rows
    .map(r => r.rankScore)
    .filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  const minScore = validScores.length ? Math.min(...validScores) : 0;
  const maxScore = validScores.length ? Math.max(...validScores) : 0;

  return <ol className="briefing-top-five" aria-label="모델 순위 TOP5" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedCode(entryCode ?? null); }}>{rows.map((row, index) => {
    const quote = quotes[index], price = quote.isError || quote.data?.source === "sample" ? null : quote.data?.data;
    const evidence = renderEvidence?.(row.code) ?? null;

    const scorePercent =
      row.rankScore != null && Number.isFinite(row.rankScore)
        ? maxScore > minScore
          ? Math.round(((row.rankScore - minScore) / (maxScore - minScore)) * 100)
          : 100
        : null;

    const score2Decimals =
      row.rankScore != null && Number.isFinite(row.rankScore)
        ? (Object.is(row.rankScore, -0) ? "0.00" : row.rankScore.toFixed(2))
        : "—";

    const roundedChangeRate = price?.changeRate != null ? Number(price.changeRate.toFixed(2)) : null;
    const hasChangeRate = roundedChangeRate != null && Number.isFinite(roundedChangeRate);
    const changeDir =
      roundedChangeRate == null || Object.is(roundedChangeRate, 0) || Object.is(roundedChangeRate, -0)
        ? "flat"
        : roundedChangeRate > 0
        ? "rise"
        : "fall";

    const hasChartData = queryClient.getQueryData(queryKeys.chart(row.code, "1M")) !== undefined;
    const isSparklineEnabled = hasChartData || row.code === activeCandidateCode;

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

      <div className="briefing-top-price">
        <span>현재가</span>
        <div className="briefing-top-price-row">
          <strong className="briefing-top-price-value">{quote.isPending ? "조회 중" : formatWon(price?.currentPrice)}</strong>
          {hasChangeRate && (
            <span className={`briefing-top-change is-${changeDir}`}>
              {formatPercent(roundedChangeRate, "percent", 2)}
            </span>
          )}
        </div>
        <small>{quote.isError ? "가격 조회 실패" : quote.data?.source === "sample" ? "실제 가격 없음" : "시세 기준 " + formatDate(quote.data?.asOf, true)}</small>
      </div>

      <div className="briefing-top-sparkline-cell">
        <TopFiveSparkline
          code={row.code}
          enabled={isSparklineEnabled}
          query={chartQueries[index]}
        />
      </div>

      <div className="briefing-top-prediction">
        <span>{row.scoreKind === "rank_zscore" ? "순위 점수" : "모델 예측"}</span>
        {row.scoreKind === "rank_zscore" ? (
          <div className="briefing-top-score-row">
            <strong className="briefing-top-score-value">
              <span className="prediction-direction" data-direction="relative" title="비교 종목 내 상대 순위 점수">
                {score2Decimals}
              </span>
            </strong>
            {scorePercent != null && (
              <span className="briefing-top-score-bar" role="presentation" title={`TOP5 내 상대 순위 점수 위치 (${scorePercent}%)`}>
                <span className="briefing-top-score-bar-fill" style={{ width: `${Math.max(6, scorePercent)}%` }} />
              </span>
            )}
          </div>
        ) : (
          <strong><PredictionDirection value={row.predictedReturn} rankScore={row.rankScore} scoreKind={row.scoreKind} /></strong>
        )}
        <small>{predictionPeriod(row, row.baseDate === sessionBase ? nextSession : null)} · 기준일 {formatDate(row.baseDate)}</small>
        {row.predictedReturn === null && row.rankScore == null && <small>{row.scoreKind === "rank_zscore" ? "순위 점수 없음" : "원본 예측값 없음"}</small>}
      </div>

      {evidence ?? <RelatedArticles candidate={row} />}
    </li>;
  })}</ol>;
}
