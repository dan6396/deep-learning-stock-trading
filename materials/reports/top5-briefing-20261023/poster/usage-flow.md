# 시연 사용 흐름과 심사 Q&A

기본 화면은 `/`, 상세는 `/stock/:code`다([FE 안내](../../../../FE/README.md)). 최종 보존 캡처는 `screenshots/fe-check/`의 한 세트이며 10/23 13:23 KST Gemini 결과와 참고 통계 펼침 상태를 포함한다. 1440×1000 포스터용 브리핑·종목 근거 컷도 추가했다. 분석 실행 모달·진행률과 전용 종목 리포트 캡처는 보존하지 않았으므로 제출에 필요하면 별도로 촬영해야 한다.

## 시연 5단계

| 단계 | 조작 | 캡처 파일명·상태 | 1문장 설명 |
|---|---|---|---|
| 1. 분석 실행 | 상단 ‘AI 분석 실행’에서 수시 실행을 시작하고 완료 상태 확인 | [fe-check/home-1440-dark-viewport.png](../screenshots/fe-check/home-1440-dark-viewport.png): 진입 버튼·저장 결과만 보임; 진행 중 화면은 미캡처 | 같은 완료 거래일 자료로 모델 순위를 만들고 관련 기사를 별도로 수집한다. |
| 2. 종합 브리핑 | 설명 생성 버튼 실행 후 요약 출처·시장 기준 시각·인용 확인 | [포스터용 브리핑](../screenshots/fe-check/poster-briefing-1440-dark.png): 개요 규칙 기반·시장 설명 AI 출처와 생성·지표 시각을 확인 | 모델 결과는 고정하고 시장 관측과 기사를 출처가 있는 설명으로 읽는다. |
| 3. 참고 통계 | ‘직전 미국장(나스닥) 방향과 코스피’의 상세 통계 펼치기 | [참고 통계 확대](../screenshots/fe-check/reference-1440-dark.png), [모바일 행 카드](../screenshots/fe-check/reference-375-dark.png) | 종가→종가와 시가→종가의 과거 비율을 각 기준선·표본과 비교한다. |
| 4. TOP5 | 고정 순위와 기사, 후보 구성, 종목별 근거·주의점 확인 | [최종 전체 화면](../screenshots/fe-check/home-1440-dark-full.png) | 순위 점수를 예상수익률로 바꾸지 않고 근거와 불확실성을 함께 확인한다. |
| 5. 종목 근거 | 한화오션 종목 카드의 ‘자세히’ 선택 또는 홈 패널 확인 | [포스터용 종목 근거](../screenshots/fe-check/poster-stock-1440-dark.png): 근거·주의점·기사 펼침; 전용 리포트 화면의 증거는 아님 | 모델 순위·측정 수급·기사 출처와 주의점을 나누어 확인한다. |

화면 조작과 응답 의미의 근거는 [API 계약](../../../../FE/docs/api-contract.md), 저장 실행은 [kis-analysis-live.json](../kis-analysis-live.json)과 [kis-briefing-ready.json](../kis-briefing-ready.json)이다. 최종 사용자 승인으로 Gemini POST를 정확히 1회 실행했으며 [최종 결과](../narrative-final.json)는 llm·partial_template이다. 개요는 규칙 기반, 시장 설명과 종목 5개는 AI 문장으로 유지됐다. 시세 응답 완료를 확인한 뒤 캡처했으며 추가 Gemini 호출은 하지 않았다.

## 최종 캡처 교체 조건

- 같은 최종 코드·같은 완료 실행에서 촬영한다. 모델 기준일과 실제 조회 시각을 함께 남긴다.
- 분석 진행률 화면이 필요하면 추가한다. 저장 결과 화면만으로 새 분석 실행을 입증하지 않는다. 통계 상세 펼침은 최종 보존 컷에 포함한다.
- 조회 중 상태가 끝난 뒤 촬영하되 실패·null·미수집도 실제 상태 그대로 남긴다. 가격 이력과 단순 조회 가격의 성공 여부는 따로 확인한다.
- Gemini 표시가 필요한 컷은 실제 생성 결과의 필드 출처를 확인한다. 이번 최종 컷은 [부분 대체 결과](../narrative-final.json)를 반영한다. 개요는 규칙 기반이므로 모든 필드가 LLM이라고 소개하지 않는다.
- [최종 측정](../screenshots/fe-check/ui-review-metrics.json)과 [접근성 검사](../screenshots/fe-check/a11y-review.txt)를 확인한다. 모바일 전체는 [fe-check/home-375-dark-full.png](../screenshots/fe-check/home-375-dark-full.png)이며 발표에서는 읽을 수 있는 부분 확대 컷을 사용한다. 전용 리포트의 가격 이력은 별도 검증이 필요하다.

## 심사 예상 Q&A · 8개

### 1. 점수가 1.60이면 수익률 1.60%인가?

아니다. `rank_zscore`는 같은 날 유효 종목들 안의 상대 순위 점수다. 수익률·상승확률·방향을 의미하지 않으며 다른 날짜의 점수 크기도 직접 비교하지 않는다. 근거: [모델 설명](../../../../README.md), [출력 계약](../../../../FE/docs/api-contract.md).

