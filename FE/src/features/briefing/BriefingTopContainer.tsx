import React, { useState, useCallback } from "react";
import type { BriefingPayload } from "../../entities/briefing";
import { citationDomId, parseCitation } from "../../entities/briefing";
import { BriefingMacroGrid } from "./BriefingMacroGrid";
import { BriefingNarrativeCard } from "./BriefingNarrativeCard";
import { BriefingCompositionCard } from "./BriefingCompositionCard";
import { BriefingStockEvidence } from "./BriefingStockSection";
import "./briefingTop.css";

export type RenderStockEvidence = (code: string) => React.ReactNode;

export type BriefingTopContainerProps = {
  briefing: BriefingPayload;
  onSelectStock: (code: string) => void;
  isGenerating: boolean;
  analysisRunning?: boolean;
  generateError: string | null;
  onGenerateNarrative: () => void;
  renderTopFive: (renderEvidence: RenderStockEvidence) => React.ReactNode;
};

const highlightTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

export function highlightCitationTarget(citationId: string) {
  const targetId = citationDomId(citationId);
  const el = document.getElementById(targetId);
  if (!el) return;
  const existingTimer = highlightTimers.get(el);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
    highlightTimers.delete(el);
  }
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  el.classList.add("briefing-highlight");
  const timer = setTimeout(() => {
    el.classList.remove("briefing-highlight");
    highlightTimers.delete(el);
  }, 2000);
  highlightTimers.set(el, timer);
  if (el instanceof HTMLElement) {
    el.focus?.({ preventScroll: true });
  }
}

export function BriefingTopContainer({
  briefing,
  onSelectStock,
  isGenerating,
  analysisRunning = false,
  generateError,
  onGenerateNarrative,
  renderTopFive,
}: BriefingTopContainerProps) {
  const [isNarrativeExpanded, setIsNarrativeExpanded] = useState(false);
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(
    () => new Set()
  );

  const toggleExpand = useCallback((code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const handleCitationClick = useCallback((citationId: string) => {
    const parsed = parseCitation(citationId);
    if (parsed.code) {
      setExpandedCodes((prev) => {
        if (prev.has(parsed.code!)) return prev;
        const next = new Set(prev);
        next.add(parsed.code!);
        return next;
      });
    }
    const targetId = citationDomId(citationId);
    const targetEl = document.getElementById(targetId);
    if (citationId === "narrative" || citationId === "overview" || targetEl?.closest(".briefing-narrative-card")) {
      setIsNarrativeExpanded(true);
    }
    // Allow React to re-render the expanded section before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        highlightCitationTarget(citationId);
      });
    });
  }, []);

  return (
    <div className="briefing-top-container" data-testid="briefing-top-container">
      {/* 1. 종합 브리핑(요약) 카드 */}
      <BriefingNarrativeCard
        narrative={briefing.narrative}
        stocks={briefing.stocks}
        isGenerating={isGenerating}
        analysisRunning={analysisRunning}
        analysisFailed={briefing.previousRun?.reason === "failed"}
        generateError={generateError}
        onGenerate={onGenerateNarrative}
        onCitationClick={handleCitationClick}
        isExpanded={isNarrativeExpanded}
        onToggleExpand={() => setIsNarrativeExpanded(v => !v)}
      />

      {/* 2. TOP5 행 안에 종목별 근거를 함께 렌더링 */}
      {renderTopFive(code => {
        const stock = briefing.stocks.find(item => item.code === code);
        return stock ? (
          <BriefingStockEvidence
            stock={stock}
            stocks={briefing.stocks}
            narrative={briefing.narrative}
            isExpanded={expandedCodes.has(code)}
            onToggleExpand={toggleExpand}
            onCitationClick={handleCitationClick}
          />
        ) : null;
      })}

      {/* 3. 시장 지표 그리드 (+ 하단 참고 통계 접이식 카드) */}
      <BriefingMacroGrid macro={briefing.macro} />

      {/* 4. TOP5 후보 구성 카드 */}
      {briefing.composition && (
        <BriefingCompositionCard
          composition={briefing.composition}
          stocks={briefing.stocks}
          onSelectStock={onSelectStock}
        />
      )}

      {/* 5. 면책 조항 */}
      {briefing.disclaimer && (
        <p className="briefing-disclaimer" data-testid="briefing-disclaimer">
          {briefing.disclaimer}
        </p>
      )}
    </div>
  );
}
