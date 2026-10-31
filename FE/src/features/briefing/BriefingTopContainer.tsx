import React, { useState, useCallback } from "react";
import type { BriefingPayload } from "../../entities/briefing";
import { citationDomId, parseCitation } from "../../entities/briefing";
import { BriefingMacroGrid } from "./BriefingMacroGrid";
import { BriefingNarrativeCard } from "./BriefingNarrativeCard";
import { BriefingCompositionCard } from "./BriefingCompositionCard";
import { BriefingStockEvidence } from "./BriefingStockSection";
import { PreOpenMarketSection } from "./PreOpenMarketSection";
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

export function highlightCitationTarget(citationId: string, scope: "snapshot" | "preopen" = "snapshot") {
  const targetId = citationDomId(citationId, scope);
  const el = document.getElementById(targetId);
  if (!el) return;
  const details = el.closest("details");
  if (details) details.open = true;
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

  const handleCitationClick = useCallback((citationId: string, scope: "snapshot" | "preopen" = "snapshot") => {
    const parsed = parseCitation(citationId);
    if (parsed.code) {
      setExpandedCodes((prev) => {
        if (prev.has(parsed.code!)) return prev;
        const next = new Set(prev);
        next.add(parsed.code!);
        return next;
      });
    }
    const targetId = citationDomId(citationId, scope);
    const targetEl = document.getElementById(targetId);
    if (citationId === "narrative" || citationId === "overview" || targetEl?.closest(".briefing-narrative-card")) {
      setIsNarrativeExpanded(true);
    }
    // Allow React to re-render the expanded section before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        highlightCitationTarget(citationId, scope);
      });
    });
  }, []);

  const narrativeNode = (
    <BriefingNarrativeCard
      key="narrative"
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
  );

  const renderedTopFive = renderTopFive(code => {
    const stock = briefing.stocks.find(item => item.code === code);
    return stock ? (
      <BriefingStockEvidence
        key={code}
        stock={stock}
        stocks={briefing.stocks}
        narrative={briefing.narrative}
        isExpanded={expandedCodes.has(code)}
        onToggleExpand={toggleExpand}
        onCitationClick={handleCitationClick}
      />
    ) : null;
  });

  const topFiveNode = React.isValidElement(renderedTopFive)
    ? React.cloneElement(renderedTopFive, { key: "top-five" })
    : <React.Fragment key="top-five">{renderedTopFive}</React.Fragment>;

  return (
    <div className="briefing-top-container" data-testid="briefing-top-container">
      {narrativeNode}
      {topFiveNode}
      <PreOpenMarketSection macro={briefing.macro} narrative={briefing.narrative} onCitationClick={handleCitationClick} />
      <BriefingMacroGrid macro={briefing.macro} />

      {/* TOP5 후보 구성 */}
      {briefing.composition && (
        <BriefingCompositionCard
          composition={briefing.composition}
          stocks={briefing.stocks}
          onSelectStock={onSelectStock}
        />
      )}

      {/* 공통 고지 */}
      {briefing.disclaimer && (
        <p className="briefing-disclaimer" data-testid="briefing-disclaimer">
          {briefing.disclaimer}
        </p>
      )}
    </div>
  );
}
