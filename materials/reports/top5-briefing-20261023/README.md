# TOP5 종합 브리핑 검증 기록 · 2026-10-23

`feat/top5-briefing`의 저장된 검증 산출물과 현재 API 계약을 대조한 기록이다. 아래 실호출 표는 저장 산출물의 관측이며, 최신 화면과 전체 회귀 검증은 [최종 승인 반영 기록](screenshots/fe-check/ui-review-final-approval.md)에 구분해 기록했다. 이후 사용자 승인으로 Gemini POST를 정확히 1회 실행하고 결과를 [최종 설명](narrative-final.json)에 저장했으며, 아래 최종 캡처를 갱신했다. 아래 성공·실패는 **각 파일을 생성한 실행의 관측**이며, 전체 데이터의 실전 출처·투자 성과·운영 안정성을 보증하지 않는다. 포스터 문안은 [poster/poster-content.md](poster/poster-content.md), 시연은 [poster/usage-flow.md](poster/usage-flow.md), 구성도는 [poster/diagram-system.md](poster/diagram-system.md)에 있다.

## 무엇을 만들었나

원본 모델 TOP5에 시장 지표, 종목별 결정적 근거·주의점, 기사 출처, 설명 전용 Gemini 요약을 붙인 브리핑이다. `GET /api/briefing`은 조회만 하며 Gemini는 호출하지 않는다. `POST /api/briefing/narrative`가 별도로 설명을 생성한다. 참고 통계와 동일 비중 후보 구성은 설명과 분리해 표시한다. 근거: [현재 API 계약](../../../FE/docs/api-contract.md), [FE 안내](../../../FE/README.md).

시장 지표는 코스피·코스닥·코스피200 야간선물·나스닥·S&P500·원/달러·미국 국채 10년 금리다. 야간선물은 KIS, 나머지는 Yahoo 관측이며 각 출처·관측 시각과 미국장 상태를 함께 제공한다. 지표가 누락되면 `unavailable`/null로 남긴다. 근거: [API 계약](../../../FE/docs/api-contract.md), [수집 스냅샷](kis-briefing-ready.json).

## 설계 원칙과 모델 선택 근거

- **순위 경로 고정:** `plain_20_120_rank_mean_v1`의 `pred_rank` 순서를 그대로 사용한다. 수급·뉴스·매크로·Gemini는 재정렬하지 않는다. 완료 실행·모델·날짜·모집단·전체/상위 순위 파일의 일관성을 먼저 확인한다. 근거: [API 계약](../../../FE/docs/api-contract.md).
- **출력 의미 고정:** `rank_zscore`는 같은 날 비교 종목 내 상대 순위 점수다. 예상수익률·상승확률·점수 부호에 따른 상승/하락 판정으로 쓰지 않는다. 근거: [루트 README](../../../README.md), [모델 manifest](../../../models/final_rank_ensemble/manifest.json).
- **모델 구성:** 20일·120일 각각 seed 42·43·44의 고정 모델을 사용한다. seed별 당일 평균 동순위를 표준화하고 기간별 평균 후 50:50 단순평균한다. 최근 120거래일 특징이 유효한 동일 모집단을 양쪽에 넣는다. 근거: [루트 README](../../../README.md), [manifest](../../../models/final_rank_ensemble/manifest.json).
- **복잡도와 증거의 경계:** 단기·장기 관측 길이를 함께 쓰되 학습형 결합을 추가하지 않은 구조다. 현재 README는 복잡도와 검증 근거를 고려한 선택이라고 설명한다. manifest에는 순수 Transformer rolling OOF/게이트 연구가 없고, 과거 개발 구간이 독립 최종 test가 아니라고 명시돼 있다. 현재 자료에서 단순평균과 모든 대안의 직접 비교표는 확인하지 못했다. 따라서 “최고 성능이라 채택”이라고 쓰지 않는다. 근거: [루트 README](../../../README.md), [manifest의 limitations](../../../models/final_rank_ensemble/manifest.json).
- **LLM은 입력 사실 설명만:** 스키마·종목 순서·인용 ID·수치·단위·날짜·금지 표현을 서버에서 검사한다. 실패 필드만 규칙 기반 설명으로 대체하고 출처를 표시한다. 단순 검증 통과가 원자료의 사실성까지 검증한 것은 아니다. 근거: [API 계약](../../../FE/docs/api-contract.md), [필드 복구 구현](../../../FE/server/briefingNarrative.ts), [검증 규칙](../../../FE/server/briefingValidation.ts).
- **별도 참고 정보:** 나스닥 과거 비율과 후보 구성은 Gemini 입력에서 제외한다. 후보 구성은 최적화하지 않은 각 20% 동일 비중 참고이며, 검증된 공식 성과가 없으면 평균을 null로 둔다. 근거: [API 계약](../../../FE/docs/api-contract.md).

