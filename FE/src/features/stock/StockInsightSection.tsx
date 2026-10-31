import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { StockInsight } from "../../entities/stockInsight";
import { withoutRankScoreDisclaimer } from "../../entities/briefing";
import { formatModelPercent } from "../../entities/modelEvidence";
import { formatRankScore } from "../../shared/lib/format";
import { PastObservationTag } from "../briefing/PastObservationTag";
import { useStockInsight } from "./useStockInsight";
import "./stockInsight.css";

export function CollapsibleNote({ text, className = "", collapsedLines = 3 }: { text?: string | null; className?: string; collapsedLines?: 3 | 5 }) {
  const [expanded, setExpanded] = useState(false);
  const [canToggle, setCanToggle] = useState(false);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const contentId = useId();

  // Reset expanded state whenever text changes
  useEffect(() => {
    setExpanded(false);
  }, [text]);

  const measure = useCallback(() => {
    const el = noteRef.current;
    if (!el || !text) return;
    if (el.clientHeight > 0) {
      setCanToggle(el.scrollHeight > el.clientHeight);
    } else if (text.length > 80) {
      // Fallback for non-rendered environments when dimensions are not mocked
      setCanToggle(true);
    } else {
      setCanToggle(false);
    }
  }, [text]);

  // Always measure while clamped (!expanded); preserve canToggle when expanded
  useLayoutEffect(() => {
    if (expanded) return;
    measure();
    const el = noteRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded, measure]);

  if (!text) return null;

  return (
    <div className={`insight-expandable-note ${className}`.trim()}>
      <p
        ref={noteRef}
        id={contentId}
        className={`report-muted ${!expanded ? "insight-note-clamped" : ""}`}
        style={!expanded ? { WebkitLineClamp: collapsedLines } : undefined}
      >
        {text}
      </p>
      {canToggle && (
        <button
          type="button"
          className="insight-note-toggle"
          onClick={() => setExpanded(prev => !prev)}
          aria-expanded={expanded}
          aria-controls={contentId}
        >
          {expanded ? "접기" : "자세히"}
        </button>
      )}
    </div>
  );
}

export function StockInsightSection({ code }: { code: string }) {
  const query = useStockInsight(code);
  return query.data ? <StockInsightDetails insight={query.data} /> : null;
}

export function StockInsightDetails({ insight, embedded = false }: { insight: StockInsight; embedded?: boolean }) {
  const { model, sensitivity, cautions } = insight, conditional = sensitivity.conditional;
  const visibleCautions = cautions.map(withoutRankScoreDisclaimer).filter(text => text && !(embedded && model?.features.length && /입력 특징.*모델 기여도/.test(text)));
  if (!model && sensitivity.status !== "ready" && !visibleCautions.length) return null;
  return <section className={embedded ? "insight-section insight-embedded" : "report-card insight-section"} aria-labelledby={embedded ? undefined : "stock-input-observations-heading"}>
    {!embedded && <><h2 id="stock-input-observations-heading">모델 순위와 주요 지표</h2>
    <p className="report-muted">모델 순위와 입력 특징을 함께 확인합니다. 특징의 위치가 개별 예측의 원인을 설명하지는 않습니다.</p></>}
    {model ? <>
      {!embedded && <p className="insight-rank">{model.poolSize.toLocaleString("ko-KR")}종목 중 <strong>{model.rank}위</strong>, 상위 {formatModelPercent(model.topPercent)}. 순위 점수 <span title={model.rankScore != null ? String(model.rankScore) : undefined}>{formatRankScore(model.rankScore, 2)}</span></p>}
      {model.lookbacks.length === 2 && <div className="insight-block"><h3 className="insight-comparison-heading">20일·120일 모델 비교{model.agreement && <span className="insight-agreement" title="모델 일치도">{model.agreement}</span>}</h3>
        <div className="insight-lookbacks">{model.lookbacks.map(lb => {
          const topPercent = formatModelPercent(lb.rank / model.poolSize * 100);
          return <div key={lb.sessions} id={`stock-model-${insight.code}-${lb.sessions}`} tabIndex={-1} className="stock-citation-target"><span>{lb.sessions}일 모델</span><svg role="img" aria-label={`${lb.sessions}일 모델 ${lb.rank}위, 상위 ${topPercent}`}><line x1="2%" x2="98%" y1="16" y2="16" stroke="var(--ds-fg-2)" strokeWidth="2" /><circle cx={`${2 + (lb.rank - 1) / Math.max(1, model.poolSize - 1) * 96}%`} cy="16" r="5" fill="var(--ds-fg)" /></svg><span className="insight-lookback-value"><strong>{lb.rank}위</strong><span>상위 {topPercent}</span></span></div>;
        })}</div><p className="report-muted">왼쪽이 상위 순위입니다. 두 순위 차이가 비교 종목 수의 10% 이내면 일치, 25% 이내면 부분 일치입니다.</p></div>}
      {model.features.length > 0 && <div className="insight-block"><h3>비교 종목 안에서의 지표 위치</h3><ul className="insight-features">{model.features.map(feature => <li key={feature.key} id={`stock-feature-${insight.code}-${feature.key}`} tabIndex={-1} className="stock-citation-target"><span>{feature.label}</span><strong>{feature.side === "upper" ? "상위" : "하위"} {formatModelPercent(feature.tailPercent)}</strong><meter min={0} max={100} value={feature.percentile} aria-label={`${feature.label} 백분위`} /></li>)}</ul><CollapsibleNote text={model.note} /></div>}
      {!model.lookbacks.length && <p className="report-muted">이 실행에는 기간별 모델 순위와 입력 특징이 저장되지 않았습니다. 새 분석부터 제공됩니다.</p>}
    </> : <p>저장된 모델 순위에 포함되지 않은 종목입니다.</p>}
    {sensitivity.status === "ready" && <div className="insight-block"><h3>직전 미국장과의 관계</h3><>
      <div className="insight-scroll"><table><caption>최근 1년 나스닥 민감도 · {sensitivity.samples}일</caption><thead><tr><th scope="col">종목 수익 구간</th><th scope="col">상관계수</th><th scope="col">베타</th></tr></thead><tbody>{sensitivity.metrics.map(metric => <tr key={metric.definition}><th scope="row">{metric.definition === "close_to_close" ? "종가→종가" : "시가→종가"}</th><td>{metric.correlation.toFixed(2)}</td><td>{metric.beta.toFixed(2)}</td></tr>)}</tbody></table></div>
      {conditional && <p>나스닥 상승 뒤 이 종목의 시가→종가 상승 비율 {conditional.ratioPct.toFixed(1)}% ({conditional.count}/{conditional.total}일) · 같은 기간 전체 상승 비율 {conditional.baselinePct.toFixed(1)}% ({conditional.baselineCount}/{conditional.baselineTotal}일)</p>}
      <p className="report-muted">{sensitivity.periodStart} ~ {sensitivity.periodEnd} · {sensitivity.source}</p><PastObservationTag asOf={sensitivity.asOf} />
    </>
      {withoutRankScoreDisclaimer(sensitivity.note) && <CollapsibleNote text={withoutRankScoreDisclaimer(sensitivity.note)} />}</div>}
    {visibleCautions.length > 0 && <div className="insight-block"><h3>참고 사항</h3><ul>{visibleCautions.map(caution => <li key={caution}>{caution}</li>)}</ul></div>}
  </section>;
}
