const hiddenEvidence = /수급|순매[수도]|근거\s*일치(?:도|율)|(?:외국인|기관)[^.!?\n]{0,40}(?:차익\s*실현|매물\s*출회|매[수도]세|매[수도]\s*(?:우위|연장|지속|흐름|금액|물량)|자금\s*(?:유입|유출))|매[수도]세\s*(?:유입|확산|진정|지속|약화|강화|증가|감소)/;

/** Hide retired evidence in UI prose only. Stored analysis and article text stay intact. */
export function visibleAnalysisText(value: string | null | undefined): string {
  return (value ?? "").split(/(?<=[.!?。])\s+|[\r\n]+/).filter(sentence => !hiddenEvidence.test(sentence)).join(" ").trim();
}

/** A server stage may still process inputs that this website no longer displays. */
export function analysisProgressText(value: unknown, fallback = "서버에서 분석을 진행하고 있습니다."): string {
  return typeof value === "string" && value && !hiddenEvidence.test(value) ? value : fallback;
}