## 실분석과 원본 순위 대조

기준일 `2026-10-22`, 예측 대상 `next_session_open_to_close`다. 저장 실행은 `completed`, 오류 null, 경과 40,115ms였다([kis-analysis-live.json](kis-analysis-live.json)). 전체 행 199개 중 유효 행 199개, 순위 연속성 true, 모델·점수 유형·기준일은 각각 한 종류였다([kis-rank-verification.json](kis-rank-verification.json)). 브리핑은 HTTP 200·`ready`·모집단 199를 반환했다([kis-briefing-ready.json](kis-briefing-ready.json)). 이는 출력 계약 확인이며 정확도나 수익률이 아니다.

| 순위 | 종목 | 코드 | 원본 순위 점수 | 근거 |
|---:|---|---|---:|---|
| 1 | 한화오션 | 042660 | 1.6015144347924204 | [순위 대조 JSON](kis-rank-verification.json) |
| 2 | 롯데정밀화학 | 004000 | 1.5434885494738542 | [순위 대조 JSON](kis-rank-verification.json) |
| 3 | 신세계 | 004170 | 1.523179489612356 | [순위 대조 JSON](kis-rank-verification.json) |
| 4 | 한화생명 | 088350 | 1.520278195346428 | [순위 대조 JSON](kis-rank-verification.json) |
| 5 | HD현대마린엔진 | 071970 | 1.5057717240167865 | [순위 대조 JSON](kis-rank-verification.json) |

두 JSON의 코드·순서는 같으며 마지막 점수는 직렬화된 끝자리 차이가 있다. 이 기록은 원본 CSV 전체를 새로 재검산한 결과가 아니라 저장된 검증 JSON끼리의 대조다. 후보 풀은 초기 실패 로그에서 pykrx 구성종목 조회 실패 후 내장 풀을 사용한 것으로 기록돼 있어, 최신 KOSPI200 구성종목 전체와의 일치까지 주장하지 않는다([pipeline-diagnostic.json](pipeline-diagnostic.json)).

## 매크로 수집 확인

아래는 하나의 저장 스냅샷이며 현재 시세가 아니다. 시각은 원본 UTC다. 출처·단위는 [API 계약](../../../FE/docs/api-contract.md), 각 값·상태·시각은 [kis-briefing-ready.json](kis-briefing-ready.json) 근거다.

| 지표 | 값 | 단위·출처 | 관측 시각 UTC | 상태 |
|---|---:|---|---|---|
| 코스피 | 5533.77 | pt · Yahoo | 2026-10-22T11:05:40Z | ok |
| 코스닥 | 764.1 | pt · Yahoo | 2026-10-22T11:05:40Z | ok |
| 나스닥 | 26013.834 | pt · Yahoo | 2026-10-22T16:51:38Z | ok · open |
| S&P500 | 7648.46 | pt · Yahoo | 2026-10-22T16:51:40Z | ok · open |
| 원/달러 | 1326.36 | KRW · Yahoo | 2026-10-22T16:51:34Z | ok |
| 미국 국채 10년 | 4.986 | % · Yahoo | 2026-10-22T16:36:33Z | ok |
| 코스피200 야간선물 | 841.1 | pt · KIS | 2026-10-22T16:51:00Z | ok · open |

이 스냅샷의 지표는 모두 수집됐지만 이후 cold GET은 야간 자료를 기다리다 미수집을 반환할 수 있다. 미국 장중 수치를 마감 수치 또는 다음 한국장의 결과로 표시하지 않는다. 근거: [스냅샷](kis-briefing-ready.json), [cold 응답 계약](../../../FE/docs/api-contract.md), [최신 캡처 후보](screenshots/fe-check/home-1440-dark-viewport.png).

## Gemini 실호출과 실패 경로

