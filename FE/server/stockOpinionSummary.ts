import type { MarketOutlook, HeadlineSummary } from "../src/types/preOpenMacro";
import type { StockAiOpinion, StockOpinion } from "../src/types/stockOpinion";
import { forbiddenCausality, forbiddenInvestmentAdvice } from "./briefingValidation";
import { opinionSentences } from "./stockOpinion";
import { KOSPI200_POOL } from "./kospi200Pool";
import { forbiddenStockNewsForecast } from "./stockNewsLanguage";
import { OUTLOOK_STANCES } from "../src/types/preOpenMacro";

/**
 * /stock "AI 최종 의견": 이미 검증을 통과한 브리핑 시장 의견·뉴스 요약·종목 분석 문장을
 * 모델 순위와 함께 한 문단으로 잇는다. 새 LLM 호출이나 새 사실은 만들지 않는다.
 * 시장 방향은 브리핑 의견을 인용만 하고, 종목 방향은 만들지 않는다.
 * 연결은 대비·병렬 접속만 쓰며, 인과·권유 표현이 있는 문장은 문단에서 뺀다.
 */
export type IntegratedOpinionInput = {
  code: string; rank: number; poolSize: number;
  outlook?: MarketOutlook | null; news?: HeadlineSummary | null; opinion?: StockOpinion | null;
  generatedAt?: string;
};

const LIMIT = { outlook: 2, news: 2, analysis: 2 } as const;
// 조각 문장 앞의 접속어는 떼어 내고, 문단 연결어는 이 모듈이 정한다("한편 … 한편" 중복 방지).
const withoutLeadingConnector = (value: string) => value.replace(/^(?:한편|아울러|또한|그리고|이와\s*함께)\s*,?\s*/, "");
const withPeriod = (value: string) => { const text = withoutLeadingConnector(value.trim()); return /[.!?。]$/.test(text) ? text : `${text}.`; };
const usable = (sentence: string) => !forbiddenCausality(sentence) && !forbiddenInvestmentAdvice(sentence);
const pick = (text: string, limit: number, keep: (sentence: string) => boolean = () => true) =>
  opinionSentences(text).map(withPeriod).filter(sentence => usable(sentence) && keep(sentence)).slice(0, limit);

function openingSentence(rank: number, poolSize: number, outlook?: MarketOutlook | null): string {
  const rankText = `트랜스포머 모델 순위는 전체 ${poolSize}개 종목 중 ${rank}위`;
  if (!outlook) return `${rankText}입니다.`;
  if (outlook.stance === "판단 보류") return `${rankText}이나, 브리핑은 현재 시장 방향 판단을 보류했습니다.`;
  // 상위 순위와 결이 다른 '하락 우위'만 대비 접속을 쓰고, 나머지는 병렬로 잇는다.
  return `${rankText}${outlook.stance === "하락 우위" ? "이나" : "이며"}, 브리핑 기준 현재 시장은 '${outlook.stance}' 의견입니다.`;
}

export function integratedStockOpinion({ code, rank, poolSize, outlook, news, opinion, generatedAt }: IntegratedOpinionInput): StockAiOpinion {
  const outlookSentences = outlook ? pick(outlook.text, LIMIT.outlook) : [];
  const newsSentences = news?.source === "llm" ? pick(news.text, LIMIT.news) : [];
  // 순위는 첫 문장에서 말했으므로 반복하지 않는다. 템플릿 의견은 메타 안내라 넣지 않는다.
  const analysisSentences = opinion?.source === "llm" ? pick(opinion.text, LIMIT.analysis, sentence => !/\d+\s*위/.test(sentence)) : [];
  const text = [openingSentence(rank, poolSize, outlook),
    ...(outlookSentences.length ? [`시장 의견을 보면, ${outlookSentences.join(" ")}`] : []),
    ...(newsSentences.length ? [`한편 관련 뉴스를 보면, ${newsSentences.join(" ")}`] : []),
    ...(analysisSentences.length ? [`또한 ${analysisSentences.join(" ")}`] : [])].join(" ");
  const llm = outlookSentences.length > 0 && outlook?.source !== "template" || newsSentences.length > 0 || analysisSentences.length > 0;
  const citations = [...new Set([`R:${code}`, ...(analysisSentences.length ? opinion?.citations ?? [] : []), ...(outlook?.citations ?? []), ...(newsSentences.length ? news?.citations ?? [] : [])])];
  return { source: llm ? "llm" : "template", text, citations, ...(generatedAt ? { generatedAt } : {}) };
}

