import React from "react";
import { BRAND_NAME } from "../../shared/lib/brand";

export const ABOUT_DESCRIPTION = "한국 주식의 모델 순위와 관련 기사를 함께 확인하세요. TOP5를 읽는 법과 실제 가격 기반 성과, 분석의 한계를 안내합니다.";
export const ABOUT_SECTIONS = [
  { title: "무엇을 하나", text: "다음 거래일 시가→종가의 상대 순위를 계산합니다. 20일·120일은 예측 기간이 아니라 모델에 넣는 과거 거래일 수입니다." },
  { title: "어떻게 읽나", text: "TOP5의 현재가·등락은 가격 정보이고, 순위 점수는 모델의 비교 값입니다. 종목을 열어 근거와 관련 기사를 함께 읽으세요." },
  { title: "한계", text: "순위 점수는 수익률이나 상승 확률이 아닙니다. 데이터 기준 시각과 누락·지연을 확인하세요. 관련 기사는 접근이 허용된 경우 본문 일부를 내부 요약에 활용하며, 확보하지 못하면 제목 기반으로 표시합니다. 원문 본문은 화면에 제공하지 않습니다. 뉴스 미수집은 수집 결과 0건과 다릅니다. 예시·보간 데이터는 실제 관측값과 구분해 읽으세요." },
];

export function AboutContent({ briefing = "/", rank = "/rank", history = "/history" }: { briefing?: string; rank?: string; history?: string }) {
  return <article className="about-page">
    <header className="about-hero">
      <p className="about-eyebrow">서비스 소개 · {BRAND_NAME}</p>
      <h1>한국 주식의 모델 순위와<br />관련 기사를 함께 봅니다</h1>
      <a className="about-primary-link" href={briefing}>브리핑 보기 <span aria-hidden="true">→</span></a>
    </header>

    <section className="about-section" aria-labelledby="about-purpose">
      <h2 id="about-purpose">{ABOUT_SECTIONS[0].title}</h2>
      <div className="about-section-body">
        <p>{ABOUT_SECTIONS[0].text}</p>
        <figure className="about-model">
          <div className="about-model-flow" role="img" aria-label="20일 모델과 120일 모델의 순위를 결합해 TOP5를 표시합니다">
            <div className="about-model-inputs"><span>20일 모델</span><span>120일 모델</span></div>
            <span className="about-model-arrow" aria-hidden="true">→</span>
            <span className="about-model-merge">순위 결합</span>
            <span className="about-model-arrow" aria-hidden="true">→</span>
            <strong>TOP5</strong>
          </div>
          <figcaption>기간별 3개 seed 평균 후 50:50으로 결합합니다.</figcaption>
        </figure>
      </div>
    </section>

    <section className="about-section" aria-labelledby="about-reading">
      <h2 id="about-reading">{ABOUT_SECTIONS[1].title}</h2>
      <div className="about-section-body">
        <p>{ABOUT_SECTIONS[1].text}</p>
        <dl className="about-reading-list">
          <div><dt><a href={rank}>전체 순위 <span aria-hidden="true">→</span></a></dt><dd>모델 원본의 상대 위치를 확인합니다. 뉴스 포함 분석의 최종 후보와는 구분해서 읽으세요.</dd></div>
          <div><dt><a href={history}>분석 기록 <span aria-hidden="true">→</span></a></dt><dd>과거 실행과 실제 가격 기반 성과를 봅니다. 공식 성과는 분석 시각·가격 자료 검증을 통과한 기록만 집계합니다.</dd></div>
        </dl>
        <div className="about-analysis-guide" id="analysis-guide">
          <h3>새 분석이 필요할 때</h3>
          <p>상단에 ‘AI 분석 실행’ 버튼이 보이면 새 분석을 시작할 수 있습니다. 완료 후 순위와 요약이 자동 갱신됩니다. 요약 생성에 실패하면 대체 문장이 표시될 수 있습니다.</p>
        </div>
      </div>
    </section>

    <section className="about-section" aria-labelledby="about-limits">
      <h2 id="about-limits">{ABOUT_SECTIONS[2].title}</h2>
      <div className="about-section-body">
        <p>{ABOUT_SECTIONS[2].text}</p>
        <p>매수·매도 지시나 자동 주문을 제공하지 않습니다. 가격 기반 성과는 거래 비용을 차감하지 않은 계산이며 실제 주문 손익이 아닙니다. 미래 수익을 보장하지 않으며 투자 판단과 책임은 이용자에게 있습니다.</p>
        <p>관심 목록은 이 기기에만 저장됩니다.</p>
      </div>
    </section>
  </article>;
}
