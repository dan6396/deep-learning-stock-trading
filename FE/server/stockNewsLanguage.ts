import { KOSPI200_POOL } from "./kospi200Pool";
import type { BriefingInput } from "./briefing";
export const compactPolicyText = (text: string) => text.normalize("NFKC").replace(/[\s\p{P}\p{S}\u200b-\u200f\ufeff]/gu, "").toLowerCase();
const directionTerms = /급등|급락|오름세|내림세|저평가|고평가|상방|하방|랠리|돌파|지지선|저항선|과열|바닥|반등|추가상승|추가하락|모멘텀|목표주가|목표가격|적정가격|적정가치|저점매수|고점매수|저가매수|고점매도|상승할것|하락할것|매력|호실적|강세|좋은흐름|흐름이좋|레벨업|신고가|매집|시세분출|오르는방향|저점에서올라설|수익이날것|올라갈여지|bullish|bearish|upside|downside|overweight|underweight|outperform|underperform|rally|breakout/g;
/** Mask complete denial/function spans only, never the remainder of a sentence. */
export function stockPolicyAssertions(text: string): string {
  return text.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/(?:확률적\s*수익|수익률|확률|예측|전망|기대수익)(?:\s*(?:이나|나|과|와|·)\s*(?:수익률|확률|예측|전망|기대수익))*(?:을|를|은|는|이|가)?\s*(?:(?:의미|뜻)하지\s*않(?:습니다|으며)|아닙니다|아니며|아님)/g, "면책 설명")
    .replace(/(?:비교에\s*활용|별도로\s*확인|비교|확인|활용)할\s*수\s*있(?:습니다|으며)/g, "기능 설명");
}
function forbiddenTerm(text: string): boolean {
  const normalized = text.normalize("NFKC").toLowerCase(), positions: number[] = [];
  let dense = "";
  for (let i = 0; i < normalized.length; i++) if (!/[\s\p{P}\p{S}\u200b-\u200f\ufeff]/u.test(normalized[i])) { dense += normalized[i]; positions.push(i); }
  for (const match of dense.matchAll(directionTerms)) {
    const start = match.index!, end = start + match[0].length;
    // A match spanning two substantive words (대상 방식) is not an obfuscated
    // single word (상 방 / 상·방). Preserve contiguous matches and punctuation guards.
    const boundary = positions.slice(start + 1, end).some((position, j) => /\s/.test(normalized.slice(positions[start + j] + 1, position)));
    const before = normalized[positions[start] - 1] ?? "", after = normalized[positions[end - 1] + 1] ?? "";
    if (!(boundary && /[가-힣a-z]/i.test(before) && /[가-힣a-z]/i.test(after))) return true;
  }
  return false;
}
/** Deliberately scoped to stock opinions and news; marketOutlook has its own policy. */
export function forbiddenStockNewsForecast(text: string): boolean {
  if (forbiddenTerm(text)) return true;
  // Do not let punctuation inserted inside a Korean word create a fake sentence.
  return text.split(/(?<=[다요음임][.!?。])\s+|\n+/).some(sentence => {
    const dense = compactPolicyText(stockPolicyAssertions(sentence));
    return /주가|가격|실적|종목|시장|코스피|코스닥|나스닥|매출|이익|주식/.test(dense)
      && /할것|될것|일것|갈것|뛸것|오를것|내릴것|질것|될듯|수있|가능성|여지|전망|예상|기대|우려|보인다/.test(dense);
  });
}
const groupPrefixes = /^(?:sk|lg|hd|kt|kb|nh|bnk|dgb|jb|gs|cj|ls|db|삼성|현대|한화|신한|하나|우리|한국|대한)/i;
export function stockNameAliases(name: string): string[] {
  const names = [compactPolicyText(name)]; let remaining = names[0];
  while (groupPrefixes.test(remaining)) { remaining = remaining.replace(groupPrefixes, ""); if (remaining.length > 2) names.push(remaining); else break; }
  return [...new Set(names)].filter(Boolean);
}
export function mentionsOtherStock(text: string, input: BriefingInput, index: number): boolean {
  const own = input.stocks[index], aliases = stockNameAliases(own.name);
  let dense = compactPolicyText(text);
  for (const name of [...aliases].sort((a, b) => b.length - a.length)) dense = dense.split(name).join("");
  return [...KOSPI200_POOL, ...input.stocks].some(stock => stock.code !== own.code && stockNameAliases(stock.name).some(alias => !aliases.includes(alias) && dense.includes(alias)));
}
