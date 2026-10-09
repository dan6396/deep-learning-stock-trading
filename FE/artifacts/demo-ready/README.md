# 후속 2 · 코드 검토 권장 사항 반영 (최신)

요청한 9개 항목을 반영했다. 이 절과 현재 PNG/JSON이 최신 결과이며, 아래 후속 1 기록은 당시 이력으로 보존한다. 경로는 FE 기준이다.

## 항목별 변경과 근거

| 항목 | 반영 내용 | 근거 (파일:줄) |
| --- | --- | --- |
| 1. 하단 문구 | 모델 전용 연속 원본 순위에서만 “원본 순위 6위 이하 194종목은 전체 순위에서 확인”. produced/비연속은 “나머지 종목은 전체 순위에서 확인” | `src/features/briefing/BriefingPage.tsx:61` |
| 2. 모의투자 위계 | 976.1만 원과 -2.39%를 같은 20px 위계, +3.26%p는 다음 줄. 모의투자·3거래일·고정 기록은 항상 표시. 칸별 aria-label 구분 | `src/features/briefing/BriefingSummary.tsx:18`, `:23`, `src/features/briefing/briefingDashboard.css:19` |
| 3. 시장 제목 | “최근 지수 흐름”, “당일 지수 등락 기반 단순 판단” | `src/features/briefing/BriefingSummary.tsx:19`, `:21` |
| 4. 순위 깜빡임 | pending/unknown에서 뉴스·일치도·최종 후보 필터/보정 열 숨김. produced + 후보 갱신 오류의 이전 최종 값도 확정값으로 표시하지 않는 의도 주석/테스트 | `src/features/rank/RankPage.tsx:19`, `:40`, `src/features/rank/RankTable.tsx:51`, `:63`, `:65` |
| 5. 대화상자 | body/root 스크롤 잠금·복원, 실행 중 닫아도 서버에서 계속 진행 안내. 네이티브 내부 이동 + 처음/마지막 경계만 순환. 라디오 그룹은 선택된 항목 또는 첫 활성 항목만 경계에 포함 | `src/features/briefing/AnalysisDialog.tsx:12`, `:24`, `:30`, `:39`, `src/features/briefing/analysisDialog.css:6` |
| 6. 상세 닫기 | X와 닫기/포커스 복귀 콜백 제거. 모바일은 “표로 돌아가기” 앵커와 포커스 가능한 표 제목 | `src/features/briefing/DetailPanel.tsx:32`, `src/features/briefing/BriefingPage.tsx:53`, `:68`, `src/features/briefing/briefingDashboard.css:102` |
| 7. 시세 출처 | 출처·조회/저장 시각 한 줄. 다른 출처는 혼합, 다른 시각은 가장 오래된 시각. sample 가격/등락은 —와 예시. 실패는 접근성 이름·툴팁·문자 | `src/features/briefing/CandidateTable.tsx:16`, `:31`, `:40`, `:44`, `src/features/briefing/briefingDashboard.css:57` |
| 8. 금액·부호 | 절대값 0.05억 미만은 부호 없이 0.0억. 음수는 formatPercent와 동일한 ASCII 하이픈(-) | `src/features/briefing/briefingData.ts:8` |
| 9. 메타·차트 | 모델 전용 분석 메타는 rank 기준. 1M 응답의 실제 기간이 더 길어 제목을 “가격 이력”으로 변경하고 실제 관측 날짜 표시. 원본/보간·결측 미연결은 한 줄, 기간·출처 정보는 details 보존 | `src/features/briefing/BriefingPage.tsx:68`, `src/features/briefing/DetailPanel.tsx:30`, `src/features/briefing/BriefingChart.tsx:14`, `:20` |

변경 소스 11개는 위 표의 고유 파일이다. 변경 테스트 8개:

