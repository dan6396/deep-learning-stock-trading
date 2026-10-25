/** ASCII endings use Korean digit/letter names; unknown symbols are vowel endings. */
export function hasFinalConsonant(value: string): boolean {
  const last = [...value.trim().replace(/[\s\p{P}\p{S}]+$/gu, "")].pop();
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/\d/.test(last)) return "013678".includes(last);
  if (/[a-z]/i.test(last)) return "lmnr".includes(last.toLowerCase());
  return false;
}
export function koreanParticle(value: string, pair: "은/는" | "이/가" | "을/를" = "은/는"): string {
  return `${value}${pair.split("/")[hasFinalConsonant(value) ? 0 : 1]}`;
}