| 저장 실행 | 경과 ms | 결과 | 판정·근거 |
|---|---:|---|---|
| 검증기 보완 중 | 12,068 | template | `ungrounded_number` · [narrative-live-guard-fixed.json](narrative-live-guard-fixed.json) |
| 필드별 검증 도입 후 | 9,199 | llm | HTTP 200, `gemini-3.8-flash`, `fallbackReason=null` · [narrative-live-partial.json](narrative-live-partial.json) |
| 최종 승인 1회 호출 · 10/23 13:23 KST 생성 | 9,974 | llm · 부분 규칙 기반 | HTTP 200, `gemini-3.8-flash`, `fallbackReason=partial_template`; 개요 template, 시장 설명·5개 종목 llm · [narrative-final.json](narrative-final.json) |

이전 `narrative-live-partial.json`의 파일명에 `partial`이 있지만 그 실행의 관측 결과는 **개요·시장 설명·모든 종목 설명이 llm**이다. 그 파일을 부분 대체의 근거로 쓰지 않는다. 최종 `narrative-final.json`에서는 개요만 규칙 기반으로 대체됐고 시장 설명과 5개 종목 설명은 llm으로 유지됐다. 이전 실행의 `citationsCount=26`·`stockCitationsCount=20`은 [이전 JSON](narrative-live-partial.json)에 기록돼 있으며, 최종 실행의 8개·30개와 구분한다. 필드별 실패 대체 사례는 [테스트 코드](../../../FE/src/test/briefingNarrative.test.js)에 있으며 최신 전체 테스트 결과는 [최종 승인 반영 기록](screenshots/fe-check/ui-review-final-approval.md)에 별도로 기록했다.

입력에 있는 금액·날짜·순매수/순매도 설명까지 거부할 수 있던 검증을 보완했다. 현재 구현은 수급 사실과 거래 권유를 구분하고, 한국어 금액 단위·방향·허용 날짜를 확인한다. 초기 실패 파일만으로 개별 차단 문장의 정확한 원인을 모두 확정할 수는 없다. 근거: 위 실패 JSON, [검증기](../../../FE/server/briefingValidation.ts), [필드 복구 코드](../../../FE/server/briefingNarrative.ts), [API 계약](../../../FE/docs/api-contract.md).

## 최종 포스터 캡처 · 13:23 KST Gemini 결과 반영

GET으로 ready·기준일 2026-10-22·같은 완료 실행을 확인한 뒤 POST를 정확히 1회 호출했다. 최종 결과는 [narrative-final.json](narrative-final.json)에 원문·필드 출처와 함께 저장했다. 전역 인용 8개, 종목별 인용 합계 30개다. 서버 로그에서 개요의 forbidden_content 대체를 확인했다. 거부된 문장에는 ‘기대수익률이나 상승 확률을 의미하지 않으며 매수나 매도를 권유하지 않습니다’라는 부정 면책이 있어 과잉 차단 가능성이 남지만, 이번에는 코드 수정·재호출하지 않았다.

TOP1 한화오션(042660)과 TOP5 전체 시세 응답 HTTP 200 및 현재가 렌더 완료, 가격 이력 로딩 종료를 확인한 뒤 촬영했다. 최종 전체 높이는 데스크톱 4,271px·모바일 7,510px이며 가로 넘침은 없었다. 기존 metrics와 승인 기록은 그때의 측정이며 이 최종 촬영과 구분한다. 콘솔 오류·예외·HTTP 4xx/5xx는 0건이었다. 개발 모드의 요청 취소 AbortError는 있었으나 최종 시세 5개는 모두 성공했다. 캡처를 직접 열어 제목·통계·펼친 근거와 시세 ‘조회 중’ 부재를 확인했다.

