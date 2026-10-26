import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { adaptStockInsight } from "../../entities/stockInsight";
import { withoutRankScoreDisclaimer } from "../../entities/briefing";
import { formatModelPercent } from "../../entities/modelEvidence";
import { formatReportRankScore } from "./reportData";
import { PastObservationTag } from "../briefing/PastObservationTag";
import "./stockInsight.css";

function CollapsibleNote({ text }: { text?: string | null }) {
  if (!text) return null;
  if (text.length <= 100) {
    return <p className="report-muted">{text}</p>;
  }
  let splitIndex = -1;
  const match = text.match(/^(?:[^.!?]+[.!?]+){1,2}/);
  if (match && match[0].length >= 30 && match[0].length < text.length) {
    splitIndex = match[0].length;
  }
  if (splitIndex === -1 && text.length > 100) {
    const space = text.indexOf(" ", 80);
    if (space !== -1 && space < text.length - 15) {
      splitIndex = space;
    }
  }
  if (splitIndex === -1) {
    return <p className="report-muted">{text}</p>;
  }
  const preview = text.slice(0, splitIndex).trim();
  const rest = text.slice(splitIndex).trim();
  return (
    <div className="insight-expandable-note">
      <p className="report-muted">{preview}</p>
      {rest && (
        <details className="insight-details">
          <summary>자세히</summary>
          <p className="report-muted">{rest}</p>
        </details>
      )}
    </div>
  );
}

export function StockInsightSection({ code }: { code: string }) {
  const query = useQuery({ queryKey: ["stock-insight", code], queryFn: async ({ signal }) => {
    const result = await apiClient.request(`/api/stock-insight?code=${code}`, { signal }); return adaptStockInsight(result.data, code);
  }, staleTime: 60_000, retry: false, refetchInterval: query => query.state.data?.sensitivity.status === "preparing" ? 30_000 : false });
  if (!query.data) return null;
  const { model, sensitivity, news, cautions } = query.data, conditional = sensitivity.conditional;
  const visibleCautions = cautions.map(withoutRankScoreDisclaimer).filter(Boolean);
  if (!model && sensitivity.status !== "ready" && !news.articles.length && !visibleCautions.length) return null;
  return <section className="report-card insight-section" aria-labelledby="stock-input-observations-heading">
    <h2 id="stock-input-observations-heading">모델 순위와 주요 지표</h2>
    <p className="report-muted">모델 순위와 입력 특징을 함께 확인합니다. 특징의 위치가 개별 예측의 원인을 설명하지는 않습니다.</p>
    {model ? <>
      <p className="insight-rank">{model.poolSize.toLocaleString("ko-KR")}종목 중 <strong>{model.rank}위</strong> · 상위 {formatModelPercent(model.topPercent)} · 순위 점수 <span title={model.rankScore != null ? String(model.rankScore) : undefined}>{formatReportRankScore(model.rankScore)}</span></p>
      {model.lookbacks.length === 2 && <div className="insight-block"><h3 className="insight-comparison-heading">20일·120일 모델 비교{model.agreement && <span className="insight-agreement" title="모델 일치도">{model.agreement}</span>}</h3>
        <div className="insight-lookbacks">{model.lookbacks.map(lb => {
          const topPercent = formatModelPercent(lb.rank / model.poolSize * 100);
          return <div key={lb.sessions}><span>{lb.sessions}일 모델</span><svg role="img" aria-label={`${lb.sessions}일 모델 ${lb.rank}위, 상위 ${topPercent}`}><line x1="2%" x2="98%" y1="16" y2="16" stroke="var(--ds-fg-2)" strokeWidth="2" /><circle cx={`${2 + (lb.rank - 1) / Math.max(1, model.poolSize - 1) * 96}%`} cy="16" r="5" fill="var(--ds-fg)" /></svg><span className="insight-lookback-value"><strong>{lb.rank}위</strong><span>상위 {topPercent}</span></span></div>;
        })}</div><p className="report-muted">왼쪽이 상위 순위입니다. 두 순위 차이가 비교 종목 수의 10% 이내면 일치, 25% 이내면 부분 일치입니다.</p></div>}
      {model.features.length > 0 && <div className="insight-block"><h3>비교 종목 안에서의 지표 위치</h3><ul className="insight-features">{model.features.map(feature => <li key={feature.key}><span>{feature.label}</span><strong>{feature.side === "upper" ? "상위" : "하위"} {formatModelPercent(feature.tailPercent)}</strong><meter min={0} max={100} value={feature.percentile} aria-label={`${feature.label} 백분위`} /></li>)}</ul><CollapsibleNote text={model.note} /></div>}
      {!model.lookbacks.length && <p className="report-muted">이 실행에는 기간별 모델 순위와 입력 특징이 저장되지 않았습니다. 새 분석부터 제공됩니다.</p>}
    </> : <p>저장된 모델 순위에 포함되지 않은 종목입니다.</p>}
    {sensitivity.status === "ready" && <div className="insight-block"><h3>직전 미국장과의 관계</h3><>
      <div className="insight-scroll"><table><caption>최근 1년 나스닥 민감도 · {sensitivity.samples}일</caption><thead><tr><th scope="col">종목 수익 구간</th><th scope="col">상관계수</th><th scope="col">베타</th></tr></thead><tbody>{sensitivity.metrics.map(metric => <tr key={metric.definition}><th scope="row">{metric.definition === "close_to_close" ? "종가→종가" : "시가→종가"}</th><td>{metric.correlation.toFixed(2)}</td><td>{metric.beta.toFixed(2)}</td></tr>)}</tbody></table></div>
      {conditional && <p>나스닥 상승 뒤 이 종목의 시가→종가 상승 비율 {conditional.ratioPct.toFixed(1)}% ({conditional.count}/{conditional.total}일) · 같은 기간 전체 상승 비율 {conditional.baselinePct.toFixed(1)}% ({conditional.baselineCount}/{conditional.baselineTotal}일)</p>}
      <p className="report-muted">{sensitivity.periodStart} ~ {sensitivity.periodEnd} · {sensitivity.source}</p><PastObservationTag asOf={sensitivity.asOf} />
    </>
      {withoutRankScoreDisclaimer(sensitivity.note) && <CollapsibleNote text={withoutRankScoreDisclaimer(sensitivity.note)} />}</div>}
    {news.articles.length > 0 && <div className="insight-block"><h3>뉴스 이슈와 출처</h3><CollapsibleNote text={withoutRankScoreDisclaimer(news.summary)} /><div className="insight-news-chips">{news.articles.map(article => <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" title={`${article.title}${article.pubDate ? ` · ${article.pubDate}` : ""}`}>{article.source || "기사 원문"}</a>)}</div><p className="report-muted">{news.limitation}</p></div>}
    {visibleCautions.length > 0 && <div className="insight-block"><h3>참고 사항</h3><ul>{visibleCautions.map(caution => <li key={caution}>{caution}</li>)}</ul></div>}
  </section>;
}
