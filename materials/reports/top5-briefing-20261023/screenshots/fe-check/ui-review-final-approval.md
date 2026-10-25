# 최종 승인 조건·권장 반영 기록

## 결과

> 아래는 이전 승인 시점의 기록입니다. 당시의 viewport 2장과 모바일 참고 통계 PNG는 10/25 포스터 정리에서 삭제했습니다. 현재 캡처 목록은 [보고서 README](../../README.md)의 ‘현재 포스터 캡처’를 따르며, 아래 당시 파일명 목록은 역사적 기록입니다.

C1·C2와 R1~R7을 반영했습니다. 커밋·스테이징·푸시하지 않았습니다. 5173 개발 서버를 한 번 종료한 뒤 빌드 통과 후 --force로 복구해 유지했습니다. 이 마무리 과정에서는 Gemini를 추가 호출하지 않았습니다.

## 조건·권장 처리와 근거

| 항목 | 처리 | 근거 |
|---|---|---|
| C1 | 루트 /.vite/ 무시. git check-ignore로 루트·FE 토큰 캐시, .env, 시장 이력 캐시도 제외 확인 | [.gitignore](../../../../../.gitignore#L23) |
| C2 | 필수 JSON 12개와 README/poster가 인용한 추가 진단 3개 유지. 루트 JSON 15개·이전 캡처/로그 13개·일회성 스크립트 2개 삭제. JSON·MD의 로컬 절대경로를 상대경로로 치환. 링크 누락 0건 | 아래 파일별 표, [감사](../../secret-pattern-audit.txt) |
| R1 | 권유·인과 어휘 확대. 명시적 기사 주제 ‘수혜 업종 관련 기사’와 자료 정리 절차만 좁게 허용. 이 표현 뒤 권유/인과가 붙으면 계속 차단 | [검증기](../../../../../FE/server/briefingValidation.ts#L176), [프롬프트](../../../../../FE/server/briefingNarrative.ts#L178), [회귀 16건](../../../../../FE/src/test/briefingNarrative.test.js#L33) |
| R2 | KIS 원본 단위(지수 거래량, 천 주 추정)로 정정. 캐시·scaler가 있을 때만 학습기간 1,174일 × 시장 피처 10개 평균·표준편차 소수 5자리 대조. 파일 없으면 해당 검사만 skip | [설명](../../../../../README.md#L59), [선택적 실자료 테스트](../../../../../tests/test_market_index_history.py#L238) |
| R3 | 최근 5일 재조회 누락 행은 기존 값·수집 시각 보존 및 RuntimeWarning. 응답에 명시된 null은 실제 정정값으로 덮어씀. 전부 비면 예외·캐시 미변경 | [병합](../../../../../market_index_history.py#L230), [누락 회귀](../../../../../tests/test_market_index_history.py#L92) |
| R4 | KIS 실패 메시지는 예외 종류와 MARKET_INDEX_SOURCE/KIS_ENV·실전 구성·pykrx 전환 안내만 노출. 상위 오류 원문을 반사하지 않음 | [안내](../../../../../market_index_history.py#L27), [예외 경계](../../../../../integrated_pipeline.py#L184), [회귀](../../../../../tests/test_market_index_history.py#L227) |
| R5·R7 | 기본 1 RPS cold/warm 지연 및 FE 기본 15초 제한 충돌 측정 권고. 스로틀·LLM 동시성·쿨다운·in-flight는 인스턴스별이며 공용 계좌 제한/분산 잠금이 별도로 필요함을 명시 | [운영 안내](../../../../../FE/README.md#L28) |
| R6 | 구성 부제 ‘동일 비중 참고’, 실측 영역에 미래 성과·작은 표본 한계. HTML·OG·Twitter 제목 중립화. 모델 배지를 순위 표현과 중립 아이콘/색으로 변경하고 뉴스 배지는 기존 의미 유지 | [구성](../../../../../FE/src/features/briefing/BriefingCompositionCard.tsx#L45), [실측 한계](../../../../../FE/src/features/briefing/BriefingCompositionCard.tsx#L196), [제목](../../../../../FE/index.html#L9), [배지](../../../../../FE/src/features/briefing/SignalView.tsx#L5), [상세 연결](../../../../../FE/src/features/briefing/DetailPanel.tsx#L44) |

## C2 유지 JSON

‘명시 유지’ 12개는 기존 인용 여부와 무관하게 승인 조건을 따랐고, 나머지 진단은 정리 전 README/poster 링크 여부로 판단했습니다. 이 표 자체를 추가 진단 유지 근거로 소급하지 않았습니다.

| 파일 | 유지 사유 | 정리 전 근거 문서 |
|---|---|---|
| [briefing-get.json](../../briefing-get.json) | 승인 조건의 명시 유지 | 기존 인용 없음 · 명시 유지 |
| [kis-analysis-live.json](../../kis-analysis-live.json) | README/poster 근거 링크 | README.md, poster/usage-flow.md |
| [kis-briefing-ready.json](../../kis-briefing-ready.json) | 승인 조건의 명시 유지 | README.md, poster/poster-content.md, poster/usage-flow.md |
| [kis-index-history-probe.json](../../kis-index-history-probe.json) | 승인 조건의 명시 유지 | 기존 인용 없음 · 명시 유지 |
| [kis-load-single-rps1.json](../../kis-load-single-rps1.json) | 승인 조건의 명시 유지 | README.md, poster/usage-flow.md |
| [kis-load-swr-final.json](../../kis-load-swr-final.json) | 승인 조건의 명시 유지 | README.md, poster/usage-flow.md |
| [kis-rank-verification.json](../../kis-rank-verification.json) | 승인 조건의 명시 유지 | README.md, poster/poster-content.md, poster/usage-flow.md |
| [market-history-live.json](../../market-history-live.json) | 승인 조건의 명시 유지 | README.md, poster/usage-flow.md |
| [market-source-probe.json](../../market-source-probe.json) | 승인 조건의 명시 유지 | 기존 인용 없음 · 명시 유지 |
| [narrative-live-guard-fixed.json](../../narrative-live-guard-fixed.json) | 승인 조건의 명시 유지 | README.md |
| [narrative-live-partial.json](../../narrative-live-partial.json) | 승인 조건의 명시 유지 | README.md, poster/poster-content.md, poster/usage-flow.md |
| [narrative-post.json](../../narrative-post.json) | 승인 조건의 명시 유지 | 기존 인용 없음 · 명시 유지 |
| [night-observation.json](../../night-observation.json) | README/poster 근거 링크 | README.md |
| [pipeline-diagnostic.json](../../pipeline-diagnostic.json) | 승인 조건의 명시 유지 | README.md, poster/usage-flow.md |
| [sector-diagnostic.json](../../sector-diagnostic.json) | README/poster 근거 링크 | README.md, poster/diagram-system.md, poster/poster-content.md, poster/usage-flow.md |

README.md, poster/diagram-system.md, poster/poster-content.md, poster/usage-flow.md와 secret-pattern-audit.txt도 유지합니다. 포스터의 이전 홈·상세·캡처 리포트 링크를 최신 fe-check 근거로 바꾸고, 미보존된 전용 리포트 화면을 검증했다고 주장하지 않도록 고쳤습니다.

## C2 삭제 파일

| 파일 | 판단·참조 처리 |
|---|---|
| analysis-failure.json | README/poster 근거 링크 없음 |
| analysis-run.json | README/poster 근거 링크 없음 |
| backend-status.json | README/poster 근거 링크 없음 |
| browser-blank-diagnostic.json | 명시 삭제 대상 |
| integration-diagnostics.json | 명시 삭제 대상 |
| kis-index-probe.json | README/poster 근거 링크 없음 |
| kis-kospi-history-probe.json | README/poster 근거 링크 없음 |
| kis-load-baseline.json | 기존 인용을 정리한 뒤 삭제 |
| kis-load-single-after-dedupe.json | 기존 인용을 정리한 뒤 삭제 |
| kis-load-single-before-dedupe.json | 기존 인용을 정리한 뒤 삭제 |
| kis-load-throttled.json | 기존 인용을 정리한 뒤 삭제 |
| narrative-live-low-thinking.json | 기존 인용을 정리한 뒤 삭제 |
| narrative-live-once.json | 기존 인용을 정리한 뒤 삭제 |
| night-parameter-probe.json | README/poster 근거 링크 없음 |
| yahoo-index-probe.json | README/poster 근거 링크 없음 |
| screenshots/capture-report.json | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/home-1440-dark-full.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/home-1440-dark-viewport.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/home-1440-light-full.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/home-1440-light-viewport.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/home-375-dark-full.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/home-375-light-full.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/panel-042660-1440-dark-focus.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/panel-042660-1440-dark-full.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/panel-042660-1440-dark-viewport.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/stock-042660-1440-dark-full.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/stock-042660-1440-dark-viewport.png | 최신 fe-check로 대체 · 이전 링크 정리 |
| screenshots/fe-check/a11y-review4.txt | 최신 a11y-review.txt로 통합 · 이전 링크 정리 |
| FE/scripts/verify/capture-fe-check.mjs | 일회성 보고서 경로·상태에 종속. 참조 정리 후 삭제 |
| FE/scripts/verify/measure-all.mjs | 일회성 측정·캡처 보조. 참조 정리 후 삭제 |

범용 Chrome DevTools 연결 도구 cdp-browser.mjs와 dev 서버 대상 a11y.mjs는 재사용 가능한 검증 도구로 유지했습니다. OS 임시 폴더의 이번 작업 스크립트는 커밋 후보에 포함되지 않습니다.

## 최종 화면 한 세트

| 파일 | 유지 근거 |
|---|---|
| [home-1440-dark-full.png](home-1440-dark-full.png) | 데스크톱 전체 화면·참고 통계 펼침 |
| `home-1440-dark-viewport.png` (이전 파일 삭제) | 당시 데스크톱 첫 화면 |
| [home-375-dark-full.png](home-375-dark-full.png) | 모바일 전체 화면·참고 통계 펼침 |
| `home-375-dark-viewport.png` (이전 파일 삭제) | 당시 모바일 첫 화면 |
| [reference-1440-dark.png](reference-1440-dark.png) | 데스크톱 통계 확대 |
| `reference-375-dark.png` (이전 파일 삭제) | 당시 모바일 카드 통계 확대 |
| [ui-review-metrics.json](ui-review-metrics.json) | 최신 높이·오버플로·콘솔·axe 실측 |
| [keyboard-scroll-768.json](keyboard-scroll-768.json) | 이전 키보드 가로 스크롤 실측 |
| [a11y-review.txt](a11y-review.txt) | 최종 접근성 로그 |
| [ui-review-summary.md](ui-review-summary.md), [ui-review4-summary.md](ui-review4-summary.md) | 검토 차수별 결과 기록 |
| ui-review-final-approval.md | 이번 조건·권장 처리 및 파일 정리 기록 |

최신 홈은 1440px에서 높이 4,271px, 375px에서 7,335px입니다. 기존 목표 3,500/7,000px보다 길지만 가독성을 희생해 축소하지 않았습니다. 모바일 참고 카드 최소 글자 12px, 가로 넘침·잘린 통계 카드·내부 식별자·콘솔 오류·예외·axe 위반은 각각 0건입니다. 1440 첫 화면과 375 전체 화면 캡처를 직접 확인했습니다.

## 검증

| 명령·검사 | 결과 |
|---|---|
| FE: npm test -- --reporter=json --outputFile=OS임시파일 | 680/680 통과, 제외 0 |
| FE: npm run typecheck | 통과 |
| FE: npm run build | 통과, 2,037 모듈 변환 |
| 루트: .venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v | 33/33 통과, skip 0 |
| 로컬 시장 scaler 대조 | 1,174 × 10, mean 최대 차이 8.15e-8, std 최대 차이 6.26e-7, 소수 5자리 통과 |
| dev 접근성 검사 · 1440/375/768 × 다크/라이트 × 홈/패널/종목 | 18 조합, 72개 검사 통과, axe 위반 0 |
| git diff --check | 통과 |
| git check-ignore | .vite·루트/FE 토큰 캐시·.env·시장 이력 캐시 제외 확인 |
| 보고서 로컬 링크·절대경로 검사 | 끊어진 링크 0, 로컬 절대경로 0 |
| 유지 JSON/MD 비밀 패턴 감사 | Google 키 형태·Bearer·JWT·계좌 형태·민감 JSON 키 값 패턴 미검출. 값은 출력하지 않고 파일별 결과만 저장 |

감사는 지정 패턴의 탐지 결과이며 모든 형태의 비밀 부재를 보증하지 않습니다. 실제 .env·토큰 캐시 파일은 열지 않았습니다.

## 커밋 후보 전체 목록

현재 후보 97개, 스테이징 0개입니다. 아래는 이번 브랜치 전체의 수정·미추적 파일이며 이번 마무리에서 작성한 파일만 뜻하지 않습니다. 실제 비밀 파일 경로·캐시 경로 후보는 0개, 10MB 이상 후보도 0개입니다. 목록에는 제외된 모델·지수 캐시가 없습니다.

```text
.gitignore
FE/.gitignore
FE/README.md
FE/docs/api-contract.md
FE/index.html
FE/scripts/verify/a11y.mjs
FE/scripts/verify/cdp-browser.mjs
FE/server/boundedJson.ts
FE/server/briefing.ts
FE/server/briefingComposition.ts
FE/server/briefingNarrative.ts
FE/server/briefingReference.ts
FE/server/briefingValidation.ts
FE/server/inFlight.ts
FE/server/kisBriefing.ts
FE/server/kisDashboard.ts
FE/server/kisRateLimit.ts
FE/server/marketMacro.ts
FE/server/pipelineResults.ts
FE/server/revalidatingCache.ts
FE/server/routes.ts
FE/src/app/AppRoutes.test.tsx
FE/src/entities/briefing.test.ts
FE/src/entities/briefing.ts
FE/src/features/briefing/BriefingCompositionCard.tsx
FE/src/features/briefing/BriefingMacroGrid.tsx
FE/src/features/briefing/BriefingMacroReference.tsx
FE/src/features/briefing/BriefingNarrativeCard.tsx
FE/src/features/briefing/BriefingPage.test.tsx
FE/src/features/briefing/BriefingPage.tsx
FE/src/features/briefing/BriefingStockSection.tsx
FE/src/features/briefing/BriefingSummary.test.tsx
FE/src/features/briefing/BriefingSummary.tsx
FE/src/features/briefing/BriefingTopBriefing.test.tsx
FE/src/features/briefing/BriefingTopContainer.tsx
FE/src/features/briefing/DetailPanel.tsx
FE/src/features/briefing/ModelTopFiveTable.tsx
FE/src/features/briefing/SignalView.tsx
FE/src/features/briefing/briefingDashboard.css
FE/src/features/briefing/briefingTop.css
FE/src/shared/api/analysis.ts
FE/src/shared/api/queries.test.ts
FE/src/shared/api/queries.ts
FE/src/test/assertUserText.test.ts
FE/src/test/assertUserText.ts
FE/src/test/briefing.test.js
FE/src/test/briefingComposition.test.js
FE/src/test/briefingNarrative.test.js
FE/src/test/briefingReference.test.js
FE/src/test/kisBriefing.test.js
FE/src/test/kisDashboard.test.js
FE/src/test/kisInFlight.test.js
FE/src/test/kisRateLimit.test.js
FE/src/test/kisSettlement.test.js
FE/src/test/marketMacro.test.js
FE/src/test/revalidatingCache.test.js
FE/src/test/routes.test.js
README.md
integrated_pipeline.py
market_index_history.py
materials/reports/macro-nasdaq-kospi/README.md
materials/reports/macro-nasdaq-kospi/result.json
materials/reports/top5-briefing-20261023/README.md
materials/reports/top5-briefing-20261023/briefing-get.json
materials/reports/top5-briefing-20261023/kis-analysis-live.json
materials/reports/top5-briefing-20261023/kis-briefing-ready.json
materials/reports/top5-briefing-20261023/kis-index-history-probe.json
materials/reports/top5-briefing-20261023/kis-load-single-rps1.json
materials/reports/top5-briefing-20261023/kis-load-swr-final.json
materials/reports/top5-briefing-20261023/kis-rank-verification.json
materials/reports/top5-briefing-20261023/market-history-live.json
materials/reports/top5-briefing-20261023/market-source-probe.json
materials/reports/top5-briefing-20261023/narrative-live-guard-fixed.json
materials/reports/top5-briefing-20261023/narrative-live-partial.json
materials/reports/top5-briefing-20261023/narrative-post.json
materials/reports/top5-briefing-20261023/night-observation.json
materials/reports/top5-briefing-20261023/pipeline-diagnostic.json
materials/reports/top5-briefing-20261023/poster/diagram-system.md
materials/reports/top5-briefing-20261023/poster/poster-content.md
materials/reports/top5-briefing-20261023/poster/usage-flow.md
materials/reports/top5-briefing-20261023/screenshots/fe-check/a11y-review.txt
materials/reports/top5-briefing-20261023/screenshots/fe-check/home-1440-dark-full.png
materials/reports/top5-briefing-20261023/screenshots/fe-check/home-1440-dark-viewport.png
materials/reports/top5-briefing-20261023/screenshots/fe-check/home-375-dark-full.png
materials/reports/top5-briefing-20261023/screenshots/fe-check/home-375-dark-viewport.png
materials/reports/top5-briefing-20261023/screenshots/fe-check/keyboard-scroll-768.json
materials/reports/top5-briefing-20261023/screenshots/fe-check/reference-1440-dark.png
materials/reports/top5-briefing-20261023/screenshots/fe-check/reference-375-dark.png
materials/reports/top5-briefing-20261023/screenshots/fe-check/ui-review-final-approval.md
materials/reports/top5-briefing-20261023/screenshots/fe-check/ui-review-metrics.json
materials/reports/top5-briefing-20261023/screenshots/fe-check/ui-review-summary.md
materials/reports/top5-briefing-20261023/screenshots/fe-check/ui-review4-summary.md
materials/reports/top5-briefing-20261023/secret-pattern-audit.txt
materials/reports/top5-briefing-20261023/sector-diagnostic.json
scripts/analysis/nasdaq_kospi_conditional.py
tests/test_market_index_history.py
tests/test_nasdaq_kospi_conditional.py
```

## 미해결·불확실 사항

- KIS 지수 거래량의 ‘천 주’ 단위는 추정 표현을 유지합니다. vrel20의 상수 배율 불변성과 이번 로컬 scaler 대조가 단위 공식 확정을 대신하지 않습니다.
- root .env가 FE 요청 환경을 덮어 기존 Python 수급 단계의 실전/모의 구성을 바꾸는 기존 문제는 남아 있습니다. 새 지수 수집기만 외부 환경 스냅샷을 우선합니다.
- 업종 EGW02004 및 기본 1 RPS에서 cold 요청과 FE 15초 제한의 충돌 가능성은 기존 운영 한계입니다. 다중 인스턴스 공용 제한은 구현하지 않았습니다.
- 화면 전체 높이는 이전 목표를 초과합니다. 최신 실측값을 위에 기록했습니다.

후속 작업 준비 완료

