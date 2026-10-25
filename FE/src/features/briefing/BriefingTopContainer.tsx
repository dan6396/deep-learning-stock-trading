import React, { useState, useCallback } from "react";
import type { BriefingPayload } from "../../entities/briefing";
import { citationDomId, parseCitation } from "../../entities/briefing";
import { BriefingMacroGrid } from "./BriefingMacroGrid";
import { BriefingNarrativeCard } from "./BriefingNarrativeCard";
import { BriefingCompositionCard } from "./BriefingCompositionCard";
import { BriefingStockSection } from "./BriefingStockSection";
import "./briefingTop.css";

export type BriefingTopContainerProps = {
  briefing: BriefingPayload;
  selectedCode: string | null;
  onSelectStock: (code: string) => void;
  isGenerating: boolean;
  generateError: string | null;
  onGenerateNarrative: () => void;
  children?: React.ReactNode;
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
  selectedCode,
  onSelectStock,
  isGenerating,
  generateError,
  onGenerateNarrative,
  children,
}: BriefingTopContainerProps) {
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
        generateError={generateError}
        onGenerate={onGenerateNarrative}
        onCitationClick={handleCitationClick}
      />

      {/* 2. TOP5 표 (children 슬롯) */}
      {children}

      {/* 3. 종목별 근거·주의점 */}
      {briefing.stocks.length > 0 && (
        <BriefingStockSection
          stocks={briefing.stocks}
          narrative={briefing.narrative}
          selectedCode={selectedCode}
          onSelectStock={onSelectStock}
          onCitationClick={handleCitationClick}
          expandedCodes={expandedCodes}
          onToggleExpand={toggleExpand}
        />
      )}

      {/* 4. 시장 지표 그리드 (+ 하단 참고 통계 접이식 카드) */}
      <BriefingMacroGrid macro={briefing.macro} />

      {/* 5. TOP5 후보 구성 카드 */}
      {briefing.composition && (
        <BriefingCompositionCard
          composition={briefing.composition}
          stocks={briefing.stocks}
          onSelectStock={onSelectStock}
        />
      )}

      {/* 6. 면책 조항 */}
      {briefing.disclaimer && (
        <p className="briefing-disclaimer" data-testid="briefing-disclaimer">
          {briefing.disclaimer}
        </p>
      )}
    </div>
  );
}
