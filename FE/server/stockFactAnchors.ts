import type { BriefingInput } from "./briefing";
import { MACRO_NAME_ALIASES } from "./briefingValidation";

const genericTopics = new Set(["기사", "관련", "소식", "주제", "내용", "보도", "발표", "확인", "본문", "제목", "자료", "사실", "해당", "입력", "기준"]);
/** This is a conservative lexical anchor, not a semantic entailment claim. */
export function citedArticleTopic(text: string, input: BriefingInput, index: number, citations: string[]): boolean {
  const stock = input.stocks[index];
  const lexical = text.normalize("NFKC");
  return stock.news.articles.filter(article => citations.includes(article.id)).some(article => {
    const source = `${article.title} ${input.articleExcerpts?.[article.id]?.text ?? ""} ${input.articleBodies?.[article.id]?.text ?? ""}`.normalize("NFKC");
    const terms = source.match(/[가-힣]{2,}|[a-zA-Z]{3,}/g) ?? [];
    return terms.some(term => {
      const stem = term.replace(/(?:에서는|으로|에서|에게|이다|했다|한다|하며|하고|은|는|이|가|을|를|의|와|과)$/, "");
      return stem.length >= 2 && !genericTopics.has(stem) && !stock.name.includes(stem) && lexical.includes(stem);
    });
  });
}

/** Run after quantity/category checks: a label alone cannot anchor an opinion. */
export function stockFactAnchor(text: string, input: BriefingInput, index: number, citations: string[]): string | null {
  const stock = input.stocks[index];
  if (/(?:순위|모델)(?:\s*순위)?(?:는|가|은|:)?\s*\d+\s*위|(?:모집단|전체)\s*\d+\s*개|상위\s*[\d.]+\s*%|(?:순위\s*)?점수(?:는|가|:)?\s*[+-]?\d/.test(text)) return "model_fact";
  if (stock.analysisMetrics?.features.some(feature => {
    const label = feature.key === "f_rsi" ? "(?:상대강도(?:\\s*지표)?|RSI)" : feature.key === "f_pct_b" ? "(?:가격\\s*밴드\\s*내\\s*종가\\s*위치|밴드\\s*내\\s*종가\\s*위치|밴드\\s*위치)" : "(?:전일\\s*종가\\s*대비\\s*고가|종가\\s*대비\\s*고가)";
    return new RegExp(`${label}(?:\\s*(?:지표|백분위|위치|은|는|가|:))*\\s*(?:상위|하위)?\\s*[\\d.]+\\s*%`, "i").test(text);
  })) return "feature_percentile";
  if (stock.analysisMetrics?.agreement && /20\s*일|120\s*일|모델/.test(text) && text.includes(stock.analysisMetrics.agreement)) return "model_agreement";
  if (/(?:근거|주의|기사|보도)\s*\d+\s*건|\d+\s*건의\s*(?:기사|보도)/.test(text)) return "input_count";
  if (citedArticleTopic(text, input, index, citations)) return "article_topic";
  if ([...input.macro.indicators, ...(input.macro.preOpen ?? [])].some(row => row.id !== "SP500" && row.status === "ok"
    && [row.name, ...(MACRO_NAME_ALIASES[row.id] ?? [])].some(name => text.includes(name))
    && /\d[\d,.]*\s*(?:%p?|bp|원|pt|계약)|\d+\s*(?:거래일|일)\s*연속\s*순매[수도]/i.test(text))) return "market_fact";
  // Fixed descriptions of purpose/limitations, not unrestricted positive prose.
  if (/(?:순위|점수|주가).{0,28}(?:수익률|확률|예측|기대수익).{0,12}(?:아닙니다|아니며|의미하지\s*않|뜻하지\s*않)/.test(text)
    || /방향\s*판단(?:은|을)?\s*하지\s*않/.test(text)
    || /지표.{0,25}(?:상대적\s*위치|종목\s*간\s*비교|비교.{0,8}활용)/.test(text)
    || /시장\s*지표는\s*별도로\s*확인할\s*수\s*있습니다/.test(text)
    || /기사\s*본문.{0,18}(?:확보|수집).{0,18}(?:기사마다\s*다|여부)/.test(text)) return "fixed_caution";
  if (/본문.{0,15}(?:미수집|수집하지\s*않|수집되지\s*않|확인되지\s*않)/.test(text)
    && stock.news.articles.every(article => !input.articleBodies?.[article.id])) return "body_availability";
  if (stock.cautions.length && /(?:일부\s*(?:입력\s*)?자료|기준일).{0,30}(?:미확인|불일치|확인하지\s*못|차이)/.test(text)) return "input_caution";
  return null;
}

export function newsFactAnchor(text: string, input: BriefingInput, index: number, citations: string[]): boolean {
  return /(?:다룬\s*기사|(?:라고|다고)\s*보도했|(?:을|를)\s*발표했|발표했다고\s*보도했)/.test(text)
    && citedArticleTopic(text, input, index, citations);
}
