import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { BriefingComposition } from "../../entities/briefing";
import { formatKstTime } from "../../entities/briefing";
import { useAppPaths } from "../../app/paths";
import { formatNumber } from "../../shared/lib/format";
import { Layers, AlertTriangle, ArrowRight, TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import { CompositionObservations } from "./CompositionObservations";

export type BriefingCompositionCardProps = {
  composition: BriefingComposition | null | undefined;
  stocks?: { code: string; name: string }[];
  onSelectStock?: (code: string) => void;
};

export function BriefingCompositionCard({ composition, stocks, onSelectStock }: BriefingCompositionCardProps) {
  const paths = useAppPaths();

  // 종목 코드 -> 종목명 맵 생성 (메모이제이션)
  const stockMap = useMemo(() => {
    const map = new Map<string, string>();
    if (stocks) {
      for (const s of stocks) {
        map.set(s.code, s.name);
      }
    }
    return map;
  }, [stocks]);

  if (!composition) {
    return null;
  }

  const { note, sectors, sectorSource, performance, commonCautions } = composition;
  const sectorCodes = new Map<string, Set<string>>();
  for (const { name, codes } of sectors ?? []) {
    sectorCodes.set(name, new Set([...(sectorCodes.get(name) ?? []), ...codes]));
  }
  const sectorRows = [...sectorCodes].map(([name, codes]) => ({ name, codes: [...codes] }));

  return (
    <section
      className="briefing-card briefing-composition-card"
      data-testid="briefing-composition-card"
      aria-labelledby="composition-card-heading"
    >
      <div className="briefing-section-heading">
        <div className="briefing-composition-title-row">
          <Layers aria-hidden="true" size={17} className="briefing-composition-icon" />
          <h2 id="composition-card-heading">TOP5 후보 구성</h2>
          <span className="briefing-muted">동일 비중 참고</span>
        </div>
      </div>

      {/* 상단 안내 문구 */}
      {note && (
        <p className="briefing-composition-note" data-testid="composition-note">
          <Info aria-hidden="true" size={14} className="briefing-note-icon" />
          <span>{note}</span>
        </p>
      )}

      {/* 1. 업종별 구성 (sectors가 null이면 영역 전체 생략) */}
      {sectorRows.length > 0 && (
        <div className="briefing-composition-sectors-block" data-testid="composition-sectors">
          <div className="briefing-composition-subheading-row">
            <h3 className="briefing-composition-subheading">업종별 구성</h3>
            {sectorSource && <span className="briefing-sector-source">출처: {sectorSource}</span>}
          </div>
          <div className="briefing-composition-sectors-list">
            {sectorRows.map(sec => {
              const count = sec.codes.length;
              return (
                <div key={sec.name} className="briefing-sector-row" data-testid={`sector-${sec.name}`}>
                  <div className="briefing-sector-info">
                    <div className="briefing-sector-meta">
                      <span className="briefing-sector-name">{sec.name}</span>
                      <span className="briefing-sector-count">{count}종목</span>
                    </div>
                  </div>

                  {/* 종목 태그 리스트 */}
                  {sec.codes.length > 0 && (
                    <div className="briefing-sector-stocks">
                      {sec.codes.map((code) => {
                        const stockName = stockMap.get(code) ?? code;
                        return (
                          <button
                            type="button"
                            key={code}
                            className="briefing-sector-stock-tag"
                            onClick={() => onSelectStock?.(code)}
                            aria-label={`${stockName === code ? code : `${stockName} (${code})`} 선택`}
                            title={`${stockName === code ? code : `${stockName} (${code})`} 선택`}
                          >
                            <span className="briefing-sector-stock-name">{stockName}</span>
                            {stockName !== code && <span className="briefing-sector-stock-code">{code}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CompositionObservations data={composition.diversification} stocks={stocks} />
      {/* 2. 동일 비중 실측 기록 */}
      <div className="briefing-composition-perf-block" data-testid="composition-performance">
        <div className="briefing-composition-subheading-row">
          <h3 className="briefing-composition-subheading">동일 비중 실측 기록</h3>
          {performance && performance.measuredDays > 0 && performance.asOf && (
            <span className="briefing-perf-as-of" data-testid="composition-perf-as-of">
              기준: {formatKstTime(performance.asOf)}
            </span>
          )}
        </div>

        {!performance || performance.measuredDays === 0 ? (
          <p className="briefing-empty-notice" data-testid="composition-no-perf">
            아직 실측 기록이 없습니다
          </p>
        ) : (
          <div className="briefing-composition-perf-content">
            <div className="briefing-perf-summary-row">
              <div className="briefing-perf-metric">
                <span className="briefing-perf-metric-label">측정 일수</span>
                <span className="briefing-perf-metric-val">측정 {formatNumber(performance.measuredDays)}일</span>
              </div>
              <div className="briefing-perf-metric">
                <span className="briefing-perf-metric-label">
                  평균 수익률 <span className="briefing-perf-metric-desc">(동일 비중·시가→종가·공식 실측 기록)</span>
                </span>
                <span
                  className={`briefing-perf-metric-val ${
                    performance.averageReturnPct === null
                      ? "is-null"
                      : performance.averageReturnPct > 0
                      ? "is-rise"
                      : performance.averageReturnPct < 0
                      ? "is-fall"
                      : "is-flat"
                  }`}
                  data-testid="composition-avg-return"
                >
                  {performance.averageReturnPct === null
                    ? "—"
                    : `${performance.averageReturnPct > 0 ? "+" : ""}${performance.averageReturnPct.toFixed(2)}%`}
                </span>
              </div>
              <div className="briefing-perf-metric">
                <span className="briefing-perf-metric-label">상승 마감 일수</span>
                <span className="briefing-perf-metric-val" data-testid="composition-positive-days">
                  {performance.positiveDays !== null
                    ? `상승 마감 ${formatNumber(performance.positiveDays)}/${formatNumber(performance.measuredDays)}일`
                    : "—"}
                </span>
              </div>
            </div>

            {/* recent 일별 수익률 */}
            {performance.recent && performance.recent.length > 0 && (
              <div className="briefing-perf-recent-block">
                <span className="briefing-perf-recent-label">최근 일별 수익률</span>
                <div className="briefing-perf-recent-list">
                  {performance.recent.map((rec) => {
                    const isUp = rec.returnPct > 0;
                    const isDown = rec.returnPct < 0;
                    const formatted = `${isUp ? "+" : ""}${rec.returnPct.toFixed(2)}%`;
                    return (
                      <div
                        key={rec.date}
                        className={`briefing-perf-recent-item ${
                          isUp ? "is-rise" : isDown ? "is-fall" : "is-flat"
                        }`}
                      >
                        <span className="briefing-perf-recent-date">{rec.date}</span>
                        <span className="briefing-perf-recent-val">
                          {isUp && <TrendingUp aria-hidden="true" size={11} />}
                          {isDown && <TrendingDown aria-hidden="true" size={11} />}
                          {!isUp && !isDown && <Minus aria-hidden="true" size={11} />}
                          <span className="briefing-sr-only">{isUp ? "상승 " : isDown ? "하락 " : "보합 "}</span><span>{formatted}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 성과 기록 페이지 링크 */}
            <div className="briefing-composition-link-row">
              <Link to={paths.history} className="briefing-composition-history-link">
                <span>성과 기록 자세히 보기</span>
                <ArrowRight aria-hidden="true" size={13} />
              </Link>
            </div>
          </div>
        )}
        <p className="briefing-muted briefing-perf-limit">과거 기록은 미래 수익을 보장하지 않으며 표본이 작습니다.</p>
      </div>

      {/* 3. 공통 주의사항 리스트 */}
      {commonCautions && commonCautions.length > 0 && (
        <div className="briefing-composition-cautions-block" data-testid="composition-cautions">
          <h3 className="briefing-composition-subheading is-caution">TOP5 공통 주의사항</h3>
          <ul className="briefing-composition-cautions-list">
            {[...new Set(commonCautions)].map(caution => (
              <li key={caution} className="briefing-composition-caution-item">
                <AlertTriangle aria-hidden="true" size={13} className="briefing-caution-bullet-icon" />
                <span>{caution}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

    </section>
  );
}
