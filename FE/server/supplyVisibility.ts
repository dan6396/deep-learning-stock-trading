/** Publication is opt-in until the upstream supply environment has been verified. */
export const showBriefingSupply = (env: Record<string, string | undefined>) => ["true", "1"].includes(env.BRIEFING_SHOW_SUPPLY?.trim().toLowerCase() ?? "");
export function withoutSupplyFields<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !/^(?:supply_|total_supply_|foreign_|inst_|institution_|combined_)/.test(key))) as T;
}