/* ---- AI 통합 문단(같은 브리핑 Gemini 호출의 stockSummaries) 검증 ---- */
const normalize = (value: string) => value.normalize("NFKC").replace(/[​-‏﻿]/g, "");
type AnalysisMetrics = NonNullable<import("./briefing").BriefingInput["stocks"][number]["analysisMetrics"]>;
/** 해설형 문단의 근거 조각. 모델 지표·주의사항까지 넣어 해석 문장도 숫자를 대조할 수 있게 한다. */
export type IntegratedPieces = IntegratedOpinionInput & { name: string; topPercent?: number; metrics?: AnalysisMetrics | null; cautions?: string[] };
const llmText = (row: { source?: string; text: string } | null | undefined) => row && row.source !== "template" ? row.text : null;

/** 검증 근거 조각. 템플릿(메타 안내) 조각은 근거로 쓰지 않는다. */
export function promptPieces(pieces: IntegratedPieces) {
  return { code: pieces.code, name: pieces.name, rank: pieces.rank, poolSize: pieces.poolSize, topPercent: pieces.topPercent ?? null,
    metrics: pieces.metrics ? { rawRank: pieces.metrics.rawRank, adjustedRank: pieces.metrics.adjustedRank, agreement: pieces.metrics.agreement,
      lookbacks: pieces.metrics.lookbacks, features: pieces.metrics.features.map(({ label, percentile, side, tailPercent }) => ({ label, percentile, side, tailPercent })) } : null,
    cautions: pieces.cautions ?? [],
    marketOutlook: pieces.outlook ? { stance: pieces.outlook.stance, text: pieces.outlook.text } : null,
    newsSummary: llmText(pieces.news), analysis: llmText(pieces.opinion) };
}

export function integratedCitations(pieces: IntegratedPieces): string[] {
  return [...new Set([`R:${pieces.code}`, ...(pieces.metrics ? pieces.metrics.lookbacks.map(row => `R:${pieces.code}:${row.sessions}`) : []), ...(pieces.outlook?.citations ?? []),
    ...(llmText(pieces.news) ? pieces.news!.citations : []), ...(llmText(pieces.opinion) ? pieces.opinion!.citations : [])])];
}

const numberTokens = (text: string) => [...normalize(text).matchAll(/(-)?(\d[\d,]*(?:\.\d+)?)/g)]
  .map(match => ({ negative: Boolean(match[1]), value: Number(match[2].replace(/,/g, "")), decimals: (match[2].split(".")[1] ?? "").length }));
/** 출력 숫자는 근거 숫자를 같은 자릿수로 반올림한 값과 같아야 한다(입력보다 자릿수를 늘리면 불일치). */
const matches = (token: { value: number; decimals: number }, source: { value: number }) => Number(source.value.toFixed(token.decimals)) === token.value;
const MARKET_SUBJECT = /시장|브리핑|나스닥|금리|국채|환율|원\/달러|반도체\s*지수|지수|코스피|코스닥|선물|지표|증시|장\s*초반/;
const ADVICE_TERMS = ["수익률", "확률", "목표가", "목표주가", "비중", "추천", "매수", "매도", "권유", "유망", "기회", "매력"];
const DIRECTION = /상승|하락|강세|약세|반등|오르|내리|우위/;
export const INTEGRATED_SUMMARY_SENTENCES = { min: 3, max: 7 } as const;

