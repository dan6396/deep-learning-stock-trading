import type { Diversification } from "../../entities/stockInsight";

export function CompositionObservations({ data, stocks = [] }: { data?: Diversification | null; stocks?: { code: string; name: string }[] }) {
  if (!data) return null;
  const name = (code: string) => stocks.find(stock => stock.code === code)?.name ?? code;
  return <div className="briefing-correlation-block">
    <h3 className="briefing-composition-subheading">종목 간 과거 상관</h3>
    {data.status === "ready" ? <>
      <p>공통 관측 {data.samples}일 · 평균 상관 {data.averageCorrelation === null ? "—" : data.averageCorrelation.toFixed(2)}</p>
      <div className="briefing-correlation-scroll" role="region" aria-label="TOP5 상관행렬" tabIndex={0}>
        <table className="briefing-correlation-table"><caption>종가→종가 일수익률 · {data.periodStart} ~ {data.periodEnd}</caption><thead><tr><th scope="col">종목</th>{data.codes.map(code => <th scope="col" key={code}>{name(code)}</th>)}</tr></thead><tbody>{data.codes.map((code, i) => <tr key={code}><th scope="row">{name(code)}</th>{data.codes.map((other, j) => { const value = data.matrix[i]?.[j] ?? null; return <td key={other} style={{ backgroundColor: value === null ? undefined : `color-mix(in srgb, var(--ds-fg-2) ${Math.round(Math.abs(value) * 22)}%, var(--ds-surface))` }}>{value === null ? "—" : value.toFixed(2)}</td>; })}</tr>)}</tbody></table>
      </div>
      {data.highestPair && <p>최고 상관 쌍: {data.highestPair.codes.map(name).join("·")} ({data.highestPair.correlation.toFixed(2)})</p>}
    </> : <p className="briefing-muted">데이터 준비 중 · 최근 60거래일의 공통 관측 55일 이상 확보 후 상관을 표시합니다.</p>}
    {data.nasdaqBetas.length > 0 && <details><summary>직전 나스닥 장에 대한 베타 비교</summary><ul>{data.nasdaqBetas.map(row => <li key={row.code}>{name(row.code)} · 종가→종가 {row.closeToClose.toFixed(2)} / 시가→종가 {row.openToClose.toFixed(2)} · {row.samples}일</li>)}</ul></details>}
    {data.commonRisks.length > 0 && <ul>{data.commonRisks.map(text => <li key={text}>{text}</li>)}</ul>}
    <p className="briefing-muted">{data.note}</p>
  </div>;
}
