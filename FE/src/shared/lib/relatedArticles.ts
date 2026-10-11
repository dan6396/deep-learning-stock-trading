/** Conservative company-name matching: peers sharing a prefix are not matches. */
export function isRelatedArticle(title: string | null | undefined, companyName: string | null | undefined): boolean {
  const name = companyName?.normalize("NFKC").replace(/^(?:\(주\)|주식회사)\s*/, "").trim();
  if (!name || name.length < 2 || !title) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const particles = "(?:에서는|에서도|으로는|으로|에서|에게|까지|부터|처럼|보다|은|는|이|가|을|를|의|에|와|과|도|만|로)?";
  const normalized = title.normalize("NFKC");
  if (!new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${particles}(?![\\p{L}\\p{N}])`, "iu").test(normalized)) return false;
  // Ambiguous listed names also refer to sports teams, people or common nouns.
  // Prefer a false negative over presenting an unrelated headline as company news.
  const ambiguousNames = new Set(["삼성", "한화", "현대", "기아", "오리온", "두산", "대상", "동서", "대원", "농심", "넥센", "한국전력", "대한항공", "현대건설", "삼성화재"]);
  return !ambiguousNames.has(name) || /실적|매출|영업이익|순이익|배당|주가|주식|공시|유상증자|자사주|증권|상장|합병|인수|수주|계약|생산|공장|판매|신제품|출시|경영|대표이사|회장|기업|반도체|전기차/.test(normalized);
}