| 캡처 | 내용 |
|---|---|
| [poster-briefing-1440-dark.png](screenshots/fe-check/poster-briefing-1440-dark.png) | 1440×1000 실제 뷰포트, 종합 브리핑과 시장 지표가 함께 보이는 포스터 컷 |
| [poster-stock-1440-dark.png](screenshots/fe-check/poster-stock-1440-dark.png) | 1440×1000 실제 뷰포트, 한화오션 종목 카드의 근거·주의점·기사 펼침 |
| [home-1440-dark-viewport.png](screenshots/fe-check/home-1440-dark-viewport.png), [전체](screenshots/fe-check/home-1440-dark-full.png) | 1440×900 홈, 전체 컷은 참고 통계 펼침 포함 |
| [home-375-dark-full.png](screenshots/fe-check/home-375-dark-full.png), [첫 화면](screenshots/fe-check/home-375-dark-viewport.png) | 모바일 375×812 홈, 전체 컷은 참고 통계 카드 포함 |
| [reference-1440-dark.png](screenshots/fe-check/reference-1440-dark.png), [reference-375-dark.png](screenshots/fe-check/reference-375-dark.png) | 최종 참고 통계 확대, 데스크톱 차트·모바일 행 카드 |

## KIS 요청·한도 측정

호출 수와 한도 응답은 `runs[].kisCalls/rateLimitResponses`다. API HTTP 성공과 KIS 내부 한도 오류를 구분한다. cold/warm/panel은 해당 측정기의 단계명이며 파일마다 요청 묶음이 달라 동일 부하 벤치마크로 해석하지 않는다.

| 측정 | cold 호출/한도 응답 | warm 호출/한도 응답 | panel 호출/한도 응답 | 근거 |
|---|---:|---:|---:|---|
| 단일 서버·1 RPS | 31 / 0 | 11 / 0 | 10 / 0 | [kis-load-single-rps1.json](kis-load-single-rps1.json) |
| SWR·지수 캐시 적용 최종 | 31 / 1 | 7 / 0 | 측정 없음 | [kis-load-swr-final.json](kis-load-swr-final.json) |

단일 서버·1 RPS 측정은 합계 52회에서 한도 응답이 없었다([해당 JSON](kis-load-single-rps1.json)). 그러나 **그 뒤 최종 SWR cold 측정에는 `EGW00201` 1건·KIS HTTP 500이 남아 있다**([최종 JSON의 calls](kis-load-swr-final.json)). “1 RPS에서 항상 무오류” 또는 “한도 문제 완전 해결”로 결론내리지 않는다.

최종 GET 브리핑 cold는 1,620~1,710ms, warm은 127~134ms였다. cold 지수 API는 15,266~15,393ms, 같은 측정의 후속 캐시 응답과 warm은 1ms였다([kis-load-swr-final.json](kis-load-swr-final.json)). 브리핑 대기 단축이 지수·시세·차트 전체 준비 완료를 뜻하지 않는다.

현재 Node 공통 스로틀 기본은 1건/초, 진행 중 요청 병합, 야간·업종 SWR와 cold 공유 대기 예산 1.5초, 실패 음성 캐시 60초, 지수 스냅샷 캐시 기본 20초다. 공식 상한과 환경에서 관측한 안정 구간을 구분하며, Python·다른 프로세스까지 계좌 유량을 합산 제어하지 않는다. 근거: [API 계약](../../../FE/docs/api-contract.md), [스로틀 구현](../../../FE/server/kisRateLimit.ts).

## 발견한 문제와 대응

| 문제 | 증거 | 적용한 대응과 남은 경계 |
|---|---|---|
| pykrx 지수 조회 실패·KRX 인증 환경 | [pipeline-diagnostic.json](pipeline-diagnostic.json)의 STEP2 `지수명` 오류·KRX 로그인 확인 메시지 | 지수 일봉을 KIS와 로컬 증분 캐시로 수집. 설치된 pykrx 서비스의 인증 환경에 따라 기존 경로는 실패할 수 있음. 종목 OHLCV는 기존 pykrx 경로 유지. [계약](../../../FE/docs/api-contract.md) |
| 야간 분봉의 24~30시 표기 | [night-observation.json](night-observation.json)의 `300000` 거부 | 세션 시작일·확장 시간 표기를 다음 날짜로 정규화. 검증된 야간 시각만 허용. 후속 성공은 [ready 스냅샷](kis-briefing-ready.json), 현재 규칙은 [계약](../../../FE/docs/api-contract.md). 모든 장·휴장 상황을 검증한 것은 아님 |
| 설명 검증의 과잉 차단·전체 대체 | [최종 부분 대체 기록](narrative-final.json), 위 실호출 표 | 단위·날짜·수급 사실 검증 보완, 실패 필드만 규칙 기반 대체. 검증기 통과가 사실성과 인과관계의 완전한 검증은 아님 |
| KIS 중복 호출·초당 한도 | 위 측정 표 | 기본 1 RPS·진행 중 병합·캐시·재시도 제한·SWR 적용. 최종 측정에도 한도 응답 잔존 |

