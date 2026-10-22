/** Stored article-evidence vocabulary; current RSS collection uses collected/collection_failed. */
export const NEWS_COLLECTION_SUCCESS = ["analyzed", "no_usable_article"] as const;
export function isNewsCollectionSuccess(status: unknown): boolean {
  return typeof status === "string" && NEWS_COLLECTION_SUCCESS.some(success => success === status.trim().toLowerCase());
}
/** An older stored report may have no collection status; nonempty explicit LLM evidence is usable,
 * but cannot prove a successful zero-article collection. */
export function isNewsEvidenceStatus(status: unknown): boolean {
  return isNewsCollectionSuccess(status) || status === "llm_evidence";
}
