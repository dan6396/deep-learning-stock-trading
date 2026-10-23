import { useState } from "react";
import type { BriefingNarrative, BriefingStock } from "../../entities/briefing";
import { citationDomId, formatNewsDate, parseCitation, withoutRankScoreDisclaimer } from "../../entities/briefing";
import { formatNumber } from "../../shared/lib/format";
import { safeArticleUrl } from "../../shared/lib/articleUrl";
import { useAppPaths } from "../../app/paths";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  Newspaper,
  ShieldAlert,
  Award,
} from "lucide-react";

export function BriefingStockSection({
  stocks,
  narrative,
  selectedCode,
  onSelectStock,
  onCitationClick,
  expandedCodes,
  onToggleExpand,
}: {
  stocks: BriefingStock[];
  narrative: BriefingNarrative;
  selectedCode: string | null;
  onSelectStock: (code: string) => void;
  onCitationClick?: (citationId: string) => void;
  expandedCodes?: Set<string>;
  onToggleExpand?: (code: string) => void;
}) {
  const paths = useAppPaths();
  const narrativeStockMap = new Map(narrative.stocks.map((item) => [item.code, item]));

  const [internalExpandedCodes, setInternalExpandedCodes] = useState<Set<string>>(
    () => new Set()
  );
  const activeExpandedCodes = expandedCodes ?? internalExpandedCodes;

  const toggleExpand = (code: string) => {
    if (onToggleExpand) {
      onToggleExpand(code);
    } else {
      setInternalExpandedCodes((prev) => {
        const next = new Set(prev);
        if (next.has(code)) next.delete(code);
        else next.add(code);
        return next;
      });
    }
  };

  const KIND_LABELS: Record<string, string> = {
    model: "모델",
    supply: "수급",
    news: "뉴스",
    macro: "거시",
    data: "데이터",
  };

  return (
    <section className="briefing-stocks-section" aria-labelledby="briefing-stocks-heading">
      <div className="briefing-section-heading">
        <div className="briefing-stocks-title-group">
          <h2 id="briefing-stocks-heading">종목별 근거·주의점</h2>
          <span className="briefing-muted">모델 순위 점수 상위 5종목의 핵심 근거와 주의점</span>
        </div>
      </div>

      <ul className="briefing-stocks-list">
        {stocks.map((stock) => {
          const isSelected = stock.code === selectedCode;
          const isExpanded = activeExpandedCodes.has(stock.code);
          const stockNarrative = narrativeStockMap.get(stock.code);
          const articlesToDisplay = stock.news.articles.slice(0, 3);
          const hasArticles = articlesToDisplay.length > 0;
          const visibleCautions = stock.cautions.filter(item => withoutRankScoreDisclaimer(item.text));
          const summary = withoutRankScoreDisclaimer(stockNarrative?.summary ?? "");
          const cardDomId = citationDomId(`R:${stock.code}`);

          return (
            <li
              key={stock.code}
              id={cardDomId}
              className={`briefing-stock-card ${isSelected ? "is-selected" : ""} ${
                isExpanded ? "is-expanded" : "is-collapsed"
              }`}
              tabIndex={-1}
              data-testid={`stock-card-${stock.code}`}
              data-selected={isSelected}
            >
              {/* 상단: 순위, 종목명, 점수 태그, 리포트 링크, 자세히/접기 버튼 */}
              <div className="briefing-stock-card-top">
                <div className="briefing-stock-rank-badge">
                  <Award aria-hidden="true" size={16} />
                  <span>{stock.rank}위</span>
                </div>

                <div className="briefing-stock-info">
                  <button
                    type="button"
                    className="briefing-stock-title-button"
                    onClick={() => onSelectStock(stock.code)}
                  >
                    <strong className="briefing-stock-name">{stock.name}</strong>
                    <span className="briefing-stock-code">{stock.code}</span>
                  </button>
                  <span className="briefing-stock-pool-meta">
                    {stock.poolSize !== null && `${formatNumber(stock.poolSize)}종목 중 `}상위 {stock.topPercent === null ? "—" : `${stock.topPercent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`} · 순위 점수:{" "}
                    {stock.rankScore === null ? "—" : stock.rankScore > 0 ? `+${stock.rankScore.toFixed(2)}` : stock.rankScore.toFixed(2)}
                  </span>
                </div>

                <div className="briefing-stock-link-wrap">
                  <Link
                    to={paths.stock(stock.code)}
                    className="briefing-stock-report-link"
                    title={`${stock.name} 리포트 이동`}
                  >
                    <span>리포트</span>
                    <ArrowRight aria-hidden="true" size={13} />
                  </Link>

                  <button
                    type="button"
                    className="briefing-stock-expand-button"
                    aria-expanded={isExpanded}
                    aria-controls={`stock-details-${stock.code}`}
                    onClick={() => toggleExpand(stock.code)}
                    data-testid={`stock-expand-btn-${stock.code}`}
                  >
                    <span>{isExpanded ? "접기" : "자세히"}</span>
                    <ChevronDown
                      aria-hidden="true"
                      size={14}
                      className={`briefing-expand-icon ${isExpanded ? "is-expanded" : ""}`}
                    />
                  </button>
                </div>
              </div>

              {/* 종목 요약 문구 및 인용 칩 / 요약 칩 */}
              {summary && (
                <div className="briefing-stock-summary-box">
                  <div className="briefing-stock-summary-header">
                    <p className="briefing-stock-summary-text" title={summary}>{summary}</p>
                    {narrative.status === "llm" &&
                      narrative.fallbackReason === "partial_template" &&
                      stockNarrative?.source === "template" && (
                        <span
                          className="briefing-field-source-tag"
                          data-testid={`stock-source-${stock.code}`}
                        >
                          규칙 기반
                        </span>
                      )}
                  </div>

                  {/* 근거 n건 / 주의 n건 / 기사 n건 요약 칩 */}
                  <div className="briefing-stock-summary-meta-chips">
                    <span
                      className="briefing-stock-meta-chip is-evidence"
                      data-testid={`stock-chip-evidence-${stock.code}`}
                      title={`${stock.name} 분석 근거 ${stock.evidence.length}건`}
                    >
                      <span>근거 {stock.evidence.length}건</span>
                    </span>
                    <span
                      className="briefing-stock-meta-chip is-caution"
                      data-testid={`stock-chip-caution-${stock.code}`}
                      title={`${stock.name} 주의점 ${visibleCautions.length}건`}
                    >
                      <span>주의 {visibleCautions.length}건</span>
                    </span>
                    <span
                      className="briefing-stock-meta-chip is-news"
                      data-testid={`stock-chip-news-${stock.code}`}
                      title={`${stock.name} 관련 기사 ${stock.news.articles.length}건`}
                    >
                      <span>기사 {stock.news.articles.length}건</span>
                    </span>
                  </div>
                </div>
              )}

              {/* 펼친 상태에서만 노출: 인용 근거, 근거/주의점 그리드 및 기사 목록(최대 3건) */}
                <div
                  id={`stock-details-${stock.code}`}
                  hidden={!isExpanded}
                  className="briefing-stock-expanded-content"
                  data-testid={`stock-details-${stock.code}`}
                >
                  {stockNarrative?.citations && stockNarrative.citations.length > 0 && (
                    <div className="briefing-stock-summary-citations">
                      <span className="briefing-stock-citations-label">인용 근거:</span>
                      <div className="briefing-stock-chip-list">
                        {[...new Set(stockNarrative.citations)]
                          .map(parseCitation)
                          .filter((p) => p.isValid && (p.type !== "rank" || stocks.some(item => item.code === p.code))
                            && !stock.cautions.some(item => item.id === p.rawId && !withoutRankScoreDisclaimer(item.text)))
                          .map((parsed) => {
                            const cId = parsed.rawId;
                            const ariaLabel =
                              parsed.type === "macro"
                                ? `시장 지표 ${parsed.label} 카드로 이동`
                                : `${parsed.label} · ${stock.name} 관련 근거로 이동`;
                            return (
                              <button
                                key={cId}
                                type="button"
                                className="briefing-citation-chip briefing-stock-citation-chip"
                                onClick={() => onCitationClick?.(cId)}
                                title={ariaLabel}
                                aria-label={ariaLabel}
                                data-testid={`stock-citation-chip-${cId}`}
                              >
                                <span>{parsed.label}</span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}
                  {/* 근거 & 주의점 2단 그리드 */}
                  <div className="briefing-stock-details-grid">
                    {/* 근거 항목 */}
                    <div className="briefing-stock-evidence-col">
                      <h3 className="briefing-stock-detail-title">분석 근거</h3>
                      {stock.evidence.length > 0 ? (
                        <ul className="briefing-stock-detail-list">
                          {stock.evidence.map((item, idx) => {
                            const itemDomId = citationDomId(item.id);
                            return (
                              <li
                                key={item.id || idx}
                                id={itemDomId}
                                className="briefing-stock-detail-item is-evidence"
                                tabIndex={-1}
                                data-testid={`evidence-${item.id}`}
                              >
                                <span className="briefing-kind-tag">
                                  {KIND_LABELS[item.kind] ?? item.kind}
                                </span>
                                <span className="briefing-detail-text">{item.text}</span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="briefing-empty-hint">등록된 근거 항목이 없습니다.</p>
                      )}
                    </div>

                    {/* 주의점 항목 */}
                    <div className="briefing-stock-cautions-col">
                      <h3 className="briefing-stock-detail-title is-caution">
                        <ShieldAlert aria-hidden="true" size={14} />
                        <span>주의점</span>
                      </h3>
                      {visibleCautions.length > 0 ? (
                        <ul className="briefing-stock-detail-list">
                          {visibleCautions.map((item, idx) => {
                            const itemDomId = citationDomId(item.id);
                            return (
                              <li
                                key={item.id || idx}
                                id={itemDomId}
                                className="briefing-stock-detail-item is-caution"
                                tabIndex={-1}
                                data-testid={`caution-${item.id}`}
                              >
                                <AlertTriangle aria-hidden="true" size={13} className="briefing-caution-icon" />
                                <span className="briefing-kind-tag is-caution">
                                  {KIND_LABELS[item.kind] ?? item.kind}
                                </span>
                                <span className="briefing-detail-text">{withoutRankScoreDisclaimer(item.text)}</span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="briefing-empty-hint">특이 주의 사항이 없습니다.</p>
                      )}
                    </div>
                  </div>

                  {/* 관련 기사 출처 목록 (최대 3건) */}
                  <div className="briefing-stock-news-section">
                    <div className="briefing-stock-news-header">
                      <Newspaper aria-hidden="true" size={13} />
                      <span className="briefing-stock-news-label">관련 기사</span>
                      <span className="briefing-stock-news-status">
                        {stock.news.status === "collected"
                          ? `${stock.news.articles.length}건 중 상위 ${articlesToDisplay.length}건`
                          : stock.news.status === "collection_failed"
                          ? "수집 실패"
                          : "미수집"}
                      </span>
                    </div>

                    {hasArticles ? (
                      <ul className="briefing-stock-news-list">
                        {articlesToDisplay.map((art, idx) => {
                          const safeUrl = safeArticleUrl(art.url);
                          const artDomId = citationDomId(art.id);
                          return (
                            <li
                              key={art.id || idx}
                              id={artDomId}
                              className="briefing-stock-news-item"
                              tabIndex={-1}
                              data-testid={`news-${art.id}`}
                            >
                              {safeUrl ? (
                                <a
                                  href={safeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="briefing-stock-news-link"
                                  title={art.title}
                                  aria-label={`${art.title} (새 탭에서 열림)`}
                                >
                                  <span className="briefing-stock-news-title">{art.title}</span>
                                  <ExternalLink aria-hidden="true" size={11} />
                                </a>
                              ) : (
                                <span className="briefing-stock-news-title">{art.title}</span>
                              )}
                              <span className="briefing-stock-news-meta">
                                {art.source} {art.pubDate && `· ${formatNewsDate(art.pubDate)}`}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="briefing-empty-hint">관련 기사가 없습니다.</p>
                    )}
                  </div>
                </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