KIS 지수 이력 최초 수집은 지수별 1,813행, 각 범위 `2019-06-03~2026-10-22`, 누락 Close/Volume 각각 0이었다. 최초 123,462ms·HTTP 109회(53+56), 즉시 재실행 2,794ms·HTTP 2회였다([market-history-live.json](market-history-live.json)). 이는 이력 초기화 비용이며 위 cold 화면 지수 API 약 15초와 다른 측정이다.

## 알려진 한계와 제출 전 확인

- **업종 미확인:** 실전 도메인에서 모의 앱키로 호출할 수 없다는 `EGW02004`가 저장돼 있다. `sectors=null`을 유지하며 업종 분산도를 만들어 넣지 않는다. [sector-diagnostic.json](sector-diagnostic.json), [ready 스냅샷](kis-briefing-ready.json).
- **수급 출처 미검증:** 기존 Python 로더가 루트 로컬 설정으로 요청 환경을 덮는 동작이 남아 있고 새 지수 수집기만 외부 요청 환경을 우선한다. 수급이 mock 경로 데이터일 가능성을 배제하지 못했다. Gemini가 요약한 금액을 실전 검증 수급으로 발표하지 않는다. [루트 README](../../../README.md), [API 계약](../../../FE/docs/api-contract.md), [설명 스냅샷](narrative-live-partial.json). 비밀 설정 파일을 열어 확인하지 않았다.
- **토큰·계좌 동시성:** 토큰 캐시 재사용은 중복 발급을 줄이지만 여러 프로세스의 동시 발급 방지까지 검증하지 않았다. Node 스로틀도 프로세스 밖 요청을 합산하지 않는다. [루트 README](../../../README.md), [API 계약](../../../FE/docs/api-contract.md).
- **성과 부재:** 공식 동일 비중 성과 `measuredDays=0`, 평균 null이다. 0% 수익이나 실매매 검증 완료로 해석하지 않는다. [kis-briefing-ready.json](kis-briefing-ready.json).
- **미래 성능 미검증:** 과거 개발 구간의 재사용·구성종목 proxy·수정주가 snapshot·거래비용/시장충격 미반영 한계가 있다. 이전 화면 정리는 가상 입력 검증이었다. [manifest](../../../models/final_rank_ensemble/manifest.json), [전일 정리 보고서](../final-code-cleanup-20261022/README.md).
- **캡처 범위:** 최종 브리핑은 [fe-check 전체 화면](screenshots/fe-check/home-1440-dark-full.png)과 [모바일 화면](screenshots/fe-check/home-375-dark-full.png)에 보존했습니다. 참고 통계 펼침·상태 안내·누락값은 실제 상태대로 표시하며, [측정 자료](screenshots/fe-check/ui-review-metrics.json)와 [접근성 결과](screenshots/fe-check/a11y-review.txt)를 함께 확인하세요. 분석 진행률과 전용 종목 리포트의 최신 캡처는 보존하지 않았으므로 해당 화면의 검증 근거로 쓰지 않습니다. [컷 선정표](poster/usage-flow.md).
- **감사 범위:** [secret-pattern-audit.txt](secret-pattern-audit.txt)는 열거한 보고서 파일의 패턴 미일치 기록이다. 저장소 전체의 비밀 정보 부재를 보증하는 감사가 아니다. 비밀 파일은 이 문서 작업에서 열지 않았다.

## 매크로·뉴스를 브리핑으로 분리한 근거

저장소 재검증의 기본 기간은 `2025-10-22~2026-10-22`, 유효 코스피 표본 243일·마지막 관측 `2026-10-20`·제외 2일·`partial_missing_prices`다. `requested → alignments.latest_prior`에서 나스닥 상승 후 코스피 종가→종가 상승은 73.3%(96/131), 같은 표본 기준선은 60.9%(148/243)다. 시가→종가는 46.6%(61/131), 기준선 50.6%(123/243)다. 시가→종가 조건부 비율의 95% 블록 부트스트랩 구간은 39.9~53.0%, 기준선과의 차이 구간은 -8.87~+0.63%p로 0을 포함한다. 근거: [result.json](../macro-nasdaq-kospi/result.json), [산식·결측·정렬 설명](../macro-nasdaq-kospi/README.md).

