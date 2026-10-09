import type { CandidateData } from "../../entities/candidate";
import { candidateSignals, evidenceAgreement, SIGNAL_RULE_VERSION, type Signal } from "../../entities/signals";
import { isNewsEvidenceStatus } from "../../types/newsCollection";
import { mergeCandidateDetail } from "../briefing/DetailPanel";
import type { CandidateMembership, CandidateProduction } from "../briefing/membership";

export type RankSort = "rank" | "finalRank" | "predictedReturn" | "finalPredictedReturn" | "name";
export type RankFilter = "all" | "candidate" | "positive" | "negative" | "missing";
export function compareNullable(left: number | string | null | undefined, right: number | string | null | undefined, descending: boolean): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const result = typeof left === "string" && typeof right === "string" ? left.localeCompare(right, "ko") : Number(left) - Number(right);
  return descending ? -result : result;
}
export function matchStock(row: Pick<CandidateData, "code" | "name">, query: string) {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  return !normalized || row.code.includes(normalized) || (row.name ?? "").toLocaleLowerCase("ko-KR").includes(normalized);
}
export function rankRows(rows: CandidateData[], candidates: CandidateData[], confirmed: boolean, query: string, filter: RankFilter, sort: RankSort, descending: boolean) {
  const members = new Map(candidates.map(row => [row.code, row]));
  return rows.map(row => mergeCandidateDetail(confirmed ? members.get(row.code) : undefined, row)!)
    .filter(row => {
      if (!matchStock(row, query)) return false;
      if (filter === "all") return true;
      if (filter === "candidate") return confirmed && members.has(row.code);
      if (filter === "missing") return row.predictedReturn === null;
      return row.predictedReturn !== null && (filter === "positive" ? row.predictedReturn > 0 : row.predictedReturn <= 0);
    })
    .sort((left, right) => compareNullable(left[sort], right[sort], descending) || left.code.localeCompare(right.code));
}
export function rankSignals(row: CandidateData, membership: CandidateMembership, production: CandidateProduction = "produced") {
  const signals = candidateSignals({ ...row, isFinalCandidate: membership === "candidate" });
  const model: Signal = production !== "unproduced" && (membership === "pending" || membership === "unknown")
    ? { state: "unavailable", reason: membership === "pending" ? "최종 후보 목록 확인 중" : "최종 후보 멤버십 미확인", ruleVersion: SIGNAL_RULE_VERSION } : signals.model;
  // News collection and supply evidence are independent of final-candidate membership.
  return { ...signals, model, agreement: evidenceAgreement(production === "unproduced" ? [model, signals.supply] : [model, signals.news, signals.supply]) };
}
export function noNewsEvidence(row: CandidateData) {
  return !row.newsCollected && !isNewsEvidenceStatus(row.newsStatus) && row.news.length === 0 && row.newsTally === null;
}