- `src/features/briefing/AnalysisDialog.test.tsx:25`: 스크롤 잠금·복원, 경계 Tab, Esc/포커스, 실행 중 안내, 라디오 선택/비활성 경계, 열기만으로 실행하지 않음.
- `src/features/briefing/BriefingPage.test.tsx`: 상세 X 제거·표 복귀 앵커와 기존 선택/이력.
- `src/features/briefing/BriefingSummary.test.tsx:15`: 칸별 aria-label·절대 수익률 위계·details 밖 고정 기록.
- `src/features/briefing/briefingData.test.ts:15`: 작은 양수·음수 및 0.05억 경계·부호.
- `src/features/briefing/CandidateTable.test.tsx:27`: 실패 접근성·시각·혼합 출처·sample 가격 숨김.
- `src/features/briefing/BriefingChart.test.tsx:26`: 실제 기간 제목·보간·축약 문구와 details 정보 보존.
- `src/features/briefing/candidateProduction.test.tsx:63`: 모델 전용/produced/비연속 하단 문구와 rank 메타.
- `src/features/rank/RankPage.test.tsx:76`: pending→확정·unknown 열 숨김. `:111`: 이전 후보가 남은 갱신 오류의 최종·모드 의존 열 숨김.

증거 파일: `verify-briefing.mjs`, `briefing-verification.json`, `tests-final.json`, `run-origin-audit.json`, `run-audit-before.json`, `run-audit-after.json`, `followup2-baseline-verification.json`, 이 README 및 아래 PNG.

## 최종 검증

```text
npm test -- --reporter=json --outputFile=artifacts/demo-ready/tests-final.json
431 passed / 431, 0 failed · 12.59s · exit 0
npm run typecheck
정상 종료 · exit 0
npm run build
2058 modules · built in 9.96s · exit 0
정적 소개 HTML 2개 각각 6.78 kB
node artifacts/demo-ready/verify-briefing.mjs
42 checks passed · exit 0
7개 화면 axe 위반 0건 · 콘솔 error 0건 · 런타임 예외 0건
비GET/외부 요청 시도 0건 · 분석 시작 클릭 0건
```

기존 개발 서버 127.0.0.1:5173 실데이터로 검증했으며 새 서버를 실행하지 않았다. 다크·라이트 브리핑/대화상자, 모바일, 전체 순위, 소개에서 axe·가로 넘침·12px 이상 글자를 확인했다. 1280×720 다크는 scrollY=0, 마지막 5행 하단 700.89px다. 실제 Edge에서 checked 라디오 진입/그룹 건너뛰기, Tab/Shift+Tab 경계, Esc 후 포커스, 스크롤 잠금/복원을 확인했다. 네이티브 처리만 남긴 Shift+Tab 실험에서 브라우저 영역으로 포커스가 빠져(activeElement=BODY), 최소 경계 처리를 유지했다. 실행 버튼은 누르지 않았다.

요청 캡처 5장 갱신:

- [1280×720 다크 브리핑](briefing-1280x720-dark.png)
- [1440 라이트 브리핑](briefing-1440-light.png)
- [375 라이트 브리핑](briefing-375-light.png) / [모바일 전체](briefing-375-light-full.png)
- [분석 대화상자](analysis-dialog-1440-light.png)
- [1440 라이트 전체 순위](rank-1440-light.png)

## 10/10 00:18·00:19 실행 관련 확인

