import type { CandidateData, NewsTally } from "./candidate";
import { isNewsCollectionSuccess, isNewsEvidenceStatus } from "../types/newsCollection";

export const SIGNAL_RULE_VERSION = "m1-2026-10-08-v2";
export const SIGNAL_DESCRIPTIONS = {
  model: "원본 예측값이 있는 최종 후보는 긍정. 전체 순위는 예측수익률 0 이하이면 부정, 상위 5%이면서 양수이면 긍정, 나머지는 중립입니다.",
  news: "LLM 기사별 판정 또는 명시 집계의 긍정·부정 건수를 비교합니다. 실제 수집 결과 0건은 중립이며 미수집·키워드 추정은 판정 불가입니다.",
  supply: "외국인·기관 합계 금액과 합산 순매수 일수/기간을 함께 봅니다. 개별 양수일수만으로 합산 순매수 일수를 계산하지 않습니다.",
  agreement: "긍정 신호 수 / 평가 가능한 신호 수. 판정 불가는 분모에서 제외하고, 모두 판정 불가이면 —로 표시합니다.",
  nextTradingDay: "실행별 목표 거래일은 성과 기록에서 KIS 휴장일 달력 또는 실제 코스피 거래일 기록으로 확인합니다.",
} as const;
export type SignalState = "positive" | "neutral" | "negative" | "unavailable";
export type Signal = { state: SignalState; reason: string; ruleVersion: typeof SIGNAL_RULE_VERSION };
const signal = (state: SignalState, reason: string): Signal => ({ state, reason, ruleVersion: SIGNAL_RULE_VERSION });
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value);
const integer = (value: number | null): value is number => valid(value) && Number.isInteger(value) && value >= 0;

export function modelSignal(candidate: CandidateData): Signal {
  const prediction = candidate.predictedReturn;
  if (!valid(prediction)) return signal("unavailable", "원본 모델 예측값이 없습니다.");
  if (candidate.predictionTarget !== "next_session_open_to_close") return signal("unavailable", "예측수익률의 대상 기간이 확인되지 않습니다.");
  if (candidate.isFinalCandidate) return signal("positive", "원본 예측값이 있는 최종 후보입니다.");
  if (prediction <= 0) return signal("negative", "원본 예측수익률이 0 이하입니다.");
  if (!integer(candidate.rank) || !integer(candidate.poolSize) || candidate.rank < 1 || candidate.poolSize < 1 || candidate.rank > candidate.poolSize) {
    return signal("unavailable", "전체 순위 또는 모집단 크기를 확인할 수 없습니다.");
  }
  return candidate.rank / candidate.poolSize <= 0.05
    ? signal("positive", "전체 순위 상위 5%이며 원본 예측수익률이 양수입니다.")
    : signal("neutral", "원본 예측수익률은 양수이나 상위 5% 밖입니다.");
}

export function newsSignal(candidate: CandidateData): Signal {
  if (candidate.newsMethod === "keyword") return signal("unavailable", "키워드 추정은 LLM 뉴스 판정으로 사용하지 않습니다.");
  if (!isNewsEvidenceStatus(candidate.newsStatus)) return signal("unavailable", "뉴스 수집·분석의 성공 상태를 확인할 수 없습니다.");
  const hasArticles = candidate.news.length > 0;
  if (!hasArticles && !candidate.newsCollected && !candidate.newsTally) return signal("unavailable", "뉴스 수집 여부가 확인되지 않습니다.");
  if (!hasArticles && candidate.newsCollected && isNewsCollectionSuccess(candidate.newsStatus) && (!candidate.newsTally || Object.values(candidate.newsTally).every(n => n === 0))) return signal("neutral", "실제 뉴스 수집 결과가 0건입니다.");
  let counts: NewsTally | null = candidate.newsMethod === "llm" ? candidate.newsTally : null;
  if (!counts && hasArticles && candidate.newsMethod === "llm" && candidate.news.every(item => item.sentiment !== null)) {
    counts = { positive: 0, neutral: 0, negative: 0 };
    for (const item of candidate.news) counts[item.sentiment!] += 1;
  }
  if (!counts || !Object.values(counts).every(n => integer(n)) || (hasArticles && Object.values(counts).reduce((a, b) => a + b, 0) !== candidate.news.length)) {
    return signal("unavailable", "완전한 LLM 기사별 판정 또는 명시 집계가 없습니다.");
  }
  if (!hasArticles && Object.values(counts).every(n => n === 0) && !candidate.newsCollected) return signal("unavailable", "0건 집계의 실제 수집 여부가 확인되지 않습니다.");
  return counts.positive > counts.negative ? signal("positive", "LLM 긍정 기사 수가 부정 기사 수보다 많습니다.")
    : counts.negative > counts.positive ? signal("negative", "LLM 부정 기사 수가 긍정 기사 수보다 많습니다.")
      : signal("neutral", "LLM 긍정·부정 기사 수가 같습니다.");
}

export function supplySignal(candidate: CandidateData): Signal {
  const s = candidate.supply;
  if (s.status === "not_checked") return signal("unavailable", "모델 선별 대상에 포함되지 않아 수급을 조회하지 않았습니다.");
  if (!integer(s.combinedPositiveDays)) return signal("unavailable", "원본에 외국인·기관 합산 순매수 일수가 없습니다. 개별 양수일수로 추정하지 않습니다.");
  if (!valid(s.foreignNetBuy) || !valid(s.institutionNetBuy) || !integer(s.window) || s.window < 1 ||
    !integer(s.dataDays) || s.dataDays < s.window || s.combinedPositiveDays > s.window ||
    !integer(s.foreignPositiveDays) || !integer(s.institutionPositiveDays) || s.foreignPositiveDays > s.window || s.institutionPositiveDays > s.window ||
    s.enough !== true || s.status !== "ok") return signal("unavailable", "수급 금액·일수·기간 또는 충분한 조회 결과를 확인할 수 없습니다.");
  const total = s.foreignNetBuy + s.institutionNetBuy;
  if (!Number.isFinite(total)) return signal("unavailable", "수급 합계가 유효하지 않습니다.");
  const majority = s.combinedPositiveDays >= s.window / 2;
  return total > 0 && majority ? signal("positive", "합계 순매수가 양수이고 합산 순매수 일수가 기간의 절반 이상입니다.")
    : total < 0 && !majority ? signal("negative", "합계 순매수가 음수이고 합산 순매수 일수가 기간의 절반 미만입니다.")
      : signal("neutral", "수급 금액과 일수의 방향이 일치하지 않거나 합계가 0입니다.");
}

export function evidenceAgreement(signals: readonly Signal[]) {
  const available = signals.filter(item => item.state !== "unavailable");
  const positive = available.filter(item => item.state === "positive").length;
  return { positive, evaluable: available.length, unavailable: signals.length - available.length,
    ratio: available.length ? positive / available.length : null, ruleVersion: SIGNAL_RULE_VERSION };
}

export function candidateSignals(candidate: CandidateData) {
  const model = modelSignal(candidate), news = newsSignal(candidate), supply = supplySignal(candidate);
  return { model, news, supply, agreement: evidenceAgreement([model, news, supply]), ruleVersion: SIGNAL_RULE_VERSION };
}