종가→종가는 한국 시가 갭을 포함한다. 두 정의의 차이는 그 비율을 시가 매수 이후 성과로 옮기면 안 된다는 근거이며, “나스닥 신호가 갭에 모두 반영됐다”는 인과 증명은 아니다. 이 결과만으로 매크로 피처 전체가 무용하다고 결론내릴 수도 없다. 국내 두 지수의 과거 특징은 이미 모델 입력에 들어가며, 이번에 분리한 것은 추가 매크로 관측·조건부 참고 통계·최신 기사 설명이다. 근거: [통계 보고서](../macro-nasdaq-kospi/README.md), [현재 모델 특징](../../../models/final_rank_ensemble/manifest.json).

팀이 공유한 뉴스 감정분석·다음날 상관 **0.053**은 **팀 내부 분석(출처: 팀 공유 자료)**이다. 이 위임에 제공된 수치로서 저장소 원자료·기간·표본·산식은 확인하지 못했다. 저장소 재계산치로 표시하지 않는다. 별도로 보관된 [뉴스 추가 예측력 연구](../docs/news_research_conclusion.md)는 시험한 방법에서 기사 내용에 의한 일관된 개선을 확인하지 못했다고 보고하지만, 과거 다른 가격 모델의 개발 실험이므로 현재 순위 모델의 뉴스 무효성을 입증하지는 않는다.

## 재현 명령과 수행 범위

아래는 재현에 사용할 명령이다. 이번 최종 촬영에서는 기존 완료 분석을 유지하고 GET 조회와 승인된 Gemini POST 1회만 실행했다. 전체 테스트·빌드는 직전 [최종 승인 반영 기록](screenshots/fe-check/ui-review-final-approval.md)을 따르며 이번에는 재실행하지 않았다. 로컬 개발 서버와 이미 안전하게 구성된 서버 환경이 필요하다. 비밀 파일 내용을 출력하는 명령은 포함하지 않는다. 실행 안내 근거: [루트 README](../../../README.md), [FE 안내](../../../FE/README.md), [통계 실행 안내](../macro-nasdaq-kospi/README.md).

```powershell
# 저장소 루트: 오프라인 통계를 별도 출력으로 재계산
python scripts/analysis/nasdaq_kospi_conditional.py --source-json materials/reports/macro-nasdaq-kospi/result.json --output materials/reports/top5-briefing-20261023/poster/statistics-replay.json

# 저장소 루트: 모델 관련 검사
python -m unittest discover -s tests -p test_final_rank.py -v
python -m unittest discover -s tests -p test_market_index_history.py -v
python -m unittest discover -s tests -p test_nasdaq_kospi_conditional.py -v

# 저장된 결과를 읽는 로컬 API 확인(별도 터미널에서 개발 서버 실행 후)
$baseUrl = 'http://127.0.0.1:5173'
Invoke-RestMethod "$baseUrl/api/backend/status"
Invoke-RestMethod "$baseUrl/api/rank"
Invoke-RestMethod "$baseUrl/api/briefing"

# 새 분석/설명 생성은 외부 호출과 산출물 변경을 동반한다.
Invoke-RestMethod -Method Post "$baseUrl/api/candidates/run?mode=model_only&kind=adhoc"
Invoke-RestMethod "$baseUrl/api/candidates/run"
# completed를 확인한 다음 설명 생성
Invoke-RestMethod -Method Post "$baseUrl/api/briefing/narrative"
```

```powershell
# FE 디렉터리에서 실행
npm run dev -- --host 127.0.0.1
# 전체 검증은 별도 실행 터미널에서
npm test
npm run typecheck
npm run build
```

기존 문서 작성 시 JSON 간 순위·값 대조와 저장 일봉 통계 재계산을 수행했다. 이후 이번 최종 촬영에서 GET 상태 확인, 승인된 Gemini POST 1회, 실제 시세 응답 완료 확인, PNG 직접 열람과 문서 로컬 링크·비밀 패턴 검사를 수행했다. 전체 테스트·빌드는 직전 승인 반영 기록의 결과이며, 설명 검증 통과가 원자료의 실전 출처나 모델 성과까지 입증하지는 않는다.


