/** News is displayed without sentence validation unless explicitly enabled. */
export const newsValidationEnabled = (input: { newsValidation?: string }) => input.newsValidation === "on";
export const configuredNewsValidation = (env: Record<string, string | undefined>): "on" | "off" => env.BRIEFING_NEWS_VALIDATION === "on" ? "on" : "off";
