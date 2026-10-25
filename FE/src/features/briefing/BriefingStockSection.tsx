import type { BriefingNarrative, BriefingStock } from "../../entities/briefing";
import { citationDomId, formatNewsDate, parseCitation, withoutRankScoreDisclaimer } from "../../entities/briefing";
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
} from "lucide-react";

export function BriefingStockEvidence({
  stock,
  stocks,
  narrative,
  isExpanded,
  onToggleExpand,
  onCitationClick,
}: {
  stock: BriefingStock;
  stocks: BriefingStock[];
  narrative: BriefingNarrative;
  isExpanded: boolean;
  onToggleExpand: (code: string) => void;
  onCitationClick: (citationId: string) => void;
}) {
  const paths = useAppPaths();
  const stockNarrative = narrative.stocks.find(item => item.code === stock.code);
  const articlesToDisplay = stock.news.articles.slice(0, 3);
  const hasArticles = articlesToDisplay.length > 0;
  const visibleCautions = stock.cautions.filter(item => withoutRankScoreDisclaimer(item.text));
  const citationsToDisplay = [...new Set(stockNarrative?.citations ?? [])]
    .map(parseCitation)
    .filter((p) => p.isValid
      && (p.type !== "rank" || stocks.some(item => item.code === p.code))
      && (p.type !== "caution" || visibleCautions.some(item => item.id === p.rawId)));
  const summary = withoutRankScoreDisclaimer(stockNarrative?.summary ?? "");
  const cardDomId = citationDomId(`R:${stock.code}`);

  const KIND_LABELS: Record<string, string> = {
    model: "모델",
    supply: "수급",
    news: "뉴스",
    macro: "거시",
    data: "데이터",
  };

  return (
    <div
      id={cardDomId}
      className={`briefing-stock-evidence ${
        isExpanded ? "is-expanded" : "is-collapsed"
      }`}
      tabIndex={-1}
      data-testid={`stock-card-${stock.code}`}
    >
      <div className="briefing-stock-card-top">
        {stock.modelEvidence && (stock.modelEvidence.agreement || stock.modelEvidence.features.length > 0) && (
          <p className="briefing-stock-observations">
            {stock.modelEvidence.agreement && `20일·120일 모델 ${stock.modelEvidence.agreement}`}
            {stock.modelEvidence.agreement && stock.modelEvidence.features.length > 0 && " · "}
            {stock.modelEvidence.features[0]?.text}
            <span className="briefing-sr-only"> 입력 특징의 상대적 위치이며 모델 기여도는 아닙니다.</span>
          </p>
        )}

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
            onClick={() => onToggleExpand(stock.code)}
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
      {/* 요약이 없어도 근거·주의·기사 개수를 표시한다. */}
      <div className="briefing-stock-summary-box">
        {summary && (
          <div className="briefing-stock-summary-header">
            <p className="briefing-stock-summary-text" title={summary}>{summary}</p>
            {narrative.status === "llm" &&
              narrative.fallbackReason === "partial_template" &&
              stockNarrative?.source === "template" && (
                <span
                  className="briefing-field-source-tag"
                  data-testid={`stock-source-${stock.code}`}
                >
                  자동 생성
                </span>
              )}
          </div>
        )}

        {/* 근거 n건 / 주의 n건(1건 이상일 때만) / 기사 n건 요약 칩 */}
        <div className="briefing-stock-summary-meta-chips">
          <span
            className="briefing-stock-meta-chip is-evidence"
            data-testid={`stock-chip-evidence-${stock.code}`}
            title={`${stock.name} 분석 근거 ${stock.evidence.length}건`}
          >
            <span>근거 {stock.evidence.length}건</span>
          </span>
          {visibleCautions.length > 0 && (
            <span
              className="briefing-stock-meta-chip is-caution"
              data-testid={`stock-chip-caution-${stock.code}`}
              title={`${stock.name} 주의점 ${visibleCautions.length}건`}
            >
              <span>주의 {visibleCautions.length}건</span>
            </span>
          )}
          <span
            className="briefing-stock-meta-chip is-news"
            data-testid={`stock-chip-news-${stock.code}`}
            title={`${stock.name} 관련 기사 ${stock.news.articles.length}건`}
          >
            <span>기사 {stock.news.articles.length}건</span>
          </span>
        </div>
      </div>

      {/* 펼친 상태에서만 노출: 인용 근거, 근거/주의점 그리드 및 기사 목록(최대 3건) */}
        <div
          id={`stock-details-${stock.code}`}
          hidden={!isExpanded}
          className="briefing-stock-expanded-content"
          data-testid={`stock-details-${stock.code}`}
        >
          {citationsToDisplay.length > 0 && (
            <div className="briefing-stock-summary-citations">
              <span className="briefing-stock-citations-label">인용 근거:</span>
              <div className="briefing-stock-chip-list">
                {citationsToDisplay.map((parsed) => {
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
                <p className="briefing-empty-hint">표시할 주의점이 없습니다.</p>
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
    </div>
  );
}
