import type { BriefingInput } from "./briefing";
/** No rounding, scaling or cross-article numeric allowances. Punctuation normalizes only commas. */
export function newsNumericTokens(text: string): string[] {
  return [...text.normalize("NFKC").matchAll(/[+-]?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?\s*(?:%p|퍼센트포인트|퍼센트|%|조원|억원|만원|원|계약|주|배|명|건|개|년|월|일)?/g)]
    .map(match => match[0].replace(/[,\s]/g, ""));
}
export function articleFactsGrounded(text: string, input: BriefingInput, index: number, citations: string[]): boolean {
  const articles = input.stocks[index].news.articles;
  if (!citations.length || citations.some(id => !articles.some(article => article.id === id))) return false;
  const selected = articles.filter(article => citations.includes(article.id));
  // Explicit publisher attribution cannot point to another article's facts.
  for (const article of articles) if (article.source && text.includes(article.source) && !selected.some(row => row.source === article.source)) return false;
  const available = new Set(selected.flatMap(article => newsNumericTokens(article.title + "\n" + (input.articleExcerpts?.[article.id]?.text ?? "") + "\n" + (input.articleBodies?.[article.id]?.text ?? ""))));
  const lexical = selected.reduce((content, article) => article.source ? content.split(article.source).join(article.source.replace(/\d/g, " ")) : content, text);
  return newsNumericTokens(lexical).every(token => available.has(token));
}
