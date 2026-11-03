/** Analysis summary only. Direction, stance and investment advice are forbidden. */
export type StockAiOpinion = {
  source: "llm" | "template";
  text: string;
  citations: string[];
  generatedAt?: string;
  /** /stock 통합 문단: ai = Gemini가 조각을 읽고 새로 쓴 문단, rule = 검증된 AI 문장을 규칙으로 연결. */
  composition?: "ai" | "rule";
};
export type StockOpinion = StockAiOpinion & { code: string };
