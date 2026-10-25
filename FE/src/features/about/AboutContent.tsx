import React from "react";
import { BRAND_NAME } from "../../shared/lib/brand";
import { MODEL_SUMMARY, MODEL_SELECTION_DESCRIPTION } from "../../entities/model";

export const ABOUT_DESCRIPTION = "모델 순위와 관련 기사를 함께 읽는 한국 주식 분석 서비스. 데이터 출처와 확인 가능한 기록의 범위를 안내합니다.";
export const ABOUT_SECTIONS = [
  { title: "Transformer Ensemble → 순위 → Top-5", text: `${MODEL_SUMMARY}. ${MODEL_SELECTION_DESCRIPTION}` },
  { title: "예측과 근거를 함께 읽습니다", text: `${BRAND_NAME}는 한국 주식의 모델 순위와 관련 기사를 나란히 보여주는 의사결정 보조 서비스입니다. 특정 종목의 매수·매도 지시나 자동 주문을 제공하는 화면이 아닙니다.` },
  { title: "브리핑 → 전체 순위 → 종목 리포트", text: "브리핑에서 모델 Top-5를 비교하고, 전체 순위에서 모델 원본의 상대 위치를 확인하세요. 종목 리포트에서 예측 기준일, 가격 관측 시각을 읽으세요. 뉴스 포함 분석으로 최종 후보가 생성된 경우에는 뉴스 근거도 함께 표시합니다. 관심 목록은 이 기기에 저장됩니다." },
  { title: "모델 원본과 뉴스 반영 최종 결과", text: "모델 원본 순위와 뉴스 반영 후 최종 순위는 서로 다른 결과입니다. 원본 순위가 없으면 화면 정렬 순서로 대신하지 않습니다. 현재 모델은 다음 거래일 시가→종가 상대 순위 점수를 출력합니다. 순위 점수는 수익률이나 상승확률이 아닙니다. 과거 수익률 모델 실행은 당시 점수 유형으로 표시합니다." },
  { title: "뉴스 미수집과 0건은 다릅니다", text: "미수집·한도 도달·판정 불가는 뉴스가 없거나 중립이라는 뜻이 아닙니다. 수집 여부와 감성 판정을 따로 확인하세요. 0건은 수집 결과가 실제로 비어 있다고 확인된 경우에만 읽을 수 있습니다." },
  { title: "TOP5 예측 요약", text: "현재 순위 모델은 상위 5종목의 상대 순위를 보여주며 상승·하락을 판정하지 않습니다. 과거 수익률 모델 기록에는 방향 요약이 표시됩니다. 분석 기준일과 예측 기간이 모두 같고 값이 확인된 경우에만 요약합니다. 예측 수익률 수치는 종목 리포트에서 확인하세요. 포트폴리오 수익률이나 수익 확률이 아닙니다." },
  { title: "출처와 시각을 먼저 확인하세요", text: "각 카드의 시각과 데이터 출처를 함께 확인하세요. 저장된 결과는 실시간 가격과 다르며 예시 자료는 실제 분석이 아닙니다. 보간된 값은 실제 관측 이력과 구분합니다. 수급 데이터는 검증 후 공개 예정입니다." },
  { title: "분석 기록과 실현 성과", text: "현재는 최신 실행 상태만 확인할 수 있습니다. 공식·수시 실행 구분, 과거 실행 목록과 20거래일 실현 성과는 확인되지 않습니다. 저장된 예측이 있다는 사실만으로 공식 실행이나 과거 성과를 입증할 수 없습니다." },
];
export function AboutContent({ briefing = "/", rank = "/rank", history = "/history" }: { briefing?: string; rank?: string; history?: string }) {
  return <article className="about-page">
    <header className="about-hero"><p className="about-eyebrow">서비스 안내 · {BRAND_NAME}</p><h1>예측을 읽는 기준,<br />판단을 위한 근거</h1><p className="about-lead">숫자 하나보다 그 숫자가 만들어진 조건을 먼저 봅니다.</p><div className="about-actions"><a href={briefing}>브리핑 보기</a><a href={rank}>전체 순위 확인</a></div></header>
    <div className="about-grid">{ABOUT_SECTIONS.map((section, index) => <section className="about-card" key={section.title}><span className="about-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h2>{section.title}</h2><p>{section.text}</p></section>)}</div>
    <section className="about-note" id="analysis-guide"><h2>분석 실행과 이용 안내</h2><p>상단 ‘AI 분석 실행’에서 새 분석을 시작할 수 있습니다. 최근 실행은 약 40초가 걸렸으며 환경에 따라 더 걸릴 수 있습니다. 완료되면 새 기준일의 모델 순위가 표시됩니다.</p><p>분석과 예측에는 오류·지연·누락이 있을 수 있으며, 미래 수익을 보장하지 않습니다. 예측과 실제 성과를 구분하고 원자료를 함께 확인하세요. 투자 판단과 책임은 투자자에게 있습니다.</p><a href={history}>현재 확인 가능한 기록 보기</a></section>
  </article>;
}