- 조사한 이전 브라우저 스크립트는 종목 선택과 헤더 대화상자 열기만 클릭한다. 시작 버튼 클릭이나 분석 POST 코드는 없다. 기존 CDP 도구는 탐색 전 요청 단계에서 비GET API를 차단한다(`scripts/verify/cdp-browser.mjs:78`, `:105`). 이전 성공 보고서의 차단 요청 시도도 0건이다. 이전 보고서를 `followup2-baseline-verification.json`에 보존하고 조사 시작 당시 관련 파일 SHA256을 `run-origin-audit.json`에 저장했다.
- 실제 실행 경로는 `src/features/briefing/AnalysisControl.tsx:93` 시작 버튼 → `:49` mutation → `src/shared/api/analysis.ts:26` POST다. 대화상자 열기/마운트는 상태 GET이며 실행 로직은 수정하지 않았다.
- 기존 실행 버튼 테스트는 `src/features/briefing/AnalysisControl.test.tsx:16`의 mock fetch에서 끝난다. routes 테스트는 실행기를 mock(`src/test/routes.test.js:9`), pipelineRunner 테스트는 child_process·fs·원장을 mock(`src/test/pipelineRunner.test.js:3`), 원장 테스트는 OS 임시 디렉터리와 별도 PIPELINE_OUTPUT_DIR(`src/test/runLedger.test.js:12`)을 쓴다. 실제 분석 HTTP POST·Python 실행·저장소 원장 쓰기로 연결되는 경로는 확인되지 않았다.
- 이번 검증에는 fetch 단계 GET 전용 기록과 시작 버튼 클릭 차단도 추가했다. 시작 클릭 0건, 비GET 시도 0건. 작업 전후 최신 marker는 동일했다: `9cba7095-3f3c-47ff-8d5c-5115b9558cf9`, adhoc/model_only/completed, 시작 **10/10 00:19:31.769**, 완료 **00:19:49.289** (KST). 런타임 idle. 근거: `run-audit-before.json`, `run-audit-after.json`, `briefing-verification.json`.
- 결론: 확인한 코드·기록에서 이전 검증이나 이번 작업이 00:18/00:19 실행을 유발했다는 근거는 찾지 못했다. 과거 전체 네트워크 로그가 없고 금지된 서버 로그/outputs 원장을 읽지 않았으므로 호출 주체를 확정하거나 가능성을 완전히 배제할 수는 없다. 00:18 official/full은 사용자 전달 기록으로 독립 확인하지 못했고, 00:19 최신 실행은 GET marker로 확인했다.

## 미해결·불확실 사항

- 요청 항목의 남은 차단 사항은 없다. 실제 produced 결과 및 서버 실행 중 상태는 현재 서버 상태가 아니어서 mock 단위 테스트로 검증했다. 실제 분석은 실행하지 않았다.
- 1M 응답은 2026.08.25–10.08 및 3M 원본/기간 미확인 메타를 제공한다. 실제 관측 기간 제목과 details로 설명하며 서버의 기간 충족 여부는 확정하지 못했다.
- 과거 실행의 호출 주체는 위 근거의 한계로 미확정이다.
- 금지 경로의 직접 열람·수정, 레거시 수정, 커밋·stash·reset·checkout은 하지 않았다. npm 빌드 자동 산출물 외 수동 수정은 허용 범위 안이다.

---

# 후속 1 · 브리핑 재구성 당시 기록 (이력)

## 결과 요약

- 브리핑을 3칸 요약 띠 + 모델 Top-5 비교표 + 오른쪽 상세 패널로 재구성했다. 1280×720 다크 첫 화면에서 스크롤 없이 요약, 5행, 상세 패널 상단이 함께 보인다.
- 모델 전용은 모델·수급 2개 근거만 표시한다. 뉴스 열·근거·대표 기사는 제외하고, 원본 데이터로 만든 템플릿 문장을 표시한다. 생성된 최종 후보는 뉴스 포함 3개 근거를 유지한다.
- 헤더의 AI 분석 실행 버튼으로 기존 AnalysisControl을 대화상자에 연다. 진행 상태, 최초 포커스, Tab 순환, Esc 닫기와 버튼으로 포커스 복귀를 처리한다. 실행 로직은 수정하지 않았다.
- 고정 모의투자 기록을 API와 독립된 상수에 출처 주석과 함께 저장했다. 화면에는 기간·시작자금·고정 기록 배지를 표시하고 기준 설명에서 비교 지수와 실시간 성과가 아님을 명시한다.
- 검토 a~d를 반영했다. 소개의 모델 Top-5 흐름, 모델 전용 순위 일치도에서 뉴스 제외, activeFilter 빈 결과 분기, 후보 생산 상태 확정 전 최종 보정 열 숨김을 적용했다.
- 브리핑의 PerformancePanel과 큰 분석 실행 카드를 제거했다. PerformancePanel은 기존 분석 기록 화면에 남아 있다.

