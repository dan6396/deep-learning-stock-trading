import { pipelineRow } from "../../test/dataFixtures";

export function reportRow(code = "005930", name = "종목 A", prediction: unknown = .02) {
  const row = pipelineRow({ ticker: code, ensemble_pred_return: prediction, final_pred_return: .025, final_rank: 2, prediction_base_date: "2026-10-07", foreign_net_buy_sum: 0, inst_net_buy_sum: 10, pred_rank: 50 });
  row.result.ticker = code; row.result.company_name = name;
  row.news = [{ title: "원본 기사", sentiment: "unclear", sentiment_reason: "판정 불명 원본 근거", description: "기사 원본 설명", url: "javascript:alert(1)", source: "발행처", pub_date: "2026-10-07T09:00:00Z" }];
  return row;
}
export function chartBundle(code = "005930", source = "cache") {
  const candles = ["2026-10-05", "2026-10-06", "2026-10-07"].map((time, i) => ({ time, rawTime: time,
    open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, volume: 0,
    rawValues: { open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, volume: 0 } }));
  return { source, asOf: "2026-10-07T09:00:00Z", chartData: { code, symbol: code, ranges: Object.fromEntries(["1D", "1M", "3M", "1Y", "3Y", "5Y"].map(range => [range, { prices: candles.map(point => ({ date: point.time, rawDate: point.rawTime, price: point.close })), candles }])) } };
}