### 2. Gemini가 좋은 뉴스를 보고 순위를 올리나?

아니다. 원본 `pred_rank`의 TOP5를 고정하고 설명만 생성한다. 입력에 없는 수치·단위·인용이나 권유·예측 표현 등을 검증해 실패 필드만 규칙 기반으로 대체한다. 최종 저장 실호출은 개요만 규칙 기반으로 대체됐고 시장 설명과 종목 5개는 llm이었다. 화면도 AI 요약·일부 규칙 기반으로 표시한다. 근거: [API 계약](../../../../FE/docs/api-contract.md), [최종 실호출 JSON](../narrative-final.json).

### 3. 매크로·뉴스를 왜 모델에 바로 넣지 않았나?

추가 정보의 예측 효과가 목표 구간에 맞는지 먼저 확인해야 했기 때문이다. 나스닥 상승 뒤 코스피 종가→종가 상승 73.3%와 달리 시가→종가는 46.6%로 같은 표본 기준선 50.6%보다 낮았다. 종가 기준에는 시가 갭이 포함돼 시가 매수 후 성과로 옮길 수 없다. 모든 매크로의 무용성을 입증한 것은 아니며 국내 지수 과거 특징은 모델 입력에 이미 있다. 뉴스 `0.053`은 팀 공유 자료의 상관으로 원자료는 별도 미확인이다. 근거: [나스닥 통계 JSON](../../macro-nasdaq-kospi/result.json), [통계 해석](../../macro-nasdaq-kospi/README.md), [모델 특징](../../../../models/final_rank_ensemble/manifest.json), [출처 구분](poster-content.md).

### 4. 화면 자료는 모두 실제 데이터인가?

저장된 분석의 유효 순위 199/199행, KIS 지수 이력 수집, Yahoo/KIS 매크로 관측과 Gemini 실호출은 각각 기록이 있다. 하지만 최신 구성종목 여부와 수급의 실전 출처까지 확인된 것은 아니다. 수급은 Python 설정 덮어쓰기로 mock 경로일 가능성이 남고, 업종은 `EGW02004`로 null이다. 근거: [순위 검증](../kis-rank-verification.json), [지수 이력](../market-history-live.json), [브리핑](../kis-briefing-ready.json), [업종 진단](../sector-diagnostic.json), [설정 경계](../../../../README.md). 전일 가상 입력 캡처와도 구분한다([전일 보고서](../../final-code-cleanup-20261022/README.md)).

### 5. 왜 20일·120일을 단순평균했나?

서로 다른 관측 길이의 순위를 같은 모집단에서 결합하면서 학습형 가중치를 추가하지 않는 구조다. 기간별 seed 3개씩의 점수를 평균하고 두 기간에 50:50을 적용한다. 복잡도와 검증 근거를 고려한 선택이며 모든 구간 최고 성능이라는 주장은 아니다. 현재 자료에서 대안별 직접 비교표는 확인하지 못했고 manifest에도 rolling OOF/게이트 연구가 없다고 명시돼 있다. 근거: [현재 모델 README](../../../../README.md), [manifest](../../../../models/final_rank_ensemble/manifest.json).

### 6. 수익이나 추천 포트폴리오까지 검증했나?

아니다. 후보 구성은 최적화하지 않은 각 20% 동일 비중 참고다. 저장 브리핑의 공식 성과는 측정일 0·평균 null이며 주문 체결 손익이 아니다. 과거 개발 자료도 독립 최종 test로 보지 않는다. 근거: [브리핑 스냅샷](../kis-briefing-ready.json), [성과 계약](../../../../FE/docs/api-contract.md), [manifest 한계](../../../../models/final_rank_ensemble/manifest.json).

### 7. 시연 중 API 한도나 Gemini 오류가 나면?

KIS는 기본 1 RPS·진행 중 요청 병합·캐시와 SWR로 부하를 줄인다. 단일 서버의 한 측정은 52회 중 한도 응답 0건이었지만 후속 최종 cold 측정에는 1건이 남았다. Gemini 실패는 규칙 기반 대체 또는 이전 검증 설명·오래됨 표시로 처리한다. 원자료 오류를 만들어 채우지는 않는다. 근거: [1 RPS 측정](../kis-load-single-rps1.json), [최종 측정](../kis-load-swr-final.json), [실패 계약](../../../../FE/docs/api-contract.md).

### 8. 현재 한계와 다음 검증은 무엇인가?

수급 실전 출처·업종 인증 구성·최신 구성종목·여러 프로세스의 토큰/계좌 유량·콜드 지수 대기가 남아 있다. 최종 화면 재촬영은 완료했으나 부정 면책 문장의 검증기 과잉 차단 가능성이 확인됐다. 최종 측정의 cold 지수 응답은 약 15초였고, 공식 성과는 아직 쌓이지 않았다. 모델 구조를 고정한 뒤 새 기간으로 관찰하고, 뉴스·매크로 추가 효과는 별도 비교로 검증해야 한다. 근거: [최종 부하 기록](../kis-load-swr-final.json), [구성종목 실패 기록](../pipeline-diagnostic.json), [검증 기록·미확인 경계](../README.md), [모델 한계](../../../../models/final_rank_ensemble/manifest.json).