## 이번 후속 작업의 변경 파일 목록

아래 목록은 이번 후속 작업에서 직접 수정·추가한 파일이다. 기존 작업 트리의 다른 변경은 포함하지 않는다. 경로는 FE 기준이다.

| 영역 | 파일 |
| --- | --- |
| 헤더 | `src/app/AppShell.tsx`, `src/features/search/SearchDialog.tsx`, `src/features/search/search.css` |
| 모의투자·가격 데이터 | `src/entities/paperTrading.ts`(신규), `src/entities/market.ts` |
| 브리핑 구성 | `src/features/briefing/BriefingPage.tsx`, `CandidateTable.tsx`, `ModelTopFiveTable.tsx`, `DetailPanel.tsx`, `SignalView.tsx`, `membership.ts`, `briefing.css` |
| 신규 브리핑 모듈 | `src/features/briefing/AnalysisDialog.tsx`, `analysisDialog.css`, `BriefingSummary.tsx`, `BriefingChart.tsx`, `EvidenceAgreementView.tsx`, `briefingData.ts`, `briefingDashboard.css` |
| 관심 버튼 | `src/features/watchlist/WatchToggle.tsx` |
| 순위 | `src/features/rank/RankPage.tsx`, `RankTable.tsx`, `rankData.ts` |
| 소개 | `src/features/about/AboutContent.tsx`, `about.css`(기존 11px 보조 제목을 12px로 조정) |
| 갱신 테스트 | `src/features/briefing/BriefingPage.test.tsx`, `candidateProduction.test.tsx`, `src/features/rank/RankPage.test.tsx`, `rankData.test.ts` |
| 신규 테스트 | `src/features/briefing/AnalysisDialog.test.tsx`, `BriefingChart.test.tsx`, `BriefingSummary.test.tsx`, `CandidateTable.test.tsx`, `briefingData.test.ts` |
| 증거 | `artifacts/demo-ready/verify-briefing.mjs`, `briefing-verification.json`, `tests-final.json`, 이 문서 및 아래 PNG |

## 근거 (파일:줄)

