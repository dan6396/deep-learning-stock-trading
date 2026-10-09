import type { CandidateData } from "../../entities/candidate";
import { candidateSignals, evidenceAgreement, SIGNAL_RULE_VERSION, type Signal } from "../../entities/signals";

export type CandidateMembership = "pending" | "unknown" | "candidate" | "nonCandidate";
/** Whether the news-adjusted final candidate list was actually produced, independent of the /api/candidates array. */
export type CandidateProduction = "produced" | "pending" | "unproduced" | "unknown";
export const UNPRODUCED_REASON = "뉴스 보정 최종 후보가 생성되지 않아 후보 여부는 미확인입니다. 모델 선별 결과를 최종 후보나 비후보 판정으로 쓰지 않습니다.";

/** An empty array alone never proves "not a candidate": the list must have been produced. */
export function resolveMembership(list: { isPending: boolean; isError: boolean }, listed: boolean, production: CandidateProduction): CandidateMembership {
  if (list.isPending) return "pending";
  if (list.isError) return "unknown";
  if (listed) return "candidate";
  return production === "produced" ? "nonCandidate" : production === "pending" ? "pending" : "unknown";
}

export function briefingSignals(candidate: CandidateData, membership: CandidateMembership, production: CandidateProduction = "produced") {
  const signals = candidateSignals({ ...candidate, isFinalCandidate: membership === "candidate" });
  if (production === "unproduced") return { ...signals, news: { state: "unavailable", ruleVersion: SIGNAL_RULE_VERSION, reason: "모델 전용 · 뉴스 미사용" } satisfies Signal, agreement: evidenceAgreement([signals.model, signals.supply]) };
  if (membership === "candidate" || membership === "nonCandidate") return signals;
  const unknown = "최종 후보 목록 조회에 실패해 현재 멤버십은 미확인입니다. 이전 조회 결과로 판정하지 않습니다.";
  const model: Signal = { state: "unavailable", ruleVersion: SIGNAL_RULE_VERSION, reason: membership === "pending" ? "최종 후보 목록을 확인 중입니다." : unknown };
  return { ...signals, model, agreement: evidenceAgreement([model, signals.news, signals.supply]) };
}
