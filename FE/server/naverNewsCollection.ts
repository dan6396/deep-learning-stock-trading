import { searchNaverNews, filterRelevantNaverNews, type NaverNewsItem, type NaverNewsOptions, type NaverNewsResult } from "./naverNews";
import { isRelatedArticle } from "../src/shared/lib/relatedArticles";

const economics = /주가|주식|증권|공시|실적|매출|영업이익|순이익|배당|자사주|상장|투자|합병|인수|수주|계약|사업|기업|경영|대표이사|이사회|통신|반도체|생산|공장|판매|서비스|신제품|출시|고객|요금|금융|은행|지주/g;
const financeTerms = /금융감독원|금융감독위원회|금융감독|감독당국|감독기관|보험감독|선수금|선수수익|선수비용|우선수익권|배우자/gi;
const sports = /프로야구|프로농구|프로배구|가을야구|야구장|야구단|농구단|축구단|한국시리즈|포스트시즌|챔피언|골든글러브|선발투수|홈런|타율|타점|FA\s*계약|감독\s*(?:선임|교체|취임)|선수단|선수\s*(?:영입|이적|등록)|(?:^|[^\p{L}\p{N}])(?:감독|선수)(?:은|는|이|가|를|와|의|들)?(?=$|[^\p{L}\p{N}])|\bLCK\b|\bKT\s*(?:wiz|위즈|롤스터)|\bkt\s*rolster/iu;
const entertainment = /연예|드라마|아이돌|열애|콘서트|배우\s*(?:출연|캐스팅)|(?:^|[^\p{L}\p{N}])배우(?:은|는|이|가|를|와|의|들)?(?=$|[^\p{L}\p{N}])/iu;
export function excludedNewsTopicReason(text: string): "sports_topic" | "entertainment_topic" | null {
  const value = text.replace(financeTerms, " ");
  return sports.test(value) ? "sports_topic" : entertainment.test(value) ? "entertainment_topic" : null;
}

export function excludedNewsSection(raw: string): boolean {
  try {
    const url = new URL(raw), host = url.hostname.toLowerCase();
    return /(^|\.)(?:sports|entertain)(?:\.news)?\.naver\.com$/.test(host)
      || /^(?:sports|sport|entertain|star)\./.test(host)
      || /(^|\.)(?:sportschosun\.com|sportsseoul\.com|sportalkorea\.com|sportsworldi\.com|spotvnews\.co\.kr|osen\.co\.kr|xportsnews\.com|stardailynews\.co\.kr)$/.test(host)
      || /\/(?:sports?|entertain(?:ment)?|baseball|basketball|football|celebrity|star)(?:\/|$)/i.test(url.pathname)
      || /^(?:sports?|entertain(?:ment)?|baseball|celebrity)$/i.test(url.searchParams.get("section") ?? "");
  } catch { return true; }
}

/** Name-only search preserves corporate releases; short ambiguous names additionally
 * require business vocabulary. Negative sports sections/topics take precedence over
 * words such as 'contract' that also occur in player transfers. False negatives are
 * preferred to presenting a sports team as evidence about a listed company. */
export function selectCompanyNaverNews(items: NaverNewsItem[], companyName: string, now = Date.now()): NaverNewsItem[] {
  const relevant = new Set(filterRelevantNaverNews(items, companyName, { now })), reasonCounts: Record<string, number> = {};
  const selected = items.filter(item => {
    const text = `${item.title} ${item.description}`;
    const age = now - Date.parse(item.pubDate);
    const reason = !Number.isFinite(age) || age < 0 || age > 7 * 86_400_000 ? "invalid_or_stale_date"
      : !relevant.has(item) || !isRelatedArticle(text, companyName) ? "company_name"
      : excludedNewsSection(item.originalUrl) || item.naverUrl && excludedNewsSection(item.naverUrl) ? "excluded_section"
      : excludedNewsTopicReason(text) ?? (companyName.length <= 3 && ![...text.matchAll(economics)].length ? "business_context" : null);
    if (reason) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    return !reason;
  }).map(item => ({ item, score: [...item.title.matchAll(economics)].length * 2 + [...item.description.matchAll(economics)].length }))
    .sort((a, b) => b.score - a.score || Date.parse(b.item.pubDate) - Date.parse(a.item.pubDate)).map(row => row.item);
  if (Object.keys(reasonCounts).length) console.info("[news] Naver filtered", { total: items.length, selected: selected.length, reasonCounts });
  return selected;
}

export function excludedNewsTopic(title: string): boolean { return excludedNewsTopicReason(title) !== null; }

/** 25,000 calls/day across Naver search APIs. TOP5 uses five requests at most;
 * cache by analysis date + company and coalesce concurrent requests. No retries.
 * Successful metadata/excerpts stay in process memory for 24h, never on disk. */
export function createNaverNewsCache() {
  const cache = new Map<string, { result: NaverNewsResult; expiresAt: number }>();
  const pending = new Map<string, Promise<NaverNewsResult>>();
  let backoff: { result: NaverNewsResult; until: number } | undefined;
  return async (query: string, options: NaverNewsOptions & { cacheKey: string; now?: () => number }): Promise<NaverNewsResult> => {
    const now = options.now ?? Date.now, env = options.env ?? process.env;
    if (!env.NAVER_CLIENT_ID?.trim() || !env.NAVER_CLIENT_SECRET?.trim()) return { status: "unconfigured", items: [] };
    const saved = cache.get(options.cacheKey);
    if (saved && now() < saved.expiresAt) return structuredClone(saved.result);
    if (backoff && now() < backoff.until) return structuredClone(backoff.result);
    if (pending.has(options.cacheKey)) return structuredClone(await pending.get(options.cacheKey)!);
    const work = (async () => {
      const result = await searchNaverNews(query, options);
      if (result.status !== "unconfigured") {
        const delay = result.status === "ok" ? 86_400_000 : result.error.retryAfterMs ?? 60_000;
        cache.set(options.cacheKey, { result, expiresAt: now() + delay });
        if (result.status === "error" && (result.error.httpStatus === 429 || (result.error.httpStatus ?? 0) >= 500)) backoff = { result, until: now() + delay };
        while (cache.size > 1000) cache.delete(cache.keys().next().value!);
      }
      return result;
    })();
    pending.set(options.cacheKey, work);
    try { return structuredClone(await work); } finally { pending.delete(options.cacheKey); }
  };
}
export const cachedNaverNewsSearch = createNaverNewsCache();