- `src/app/AppShell.tsx:33`: 헤더 분석 버튼, `:36`: 브리핑 전용 밀도 스타일 적용.
- `src/features/briefing/AnalysisDialog.tsx:11`: 네이티브 dialog, `:14`: 모달을 먼저 닫은 뒤 포커스 복귀, `:18`: Tab 순환, `:31`: 실행 중 헤더 상태.
- `src/features/briefing/BriefingPage.tsx:29`: 모델 전용 rank 조회, `:33`: URL을 바꾸지 않는 기본 첫 종목 선택, `:59`: 생산 상태별 비교표, `:62`: 모집단 기준 후보 외 개수, `:66`: 판정 기준, `:69`: 오른쪽 패널.
- `src/features/briefing/ModelTopFiveTable.tsx:3`: 유효한 원본 순위를 오름차순 정렬해 최대 5개. 화면 순위 재생성·예측 대체 없음.
- `src/features/briefing/CandidateTable.tsx:13`: 5종목 quote GET, `:14`: 표시된 예측값의 양수 최댓값, `:25`: 조건부 뉴스 열, `:34`: 양수에만 상대 막대.
- `src/features/briefing/membership.ts:21`: 모델 전용 뉴스 판정 불가 및 모델·수급 일치도. `EvidenceAgreementView.tsx:4`: 모드에 따른 2개/3개 점과 긍정 개수.
- `src/entities/paperTrading.ts:1`: 사용자 제공 출처, `:3`: 고정 모의투자 수치.
- `src/features/briefing/BriefingSummary.tsx:19`: 시장 휴리스틱·로딩·코스피200, `:23`: 고정 기록, `:26`: 최근 완료 시각·종목 수·소요·출처.
- `src/features/briefing/briefingData.ts:10`: 원본 순위·수급 금액 템플릿, `:15`: 완료 결과와 다른 진행 중 실행의 소요를 혼합하지 않음.
- `src/features/briefing/DetailPanel.tsx:28`: quote·상세 조회, `:38`: 순위/모집단·근거 개수, `:40`: 관심·리포트, `:43`: 원본 수급 금액·일수, `:49`: 뉴스 기사는 모델 전용에서 제외.
- `src/features/briefing/BriefingChart.tsx:8`: 1M 쿼리, `:17`: 검증된 관측 세그먼트만 연결, `:20`: 보간·원본 범위·기간 가용성 표시. `src/entities/market.ts:76`: 명시된 보간 메타 보존.
- `src/features/briefing/briefingDashboard.css:9`: 데스크톱 2열, `:94`: 작은 화면에서 상세 패널 쌓기. `briefing.css:109`: 아이콘·텍스트·상승 빨강/하락 파랑 칩과 양 테마 대비.
- `src/features/rank/rankData.ts:37`: 검토 b, 모델 전용 일치도에서 기존 뉴스 신호도 제외.
- `src/features/rank/RankPage.tsx:20`: 검토 d, 생산 확정 전 최종 보정 열 숨김. `:41`: 검토 c, activeFilter 빈 결과 분기.
- `src/features/rank/RankPage.test.tsx:64`: 숨겨진 후보 필터가 남은 상태의 검색 결과 문구 검증. `:76`: 후보·status pending 중 최종 열 숨김과 produced 확정 후 표시 검증.
- `src/features/rank/rankData.test.ts:38`: 실제 뉴스 근거가 남아 있어도 모델 전용 일치도에서 제외되는지 검증.
- `src/features/about/AboutContent.tsx:9`: 검토 a, 모델 Top-5 흐름. `:13`: 브리핑 개수와 전체 순위 비율의 기준 구분.
- `src/features/search/SearchDialog.tsx:66`: 입력창 모양 검색 버튼, 기존 검색 동작 유지. `src/features/watchlist/WatchToggle.tsx:5`: 상세 패널용 관심 추가/해제 글자.

## 검증 결과

```text
npm test -- --reporter=dot
Test Files 38 passed (38)
Tests 418 passed (418)
Duration 11.41s
Exit 0

npm test -- --reporter=json --outputFile=artifacts/demo-ready/tests-final.json
418 passed, 0 failed
Exit 0

npm run typecheck
tsc -b
Exit 0

npm run build
vite v6.4.4
2058 modules transformed
dist/about/index.html 6.78 kB
dist/about.html 6.78 kB
built in 4.70s
Exit 0
```

브라우저 검증은 `node artifacts/demo-ready/verify-briefing.mjs`로 재현한다. 기존 127.0.0.1:5173 개발 서버를 사용했고 새 서버를 띄우지 않았다. 네트워크에는 실데이터 GET만 허용하고 dashboard/refresh를 차단했다. 상세 브라우저 결과는 `briefing-verification.json`에 저장한다.

- 실데이터 199종목 중 원본 1~5위 확인. 기본 1위 선택 시 URL 유지, 행 선택 시 `?code=`와 오른쪽 패널 변경.
- 1280×720 다크 첫 화면에서 scrollY=0, 마지막 5행 하단 700.89px로 화면 안에 포함.
- 다크·라이트 브리핑, 다크·라이트 분석 대화상자, 375px 라이트, 전체 순위, 소개에서 axe WCAG A/AA 위반 0건, 페이지 가로 넘침 0건, 표시 텍스트 12px 이상 확인.
- 대화상자 최초 포커스와 Esc 후 헤더 버튼 포커스 복귀 확인.
- 모델 전용 표의 2개 근거 점, 뉴스 섹션 없음, 고정 기록 배지 확인. quote는 정확히 5개 종목 코드를 조회한다(React 개발 모드 재부착으로 일부 GET은 반복될 수 있음).
- 모델 전용 순위 표의 최종 보정 열·뉴스 숨김 확인. pending 깜빡임과 activeFilter 전환은 단위 테스트로 검증.
- 정적 소개 HTML의 모델 Top-5 흐름·11개 특징 구성·2개 근거 안내 포함 확인.
- 콘솔 error 0건, 런타임 예외 0건, 비GET·외부 요청 시도 0건.

