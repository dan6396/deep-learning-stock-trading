import React from "react";
import { BRAND_NAME } from "../../shared/lib/brand";
import { MODEL_SUMMARY, MODEL_SELECTION_DESCRIPTION } from "../../entities/model";

export const ABOUT_DESCRIPTION = "모델 예측과 뉴스·수급 근거를 함께 읽는 한국 주식 분석 서비스. 데이터 출처와 확인 가능한 기록의 범위를 안내합니다.";
export const ABOUT_SECTIONS = [
  { title: "Transformer Ensemble → 순위 → Top-5", text: `${MODEL_SUMMARY}. ${MODEL_SELECTION_DESCRIPTION}` },
  { title: "예측과 근거를 함께 읽습니다", text: `${BRAND_NAME}는 한국 주식의 모델 예측, 뉴스, 수급 정보를 나란히 보여주는 의사결정 보조 서비스입니다. 특정 종목의 매수·매도 지시나 자동 주문을 제공하는 화면이 아닙니다.` },
  { title: "브리핑 → 전체 순위 → 종목 리포트", text: "브리핑에서 모델 Top-5를 비교하고, 전체 순위에서 모델 원본의 상대 위치를 확인하세요. 종목 리포트에서 예측 기준일, 가격 관측 시각과 수급 근거를 읽으세요. 뉴스 포함 분석으로 최종 후보가 생성된 경우에는 뉴스 근거도 함께 표시합니다. 관심 목록은 이 기기에 저장됩니다." },
  { title: "모델 원본과 뉴스 반영 최종 결과", text: "모델 원본 순위와 뉴스 반영 후 최종 순위는 서로 다른 결과입니다. 원본 순위가 없으면 화면 정렬 순서로 대신하지 않습니다. 예측수익률은 다음 거래일 시가→종가에 대한 모델 예측이며, 실제 가격 변동이나 달성한 수익이 아닙니다." },
  { title: "뉴스 미수집과 0건은 다릅니다", text: "미수집·한도 도달·판정 불가는 뉴스가 없거나 중립이라는 뜻이 아닙니다. 수집 여부와 감성 판정을 따로 확인하세요. 0건은 수집 결과가 실제로 비어 있다고 확인된 경우에만 읽을 수 있습니다." },
  { title: "수급이 없으면 미확인으로", text: "외국인·기관 수급이나 관측일 수가 부족하면 판정할 수 없습니다. 미제공 값은 0으로 바꾸지 않으며, 자료 부족을 매도나 부정 신호로 해석하지 않습니다." },
  { title: "일치도는 근거를 읽는 기준", text: "브리핑은 모델 전용에서 모델·수급 2개, 최종 후보가 생성된 경우 뉴스까지 3개 중 긍정 개수를 표시합니다. 전체 순위의 일치도 비율은 판정 가능한 근거만 분모에 넣고 모델 전용에서는 뉴스를 제외합니다. 판정 불가는 별도로 표시하며, 일치도는 승률이나 수익 확률이 아닙니다." },
  { title: "출처와 시각을 먼저 확인하세요", text: "API 조회, 저장된 결과, 예시 데이터, 출처 미확인을 구분합니다. 저장된 결과는 최신 실시간 가격을 뜻하지 않고, 예시 데이터는 실제 분석이 아닙니다. 가격 이력의 출처가 미확인이거나 보간된 값이라면 실제 관측 이력으로 읽지 마세요. 조회 시각과 데이터 기준 시각도 다를 수 있습니다." },
  { title: "분석 기록과 실현 성과", text: "현재는 최신 실행 상태만 확인할 수 있습니다. 공식·수시 실행 구분, 과거 실행 목록과 20거래일 실현 성과는 확인되지 않습니다. 저장된 예측이 있다는 사실만으로 공식 실행이나 과거 성과를 입증할 수 없습니다." },
];
export function AboutContent({ briefing = "/", rank = "/rank", history = "/history" }: { briefing?: string; rank?: string; history?: string }) {
  return <article className="about-page">
    <header className="about-hero"><p className="about-eyebrow">ABOUT {BRAND_NAME}</p><h1>예측을 읽는 기준,<br />판단을 위한 근거</h1><p className="about-lead">숫자 하나보다 그 숫자가 만들어진 조건을 먼저 봅니다.</p><div className="about-actions"><a href={briefing}>브리핑 보기</a><a href={rank}>전체 순위 확인</a></div></header>
    <div className="about-grid">{ABOUT_SECTIONS.map((section, index) => <section className="about-card" key={section.title}><span className="about-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h2>{section.title}</h2><p>{section.text}</p></section>)}</div>
    <section className="about-note"><h2>이용 전 확인해 주세요</h2><p>분석과 예측에는 오류·지연·누락이 있을 수 있으며, 미래 수익을 보장하지 않습니다. 예측과 실제 성과를 구분하고 원자료를 함께 확인하세요. 투자 판단과 책임은 투자자에게 있습니다.</p><a href={history}>현재 확인 가능한 기록 보기</a></section>
  </article>;
}
