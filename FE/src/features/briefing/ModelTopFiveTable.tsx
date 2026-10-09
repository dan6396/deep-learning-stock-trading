import type { CandidateData } from "../../entities/candidate";

export function modelTopFive(rows: readonly CandidateData[]) {
  return rows.filter(row => row.rank !== null && Number.isInteger(row.rank) && row.rank >= 1)
    .sort((left, right) => left.rank! - right.rank! || left.code.localeCompare(right.code)).slice(0, 5);
}
