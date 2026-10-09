import { useQuery } from "@tanstack/react-query";
import { queries } from "../../shared/api/queries";
import type { CandidateProduction } from "./membership";

/**
 * Only an authoritative empty candidate list needs the server's production state: a non-empty list
 * is itself proof of production. The status read is skipped (and no request is made) otherwise.
 */
export function useCandidateProduction(candidates: { isSuccess: boolean; isError: boolean; data?: { data: readonly unknown[] } }): CandidateProduction {
  const needsStatus = candidates.isSuccess && !candidates.isError && candidates.data?.data.length === 0;
  const status = useQuery({ ...queries.backendStatus(), enabled: needsStatus });
  if (!needsStatus) return "produced";
  if (status.isPending) return "pending";
  if (status.isError || !status.data) return "unknown";
  const state = status.data.results.candidates.state;
  return state === "empty" || state === "available" || state === "sample" ? "produced" : state === "not_produced" ? "unproduced" : "unknown";
}

export function productionNotice(production: CandidateProduction): string | null {
  if (production === "unproduced") return "모델 분석만 완료 · 뉴스 보정 최종 후보 미생성. 최종 후보 여부는 미확인이며 뉴스 보정 수치와 순위는 제공되지 않습니다.";
  if (production === "unknown") return "최종 후보 생성 여부를 확인하지 못했습니다. 후보 여부는 미확인입니다.";
  return null;
}
