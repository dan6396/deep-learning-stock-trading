import type { IndexData } from "../../entities/market";
import type { DataResult } from "../../entities/source";
import { formatNumber, formatPercent } from "../../shared/lib/format";
import { SourceMeta } from "./SourceMeta";

export function marketAssessment(indices: DataResult<IndexData>[]): string {
  const evaluable = indices.filter(index => (index.source === "cache" || index.source === "live") && index.data.value !== null && index.data.value > 0 && index.data.changeRate !== null && Number.isFinite(index.data.changeRate));
  if (evaluable.length < 2) return "판정 불가 · 확인 가능한 지수가 부족합니다";
  const mean = evaluable.reduce((sum, index) => sum + index.data.changeRate!, 0) / evaluable.length;
  return mean > 0.3 ? "상승 흐름 우위" : mean < -0.3 ? "하락 흐름 우위" : "방향 혼재";
}
export function MarketOverview({ indices, pending, error, previous }: { indices: DataResult<IndexData>[]; pending: boolean; error: boolean; previous: boolean }) {
  return <section className="briefing-market" aria-label="시장 지수">
    <div className="briefing-market-heading"><span>시장 흐름</span><strong>{marketAssessment(indices)}</strong><small>지수 등락률 기반 단순 판단 · 투자 판단 지표 아님</small></div>
    {error && <p className="briefing-notice" role="status">{previous ? "이전 조회 결과 · 지수 갱신 실패" : "지수 조회 실패 · 시장 흐름 판정 불가"}</p>}
    {pending && <p role="status">지수를 조회하고 있습니다.</p>}
    <div className="briefing-index-grid">{indices.map(index => <article className="briefing-index" key={index.data.symbol} data-index-symbol={index.data.symbol}>
      <div className="briefing-index-title"><strong>{index.data.name ?? index.data.symbol}</strong><span className={index.data.changeRate !== null && index.data.changeRate < 0 ? "briefing-fall" : index.data.changeRate !== null && index.data.changeRate > 0 ? "briefing-rise" : undefined}>{formatPercent(index.data.changeRate, "percent")}</span></div>
      <b>{formatNumber(index.data.value, 2)}</b>
      <SourceMeta source={index.source} asOf={index.asOf} />
      <span className="briefing-series-label">시계열: {index.data.miniSeriesSource === "history" ? "과거 관측값" : index.data.miniSeriesSource === "interpolated" ? "보간값 · 실제 이력 아님" : "출처 미확인"}</span>
    </article>)}</div>
  </section>;
}
