import { useMemo } from "react";
import type { MacroData, MacroIndicator } from "../../entities/briefing";
import {
  citationDomId,
  formatMacroAsOf,
  formatMacroChange,
  formatMacroSource,
  formatMacroValue,
} from "../../entities/briefing";
import { Globe, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { BriefingMacroReference } from "./BriefingMacroReference";

// SP500 remains an API compatibility field, with no visible card or citation target.
const ORDERED_MACRO_IDS = [
  "KOSPI",
  "KOSDAQ",
  "KOSPI200_NIGHT",
  "NASDAQ",
  "USDKRW",
  "UST10Y",
] as const;

export function BriefingMacroGrid({ macro }: { macro: MacroData }) {
  const indicators = macro.indicators.filter(row => row.id !== "SP500");
  const context = macro.context;

  const sortedIndicators = useMemo(() => {
    const map = new Map(indicators.map((ind) => [ind.id, ind]));
    const list = ORDERED_MACRO_IDS
      .map((id) => map.get(id))
      .filter((ind): ind is MacroIndicator => ind !== undefined);

    for (const ind of indicators) {
      if (!ORDERED_MACRO_IDS.includes(ind.id as (typeof ORDERED_MACRO_IDS)[number])) {
        list.push(ind);
      }
    }
    return list.filter(ind => ind.status === "ok" && ind.value !== null);
  }, [indicators]);

  const domesticIndicators = useMemo(
    () =>
      sortedIndicators.filter(
        (ind) =>
          ind.id === "KOSPI" || ind.id === "KOSDAQ" || ind.id === "KOSPI200_NIGHT"
      ),
    [sortedIndicators]
  );

  const usIndicators = useMemo(
    () => sortedIndicators.filter((ind) => ind.id === "NASDAQ" || ind.id === "SP500"),
    [sortedIndicators]
  );

  const fxRateIndicators = useMemo(
    () =>
      sortedIndicators.filter(
        (ind) =>
          ind.id === "USDKRW" ||
          ind.id === "UST10Y" ||
          !["KOSPI", "KOSDAQ", "KOSPI200_NIGHT", "NASDAQ", "SP500"].includes(ind.id)
      ),
    [sortedIndicators]
  );

  const renderCard = (ind: MacroIndicator) => {
    const change = formatMacroChange(ind);
    const isUsMarket = ind.id === "NASDAQ" || ind.id === "SP500";
    const isNightMarket = ind.id === "KOSPI200_NIGHT";
    const formattedValue = formatMacroValue(ind);
    const asOfText = ind.status === "ok" ? formatMacroAsOf(ind.id, ind.asOf) : null;
    const sourceText = formatMacroSource(ind.source);
    const sessionDate = isUsMarket && ind.session === "closed" ? context?.usSessionDate?.slice(5).replace("-", "/") : null;
    const sessionText = ind.session === "open" ? (isNightMarket ? "야간 거래 중" : "장중") : ind.session === "closed" ? (isNightMarket ? "야간 종가" : "종가") : "";
    const metaText = ind.session === "closed" && !sessionDate
      ? asOfText?.endsWith("종가") ? asOfText : `${isUsMarket ? "미국장 종가" : sessionText} · 기준 ${asOfText}`
      : [sessionDate ?? asOfText, sessionText].filter(Boolean).join(" ");
    const cardDomId = citationDomId(`M:${ind.id}`);

    return (
      <article
        key={ind.id}
        id={cardDomId}
        className={`briefing-macro-card ${isUsMarket ? "is-us-market" : ""} ${
          isNightMarket ? "is-night-market" : ""
        }`}
        tabIndex={-1}
        data-testid={`macro-card-${ind.id}`}
      >
        <div className="briefing-macro-card-top">
          <div className="briefing-macro-name-row">
            <span className="briefing-macro-name">{ind.name}</span>
          </div>
        </div>

        <div className="briefing-macro-value-row">
          <span className="briefing-macro-value" data-testid={`macro-value-${ind.id}`}>
            {formattedValue}
          </span>
        </div>

        <div className="briefing-macro-change-row">
          <span
            className={`briefing-macro-change ${
              change.direction === "rise"
                ? "is-rise"
                : change.direction === "fall"
                ? "is-fall"
                : "is-flat"
            }`}
            data-testid={`macro-change-${ind.id}`}
          >
            {change.direction === "rise" && <TrendingUp aria-hidden="true" size={13} />}
            {change.direction === "fall" && <TrendingDown aria-hidden="true" size={13} />}
            {change.direction === "flat" && <Minus aria-hidden="true" size={13} />}
            <span className="briefing-sr-only">{change.direction === "rise" ? "상승 " : change.direction === "fall" ? "하락 " : ""}</span>
            <span>{change.text.replace(/^[▲▼]\s*/, "")}</span>
          </span>
        </div>

        <div className="briefing-macro-card-bottom">
          <span className="briefing-macro-as-of">
            {ind.asOf ? <time dateTime={ind.asOf}>{metaText || "시각 미확인"}</time> : metaText || "시각 미확인"} · {sourceText}
          </span>
        </div>
      </article>
    );
  };

  if (!sortedIndicators.length && !macro.reference) return null;

  return (
    <section className="briefing-macro-section" aria-labelledby="macro-section-heading">
      <div className="briefing-macro-header">
        <div className="briefing-macro-title-group">
          <h2 id="macro-section-heading">{macro.preOpen ? "요약 인용 시장 지표" : "시장 지표"}</h2>
          <span className="briefing-macro-caption">{macro.preOpen ? "요약 관측값 · 장전 지표와 수집 시점이 다를 수 있습니다" : "국내·미국 주요 지표 및 환율·금리"}</span>
        </div>
        {usIndicators.length > 0 && context?.usSessionDate && (
          <p className="briefing-macro-context-note" role="note">
            <Globe aria-hidden="true" size={14} />
            <span>미국장 {context.usSessionDate} 기준</span>
          </p>
        )}
      </div>

      <div className="briefing-macro-groups" aria-label="주요 시장 지표 그리드">
        {domesticIndicators.length > 0 && (
          <div className="briefing-macro-group is-domestic">
            <div className="briefing-macro-group-header">
              <span className="briefing-macro-group-title">국내 시장</span>
            </div>
            <div className={`briefing-macro-grid is-domestic${domesticIndicators.length === 2 ? " has-two" : ""}`}>
              {domesticIndicators.map(renderCard)}
            </div>
          </div>
        )}

        {(usIndicators.length > 0 || fxRateIndicators.length > 0) && <div className="briefing-macro-group-row">
          {usIndicators.length > 0 && (
            <div className="briefing-macro-group is-us">
              <div className="briefing-macro-group-header">
                <span className="briefing-macro-group-title">미국 증시</span>
              </div>
              <div className="briefing-macro-grid is-us">
                {usIndicators.map(renderCard)}
              </div>
            </div>
          )}

          {fxRateIndicators.length > 0 && (
            <div className="briefing-macro-group is-fx-rate">
              <div className="briefing-macro-group-header">
                <span className="briefing-macro-group-title">환율 · 금리</span>
              </div>
              <div className="briefing-macro-grid is-fx-rate">
                {fxRateIndicators.map(renderCard)}
              </div>
            </div>
          )}
        </div>}
      </div>

      {/* 시장 지표 섹션 하단 참고 통계 접이식 카드 */}
      {macro.reference && <BriefingMacroReference reference={macro.reference} />}
    </section>
  );
}
