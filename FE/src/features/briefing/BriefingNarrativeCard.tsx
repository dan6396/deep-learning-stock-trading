import { useEffect, useId, useMemo, useState } from "react";
import type { BriefingNarrative, BriefingStock } from "../../entities/briefing";
import { formatFallbackReason, formatKstTime, parseCitation, withoutRankScoreDisclaimer } from "../../entities/briefing";
import { Sparkles, RefreshCw, AlertCircle, Bot, Cpu, Info } from "lucide-react";
import { safeArticleUrl } from "../../shared/lib/articleUrl";
import { useAdminAccess } from "../../shared/api/adminAccess";

export type BriefingNarrativeCardProps = {
  narrative: BriefingNarrative;
  stocks: BriefingStock[];
  isGenerating: boolean;
  analysisRunning?: boolean;
  analysisFailed?: boolean;
  generateError: string | null;
  onGenerate: () => void;
  onCitationClick: (citationId: string) => void;
};

export function BriefingNarrativeCard({
  narrative,
  stocks,
  isGenerating,
  analysisRunning = false,
  analysisFailed = false,
  generateError,
  onGenerate,
  onCitationClick,
}: BriefingNarrativeCardProps) {
  const admin = useAdminAccess();
  const analysisReasonId = useId();
  const isLlm = narrative.status === "llm";
  const isTemplate = narrative.status === "template";
  const isPartialTemplate = isLlm && narrative.fallbackReason === "partial_template";
  const isStale = narrative.macroStale === true;
  const inProgress = narrative.fallbackReason === "generation_in_progress";
  const [clock, setClock] = useState(Date.now);
  const generated = Date.parse(narrative.generatedAt);
  useEffect(() => {
    setClock(Date.now());
    const remaining = generated + 600_000 - Date.now();
    if (!isLlm || !Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [isLlm, generated]);
  // Template timestamps are render times, not successful generation times.
  const recentlyGenerated = isLlm && Number.isFinite(generated) && clock < generated + 600_000;
  const isButtonDisabled = analysisRunning || analysisFailed || isGenerating || inProgress || isLlm && (recentlyGenerated || !isStale);

  let buttonText = "AI 요약 생성";
  if (isGenerating || inProgress) {
    buttonText = "요약 생성 중...";
  } else if (isStale) {
    buttonText = "최신 지표로 다시 생성";
  } else if (isLlm) {
    buttonText = "생성됨";
  }

  // 기사 URL 및 종목명 맵
  const articleMap = new Map<string, { url: string; title: string; stockName: string }>();
  const stockNameMap = new Map<string, string>();
  stocks.forEach((stock) => {
    stockNameMap.set(stock.code, stock.name);
    stock.news.articles.forEach((art) => {
      if (art.url) {
        articleMap.set(art.id, { url: art.url, title: art.title, stockName: stock.name });
      }
    });
  });

  function handleCitation(cId: string) {
    const parsed = parseCitation(cId);
    if (parsed.type === "news") {
      const art = articleMap.get(parsed.rawId);
      const safe = safeArticleUrl(art?.url);
      if (safe) {
        window.open(safe, "_blank", "noopener,noreferrer");
        return;
      }
    }
    onCitationClick(cId);
  }

  const fallbackReasonInfo = formatFallbackReason(narrative.fallbackReason);
  const notices = [
    ...(isLlm ? [{ key: "ai", text: "입력 자료만 요약하며 순위에 영향을 주지 않습니다", warning: false, priority: 10 }] : []),
    ...(isPartialTemplate ? [{ key: "partial", text: "AI 문장과 자동 생성 문장을 함께 표시합니다", warning: false, priority: 80 }] : []),
    ...(isTemplate && fallbackReasonInfo ? [{ key: "fallback", text: fallbackReasonInfo.text, warning: !fallbackReasonInfo.isNeutral, priority: inProgress ? 100 : 70 }] : []),
    ...(isLlm && fallbackReasonInfo && !isPartialTemplate ? [{ key: "refresh", text: inProgress ? fallbackReasonInfo.text : `최신 지표로 갱신하지 못했습니다: ${fallbackReasonInfo.text}`, warning: !inProgress, priority: inProgress ? 100 : 90 }] : []),
    ...(isStale ? [{ key: "stale", text: "요약 작성 이후 시장 지표가 갱신되었습니다", warning: false, priority: recentlyGenerated ? 20 : 40 }] : []),
  ].sort((left, right) => right.priority - left.priority);
  const overview = withoutRankScoreDisclaimer(narrative.overview);
  const marketNote = withoutRankScoreDisclaimer(narrative.marketNote);
  // 종합 카드 인용 근거: 시장 지표(M:)와 종목(R:)만 표시 (E/C/N 제외)
  const validCitations = useMemo(
    () =>
      [...new Set(narrative.citations)]
        .map(parseCitation)
        .filter((p) => p.isValid && (p.type === "macro" || p.type === "rank" && stocks.some(stock => stock.code === p.code))),
    [narrative.citations, stocks]
  );

  return (
    <article className="briefing-narrative-card" aria-labelledby="narrative-heading">
      <div className="briefing-narrative-header">
        <div className="briefing-narrative-title-group">
          <div className="briefing-narrative-title-row">
            <h2 id="narrative-heading">종합 브리핑</h2>
            <div className="briefing-narrative-badges">
              {isLlm ? (
                <span className={`briefing-badge is-ai ${isPartialTemplate ? "is-partial" : ""}`} data-testid="narrative-badge-ai">
                  <Bot aria-hidden="true" size={13} />
                  {isPartialTemplate ? "AI 요약 · 일부 자동 생성 문장 포함" : "AI 요약"} · {formatKstTime(narrative.generatedAt)}
                </span>
              ) : (
                <span className="briefing-badge is-rule" data-testid="narrative-badge-rule">
                  <Cpu aria-hidden="true" size={13} />
                  자동 생성 요약
                </span>
              )}
              {isLlm && narrative.llmModel && <span className="briefing-badge" data-testid="narrative-model">사용 모델 {narrative.llmModel}</span>}
              {narrative.macroAsOf && (
                <span
                  className="briefing-badge is-macro-as-of"
                  data-testid="narrative-macro-as-of"
                  title="지표별 기준 시각은 시장 지표 카드 참고"
                >
                  요약에 쓴 지표 시점 {formatKstTime(narrative.macroAsOf)}
                </span>
              )}
            </div>
          </div>
          {notices[0] && <p className={`briefing-narrative-fallback-reason ${notices[0].warning ? "is-warning" : "is-neutral"}`} role="status"
            data-testid={notices[0].key === "partial" ? "narrative-partial-template-notice" : "narrative-status-notice"}>
            {notices[0].warning ? <AlertCircle aria-hidden="true" size={13} /> : <Info aria-hidden="true" size={13} />}<span>{notices[0].text}</span>
          </p>}
          {notices.length > 1 && <details className="briefing-status-details"><summary>상태 안내 자세히</summary>
            <ul>{notices.slice(1).map(notice => <li key={notice.key} className={notice.warning ? "is-warning" : "is-neutral"}>{notice.text}</li>)}</ul>
          </details>}
        </div>

        {admin && <div className="briefing-narrative-action">
          <button
            type="button"
            className="briefing-button briefing-narrative-generate-button"
            disabled={isButtonDisabled}
            onClick={onGenerate}
            aria-busy={isGenerating || inProgress}
            aria-describedby={analysisRunning || analysisFailed ? analysisReasonId : undefined}
            data-testid="narrative-generate-btn"
          >
            {isGenerating ? (
              <RefreshCw className="briefing-spin" aria-hidden="true" size={14} />
            ) : (
              <Sparkles aria-hidden="true" size={14} />
            )}
            <span>{buttonText}</span>
          </button>
          {analysisRunning && <span id={analysisReasonId} className="briefing-partial-policy-hint">분석 진행 중에는 요약을 다시 만들 수 없습니다.</span>}
          {!analysisRunning && analysisFailed && <span id={analysisReasonId} className="briefing-partial-policy-hint">새 분석이 실패해 이전 결과를 표시 중입니다. 분석을 완료한 뒤 요약을 다시 생성해 주세요.</span>}
          {isGenerating && !analysisRunning && (
            <span
              className="briefing-narrative-generating-hint"
              data-testid="narrative-generating-hint"
              role="status"
            >
              최대 1분 정도 걸릴 수 있습니다
            </span>
          )}
          {!analysisRunning && !analysisFailed && isLlm && (recentlyGenerated || !isStale) && (
            <span
              className="briefing-partial-policy-hint"
              data-testid="partial-template-policy-hint"
            >
              {recentlyGenerated ? "최근 생성 후 10분이 지나면 최신 지표로 다시 생성할 수 있습니다" : "시장 지표가 갱신되면 다시 생성할 수 있습니다"}
            </span>
          )}
        </div>}
      </div>

      {admin && generateError && (
        <p className="briefing-narrative-error" role="alert">
          <AlertCircle aria-hidden="true" size={14} />
          {generateError}
        </p>
      )}

      <div className="briefing-narrative-content">
        {overview && (
          <div className="briefing-narrative-block">
            <div className="briefing-narrative-subtitle-row">
              <h3 className="briefing-narrative-subtitle">시장 개황 및 흐름</h3>
              {isPartialTemplate && narrative.fieldSources?.overview === "template" && (
                <span className="briefing-field-source-tag" data-testid="field-source-overview">
                  자동 생성
                </span>
              )}
            </div>
            <p className="briefing-narrative-text">{overview}</p>
          </div>
        )}

        {marketNote && (
          <div className="briefing-narrative-block">
            <div className="briefing-narrative-subtitle-row">
              <h3 className="briefing-narrative-subtitle">거시 지표 관찰</h3>
              {isPartialTemplate && narrative.fieldSources?.marketNote === "template" && (
                <span className="briefing-field-source-tag" data-testid="field-source-market-note">
                  자동 생성
                </span>
              )}
            </div>
            <p className="briefing-narrative-text">{marketNote}</p>
          </div>
        )}

        {validCitations.length > 0 && (
          <div className="briefing-narrative-citations" aria-label="브리핑 인용 근거">
            <span className="briefing-narrative-citations-label">인용 근거:</span>
            <div className="briefing-narrative-chip-list">
              {validCitations.map((parsed) => {
                const cId = parsed.rawId;
                const isRank = parsed.type === "rank";
                const isMacro = parsed.type === "macro";
                const stockName = parsed.code ? stockNameMap.get(parsed.code) ?? "" : "";
                const displayLabel = isRank ? (stockName || parsed.label) : parsed.label;
                const detailText = isRank
                  ? `${displayLabel} 종목 카드로 이동`
                  : isMacro
                  ? `시장 지표 ${parsed.label} 카드로 이동`
                  : `${cId} 위치로 이동`;
                const ariaLabel = detailText;

                return (
                  <button
                    key={cId}
                    type="button"
                    className="briefing-citation-chip"
                    onClick={() => handleCitation(cId)}
                    title={ariaLabel}
                    aria-label={ariaLabel}
                    data-testid={`citation-chip-${cId}`}
                  >
                    <span>{displayLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
