import { configuredNewsValidation } from "./newsValidation";
import { join } from "node:path";
import type { BriefingInput } from "./briefing";
import type { HeadlineSummary } from "../src/types/preOpenMacro";
import { pipelineOutputDir } from "./pipelineFreshness";
import { selectHeadlineSummary } from "./briefingExtensions";
import { readCachedJsonFile } from "./cachedJsonFile";
import { articleBodyHashes, articleExcerptHashes, cachedArticleContext } from "./articlePrivacy";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Both views use the same sentence selection and citation/number checks. */
export function currentHeadlineSummary(value: unknown, input: BriefingInput, index: number): HeadlineSummary | null {
  if (object(value) && (input.newsValidation !== "on") !== (value.validation === "off")) return null;
  return object(value) && value.source === "llm" ? selectHeadlineSummary(value, input, index) : null;
}

function articleIdentity(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const articles = [];
  for (const article of value) {
    if (!object(article) || typeof article.id !== "string" || typeof article.title !== "string" || typeof article.url !== "string") return null;
    let url: URL;
    try { url = new URL(article.url); } catch { return null; }
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = ""; url.searchParams.sort();
    articles.push({ id: article.id, title: article.title.normalize("NFKC").trim().replace(/\s+/g, " "),
      url: url.toString(), source: article.source ?? "", pubDate: article.pubDate ?? null });
  }
  return JSON.stringify(articles);
}

/** The old envelope never licenses a whole narrative: only matching articles and
 * the current headline guards can license this one field. No writes or generation. */
export function recoverHeadlineSummaries(value: unknown, input: BriefingInput): HeadlineSummary[] {
  if (!object(value) || !object(value.input) || !Array.isArray(value.input.stocks)
    || !object(value.narrative) || !Array.isArray(value.narrative.newsSummaries)) return [];
  const stocks = value.input.stocks, candidates = value.narrative.newsSummaries;
  if ((value.input.newsValidation ?? "off") !== (input.newsValidation ?? "off")) return [];
  return input.stocks.flatMap((stock, index) => {
    const previous = stocks.find(row => object(row) && row.code === stock.code);
    if (!object(previous) || !object(previous.news) || previous.news.status !== stock.news.status
      || articleIdentity(previous.news.articles) !== articleIdentity(stock.news.articles)) return [];
    const candidate = candidates.find(row => object(row) && row.code === stock.code);
    if (input.newsValidation === "on" && object(candidate) && candidate.summaryBasis === "body" && Array.isArray(candidate.citations)) {
      const oldHashes = articleBodyHashes(value.input as BriefingInput), currentHashes = articleBodyHashes(input);
      if (candidate.citations.some(id => typeof id === "string" && oldHashes[id] && oldHashes[id] !== currentHashes[id])) return [];
    }
    if (input.newsValidation === "on" && object(candidate) && ["body", "excerpt"].includes(String(candidate.summaryBasis)) && Array.isArray(candidate.citations)) {
      const oldHashes = articleExcerptHashes(value.input as BriefingInput), currentHashes = articleExcerptHashes(input);
      if (candidate.summaryBasis === "excerpt" && !candidate.citations.some(id => typeof id === "string" && oldHashes[id])) return [];
      if (candidate.citations.some(id => typeof id === "string" && oldHashes[id] && oldHashes[id] !== currentHashes[id])) return [];
    }
    const selected = currentHeadlineSummary(candidate, input, index);
    return selected ? [selected] : [];
  });
}

export async function readCachedHeadlineSummaries(input: BriefingInput, env: Record<string, string | undefined>): Promise<HeadlineSummary[]> {
  return (await readCachedHeadlineRecord(input, env)).summaries;
}
export async function readCachedHeadlineRecord(input: BriefingInput, env: Record<string, string | undefined>): Promise<{ summaries: HeadlineSummary[]; generatedAt: string; llmModel: string | null }> {
  try {
    input = { ...input, newsValidation: configuredNewsValidation(env), ...await cachedArticleContext(input, pipelineOutputDir(env)) };
    const value = await readCachedJsonFile(join(pipelineOutputDir(env), "briefing-narrative.json"));
    const narrative = object(value) && object(value.narrative) ? value.narrative : {};
    return { summaries: recoverHeadlineSummaries(value, input), generatedAt: typeof narrative.generatedAt === "string" && Number.isFinite(Date.parse(narrative.generatedAt)) ? narrative.generatedAt : "",
      llmModel: typeof narrative.llmModel === "string" && /^[\w.-]{1,100}$/.test(narrative.llmModel) ? narrative.llmModel : null };
  } catch { return { summaries: [], generatedAt: "", llmModel: null }; }
}