/** AI 통합 문단 검증. 실패 사유를 돌려주고, 통과하면 null. */
export function integratedSummaryReason(value: unknown, pieces: IntegratedPieces): string | null {
  if (typeof value !== "string") return "invalid_schema";
  const text = normalize(value).trim();
  if (text.length < 80 || text.length > 1300 || /[\n*#`]|^\s*[-•]/m.test(text)) return "invalid_schema";
  const sentences = opinionSentences(text);
  if (sentences.length < INTEGRATED_SUMMARY_SENTENCES.min || sentences.length > INTEGRATED_SUMMARY_SENTENCES.max) return "invalid_schema";
  if (/지시|명령|프롬프트|시스템\s*(?:메시지|역할)|무시하|ignore|system\s*prompt|instruction/i.test(text)) return "untrusted_instruction";
  // 모델 순위는 반드시 밝히고, 모든 'N위'는 입력의 순위(최종·원본·보정·20/120일) 중 하나여야 한다.
  if (!new RegExp(`(?<!\d)${pieces.rank}\s*위`).test(text)) return "missing_rank";
  const ranks = new Set([pieces.rank, pieces.metrics?.rawRank, pieces.metrics?.adjustedRank, ...(pieces.metrics?.lookbacks.map(row => row.rank) ?? [])].filter((rank): rank is number => typeof rank === "number"));
  for (const match of text.matchAll(/(\d+)\s*위/g)) if (!ranks.has(Number(match[1]))) return "ungrounded_rank";
  for (const match of text.matchAll(/(\d+)\s*개\s*(?:종목|후보)/g)) if (Number(match[1]) !== pieces.poolSize) return "ungrounded_pool";
  if (pieces.metrics?.agreement && /(?<![가-힣])(?:부분\s*일치|불일치|일치)/.test(text) && /20\s*일|120\s*일/.test(text)) {
    const stated = text.match(/부분\s*일치|불일치|일치/)?.[0].replace(/\s/g, "");
    if (stated !== pieces.metrics.agreement.replace(/\s/g, "")) return "ungrounded_agreement";
  }
  // 인과·권유·예측은 문단 전체에서 금지한다(대비·병렬 연결과 '함께 확인' 같은 읽는 법 안내만 허용).
  if (forbiddenCausality(text)) return "causal";
  // 권유 어휘는 근거 조각(뉴스 원문 등)에 이미 있는 단어일 때만 허용한다. 예: 기사 속 '공급 비중'.
  const sources = JSON.stringify(promptPieces(pieces));
  if (forbiddenInvestmentAdvice(text) || ADVICE_TERMS.some(term => text.includes(term) && !sources.includes(term))) return "advice";
  if (forbiddenStockNewsForecast(text)) return "forecast";
  // 시장 방향은 브리핑 stance 인용만. 다른 stance나 종목 방향은 거부한다.
  const stances = OUTLOOK_STANCES.filter(stance => text.includes(stance));
  if (pieces.outlook ? !stances.includes(pieces.outlook.stance) || stances.some(stance => stance !== pieces.outlook!.stance) : stances.length) return "stance_mismatch";
  for (const sentence of sentences) {
    const scoped = sentence.replace(/\d+\s*개\s*종목\s*(?:가운데|중)/g, "");
    if (!DIRECTION.test(scoped)) continue;
    if (scoped.includes(pieces.name) || /주가|종목|이\s*회사/.test(scoped) || !MARKET_SUBJECT.test(scoped)) return "stock_direction";
  }
  // 숫자는 근거 조각에 있는 값만. 근거에서 음수였던 값은 '상승'과 함께 쓰지 않는다.
  const known = [...numberTokens(sources), { negative: false, value: pieces.rank }, { negative: false, value: pieces.poolSize }];
  for (const sentence of sentences) for (const token of numberTokens(sentence)) {
    const found = known.filter(source => matches(token, source));
    if (!found.length) return "ungrounded_number";
    if (!token.negative && found.every(source => source.negative) && /상승|오름|올랐|강세/.test(sentence)) return "sign_flip";
  }
  // 근거 조각에 없는 다른 회사명·종목코드는 쓰지 않는다.
  if (/(?<!\d)\d{6}(?!\d)/.test(text)) return "other_stock";
  if (KOSPI200_POOL.some(stock => stock.code !== pieces.code && stock.name.length >= 2 && text.includes(stock.name) && !sources.includes(stock.name))) return "other_stock";
  return null;
}