## 최신 캡처

| 파일 | 내용 |
| --- | --- |
| `briefing-1280x720-dark.png` | 1280×720 다크, 첫 화면 그대로, 스크롤 없음 |
| `briefing-1440-light.png` | 1440×1000 라이트, 첫 화면 |
| `briefing-375-light.png` | 375×1000 라이트, 첫 화면 |
| `briefing-375-light-full.png` | 모바일 전체 화면, 표 아래 상세 패널 확인 |
| `analysis-dialog-1440-light.png` | 헤더 분석 대화상자, 실행 버튼을 누르지 않은 상태 |
| `rank-1440-light.png` | 전체 순위, 모델 전용 열 숨김 |
| `about-1440-light.png` | 소개 문구 수정 후 캡처 |

이전 단계의 `verify.mjs`, `verification.json` 및 `*-start.png` 등은 이전 UI의 기록이다. 현재 UI 검증에는 위 `verify-briefing.mjs`와 `briefing-verification.json`을 사용한다.

## 시안과 달라진 점과 이유

1. 뉴스·대표 기사·뉴스 기반 문장과 3개 근거 점 대신 모델·수급 2개를 사용한다. 모델 전용에 대한 사용자 결정이다. produced에서는 기존 뉴스 근거를 유지한다.
2. 예시 20거래일 성과 대신 10/6–10/8의 3거래일 고정 모의투자 기록을 표시한다. 사용자 제공 값이며 API 성과와 연결하지 않는다.
3. 다음 거래일 날짜는 표시하지 않는다. API에서 목표 거래일을 확인하지 못했으므로 날짜를 추정하지 않는다. 시장 판단은 기존 지수 등락 휴리스틱을 쓰고 매매 지시 문구를 넣지 않는다.
4. 가격·수급·예측·저장 시각은 현재 API 값이다. 예시 값/샘플 시세 배지를 복사하지 않고 실제 출처를 표시한다. 현재 Top-5는 오리온홀딩스·삼성카드·기아·GS리테일·카카오뱅크다.
5. 1M 응답은 현재 3M 원본에서 제공된 2026.08.25–10.08 관측을 담고 기간 가용성이 unverified다. 날짜·원본 범위·전체 기간 미확인을 표시하며 없는 관측을 채우지 않는다. 시안의 05.20–06.19 구간을 만들지 않는다.
6. 현재가는 좁은 오른쪽 패널에서 종목명 아래에 배치했다. 원본 순위는 01~05로 표시하지만 누락·비연속 순위를 재번호하지 않는다. 모바일에서는 표 내부 가로 이동과 상세 패널 세로 쌓기를 사용한다.

## 미해결·불확실 사항

- 요청한 UI 구현과 검증에서 남은 차단 사항은 없다.
- 초기 검증 중 stock-chart GET이 한 번 502를 반환했고, 이후 최종 캡처에서는 정상 조회됐다. 실패 시 차트를 만들지 않고 조회 실패·—를 표시한다. 서버 원인 조사·수정은 범위 밖이다.
- 실제 produced 데이터와 실행 중 분석은 현재 서버 상태가 아니므로 단위 테스트로 검증했다. 실제 분석 POST·유료 호출·공식 성과 수집은 실행하지 않았다.
- 차트의 전체 1개월 기간 충족 여부와 다음 거래일 날짜는 API 근거로 확정할 수 없다. 학습 구조·산출물·모의투자 원장 자체의 독립 검증은 수행하지 않았다.

기존 미커밋 변경을 보존했다. 서버/API/Python/outputs/.env 소스 직접 열람·수정, 레거시 소스 수정, git commit/push/stash/reset/checkout은 하지 않았다. 빌드 도구가 생성하는 dist·TS 캐시 외 수동 수정은 허용된 경로 안이다.
