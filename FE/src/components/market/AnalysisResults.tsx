import type { StockQuote } from "../../types/trading";

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatRate(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function resultTone(label: string) {
  return String(label).toUpperCase() === "POSITIVE" ? "is-positive" : "is-neutral";
}

/**
 * The post-analysis result: a clean ranked list of the AI-selected short-term
 * picks — 순위 · 종목 · 현재가 · 선정근거. Each row links into the full
 * step3-backed evidence report.
 */
export function AnalysisResults({
  stocks,
  onSelect,
}: {
  stocks: StockQuote[];
  onSelect: (stock: StockQuote) => void;
}) {
  return (
    <section className="analysis-results">
      <header className="analysis-results__head">
        <p className="eyebrow">
          <span aria-hidden="true" />
          AI SELECTED · 단기 선정 후보
        </p>
        <h2>AI가 선정한 단기 후보 {stocks.length}종목</h2>
        <p className="analysis-results__sub">
          순위는 Huber 예상수익률을 기준으로 합니다. 뉴스 사건 보정은 별도 검증을 통과한 경우에만 적용하며,
          <strong> 선정근거</strong>에서 가격 예측과 기사 근거를 각각 확인할 수 있습니다.
        </p>
      </header>

      <div className="result-list" role="table" aria-label="AI 선정 후보">
        <div className="result-row result-row--head" role="row">
          <span role="columnheader">순위</span>
          <span role="columnheader">종목</span>
          <span role="columnheader">현재가</span>
          <span role="columnheader" className="result-col-cta">
            선정근거
          </span>
        </div>

        {stocks.length === 0 ? (
          <div className="result-empty" role="row">
            <strong>이번 분석에서 표시할 상승·중립 후보가 없습니다.</strong>
            <p>분석 결과를 확인한 뒤 다시 시도해 주세요.</p>
          </div>
        ) : stocks.map((stock, index) => (
          <div className="result-row" role="row" key={stock.code}>
            <span className={`result-rank ${resultTone(stock.sentimentLabel)}`} role="cell">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="result-name" role="cell">
              <span className="result-logo" aria-hidden="true">
                {stock.name.slice(0, 1)}
              </span>
              <div>
                <strong>{stock.name}</strong>
                <small>{stock.code}</small>
              </div>
            </div>
            <div className="result-price" role="cell">
              <strong>{formatWon(stock.currentPrice)}</strong>
              <span
                className={stock.direction === "up" ? "is-up" : stock.direction === "down" ? "is-down" : ""}
              >
                {formatRate(stock.changeRate)}
              </span>
            </div>
            <button className="result-cta" type="button" onClick={() => onSelect(stock)}>
              선정근거 →
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
