import type { Diversification, StockInsight, SensitivityMetric } from "../types/stockInsight";
export type * from "../types/stockInsight";
import { adaptModelEvidence } from "./modelEvidence";
import { record, finiteNumber, textValue, stockCode } from "./value";
import { safeArticleUrl } from "../shared/lib/articleUrl";
export function adaptDiversification(raw: unknown): Diversification | null {
  const row = record(raw), codes = Array.isArray(row.codes) ? row.codes.filter((code): code is string => stockCode(code) !== null) : [];
  if (!codes.length || codes.length > 5 || new Set(codes).size !== codes.length || !Array.isArray(row.matrix) || row.matrix.length !== codes.length) return null;
  const bounded = (value: unknown) => { const n = finiteNumber(value); return n !== null && Math.abs(n) <= 1 ? n : null; };
  const matrix = row.matrix.map(line => Array.isArray(line) && line.length === codes.length ? line.map(bounded) : codes.map(() => null));
  const pair = record(row.highestPair), pairCodes = Array.isArray(pair.codes) ? pair.codes.filter(code => codes.includes(String(code))) : [];
  const correlation = bounded(pair.correlation);
  return { status: row.status === "ready" ? "ready" : "preparing", codes, matrix, samples: finiteNumber(row.samples) ?? 0,
    periodStart: textValue(row.periodStart), periodEnd: textValue(row.periodEnd), averageCorrelation: bounded(row.averageCorrelation),
    highestPair: pairCodes.length === 2 && correlation !== null ? { codes: pairCodes as [string, string], correlation } : null,
    nasdaqBetas: Array.isArray(row.nasdaqBetas) ? row.nasdaqBetas.flatMap(value => { const b = record(value), code = stockCode(b.code), cc = finiteNumber(b.closeToClose), oc = finiteNumber(b.openToClose), samples = finiteNumber(b.samples);
      return code && cc !== null && oc !== null && samples !== null ? [{ code, closeToClose: cc, openToClose: oc, samples }] : []; }) : [],
    commonRisks: Array.isArray(row.commonRisks) ? row.commonRisks.filter((v): v is string => typeof v === "string") : [], note: textValue(row.note) ?? "" };
}
export function adaptStockInsight(raw: unknown, expectedCode: string): StockInsight {
  const root = record(raw), s = record(root.sensitivity), news = record(root.news), meta = record(root.data_meta);
  if (stockCode(root.code) !== expectedCode || root.version !== 1) throw new Error("종목 근거 응답을 확인할 수 없습니다.");
  const metrics = Array.isArray(s.metrics) ? s.metrics.flatMap(value => { const m = record(value), correlation = finiteNumber(m.correlation), beta = finiteNumber(m.beta), samples = finiteNumber(m.samples);
    return ["close_to_close", "open_to_close"].includes(String(m.definition)) && correlation !== null && Math.abs(correlation) <= 1 && beta !== null && samples !== null && samples >= 200
      ? [{ definition: m.definition as SensitivityMetric["definition"], correlation, beta, samples }] : []; }) : [];
  const conditional = record(s.conditional), nums = ["count", "total", "ratioPct", "baselinePct", "baselineCount", "baselineTotal"].map(key => finiteNumber(conditional[key]));
  const validConditional = nums.every(v => v !== null && v >= 0) && nums[1]! >= 30 && nums[0]! <= nums[1]! && nums[2]! <= 100 && nums[3]! <= 100;
  const articles = Array.isArray(news.articles) ? news.articles.flatMap(value => { const a = record(value), id = textValue(a.id), title = textValue(a.title), url = safeArticleUrl(textValue(a.url));
    return id && title && url ? [{ id, title, url, source: textValue(a.source) ?? "", pubDate: textValue(a.pubDate) }] : []; }) : [];
  return { version: 1, code: expectedCode, name: textValue(root.name) ?? expectedCode, status: root.status === "ready" ? "ready" : "no_model", baseDate: textValue(root.baseDate), model: adaptModelEvidence(root.model),
    sensitivity: { status: s.status === "ready" && metrics.length === 2 ? "ready" : "preparing", metrics, samples: finiteNumber(s.samples) ?? 0, asOf: textValue(s.asOf),
      periodStart: textValue(s.periodStart), periodEnd: textValue(s.periodEnd), complete: s.complete === true,
      conditional: validConditional ? { count: nums[0]!, total: nums[1]!, ratioPct: nums[2]!, baselinePct: nums[3]!, baselineCount: nums[4]!, baselineTotal: nums[5]! } : null,
      source: textValue(s.source) ?? "", note: textValue(s.note) ?? "" },
    news: { summary: textValue(news.summary) ?? "", source: news.source === "llm" ? "llm" : "template", bodyCollected: false, limitation: textValue(news.limitation) ?? "기사 본문은 수집하지 않았습니다.", articles,
      citations: Array.isArray(news.citations) ? news.citations.filter((id): id is string => typeof id === "string" && articles.some(a => a.id === id)) : [] },
    cautions: Array.isArray(root.cautions) ? root.cautions.filter((v): v is string => typeof v === "string") : [], data_meta: { source: "cache", asOf: textValue(meta.asOf) } };
}
