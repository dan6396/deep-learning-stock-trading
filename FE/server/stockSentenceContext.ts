import type { BriefingInput } from "./briefing";
import type { SentenceContext, SentenceSource } from "./stockSentenceAllowlist";
import { stockNameAliases } from "./stockNewsLanguage";

/** Read-only projection; private contexts stay in memory, outside the public API. */
export function stockSentenceContext(input: BriefingInput, index: number, field: SentenceContext["field"], citations: readonly string[]): SentenceContext {
  const stock = input.stocks[index], sources: SentenceSource[] = [];
  for (const article of stock.news.articles) {
    sources.push({ articleId: article.id, sourceKind: "title", text: article.title, publisher: article.source });
    const excerpt = input.articleExcerpts?.[article.id], body = input.articleBodies?.[article.id];
    if (excerpt?.text) sources.push({ articleId: article.id, sourceKind: "excerpt", text: excerpt.text, publisher: article.source });
    if (body?.text) sources.push({ articleId: article.id, sourceKind: "body", text: body.text, publisher: article.source });
  }
  return { field, stock, citations, sources, articleCount: stock.news.articles.length, baseDate: input.model?.baseDate,
    trustedTopicEntities: [stock.name, ...stockNameAliases(stock.name)], market: (input.macro.preOpen ?? input.macro.indicators).map(row => ({ id: row.id, name: row.name, status: row.status,
      value: row.value, change: row.change, changePct: row.changePct, unit: row.unit,
      ...("fiveDayChange" in row ? { fiveDayChange: row.fiveDayChange } : {}),
      ...("fiveDaySum" in row ? { fiveDaySum: row.fiveDaySum, consecutiveDays: row.consecutiveDays ?? undefined } : {}), asOf: row.asOf })) };
}
