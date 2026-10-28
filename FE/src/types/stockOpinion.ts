/** Analysis summary only. Direction, stance and investment advice are forbidden. */
export type StockAiOpinion = {
  source: "llm" | "template";
  text: string;
  citations: string[];
  generatedAt?: string;
};
export type StockOpinion = StockAiOpinion & { code: string };
