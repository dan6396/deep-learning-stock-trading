# 화면 4차 권장 사항 반영

주 구현이 직접 수정했습니다. 커밋·푸시·Gemini POST 재호출은 하지 않았습니다.

## 항목별 결과

1. 데스크톱 차트 그룹 제목을 `나스닥 상승 뒤 코스피 상승 비율` / `나스닥 하락 뒤 코스피 하락 비율`로 명시했습니다. 근거: `FE/src/features/briefing/BriefingMacroReference.tsx:11`.
2. 성공한 AI 요약의 generatedAt부터 10분 동안 재생성을 막고 요청한 안내를 표시합니다. 10분이 지나도 macroStale인 경우에만 활성화합니다. 경계 시각에 자동으로 상태를 갱신하며, 10분 이내 시장 변경 안내는 보조 톤입니다. 템플릿의 generatedAt은 실제 AI 생성 시각이 아니므로 최초 생성은 허용합니다. 근거: `BriefingNarrativeCard.tsx:28`; 회귀: `BriefingTopBriefing.test.tsx:1271`.
3. generation_in_progress이면 버튼을 잠그고 5초마다 GET을 재조회합니다. 60초에 종료하고 계속 진행 중이면 다시 조회 안내를 표시합니다. 상태 전환·언마운트 시 타이머를 정리합니다. 근거: `BriefingPage.tsx:23`, `:101`; 5초 경계·12회 상한·재진입·언마운트 회귀: `BriefingPage.test.tsx:371`.
4. 639px 이하에서는 SVG 범례를 숨깁니다. 실제 375px에서 범례 비노출, 행 카드 노출을 확인했습니다. 근거: `briefingTop.css:1637`; 실측: `ui-review-metrics.json`.
5. 데스크톱 차트 스크롤 영역에 tabindex=0·region·한국어 aria-label을 추가했습니다. 실제 768px에서 키보드 오른쪽 방향키로 scrollLeft가 0→44px로 이동했고 포커스를 유지했습니다. 근거: `BriefingMacroReference.tsx:21`; 실측: `keyboard-scroll-768.json`.
6. 상위 비율은 최대 소수 둘째 자리까지 표시하여 2/199의 메타도 서버 근거와 같은 1.01%로 표시합니다. 불필요한 후행 0은 붙이지 않습니다. poolSize가 없으면 모집단 문구를 생략합니다. 근거: `BriefingStockSection.tsx:112`.
7. 반복 순위 점수 면책은 종합 요약·종목 요약·종목 주의 표시에서 제거하고 하단 면책과 TOP5 도움말을 유지했습니다. API의 근거·주의 데이터는 바꾸지 않았습니다. 서버 commonCautions의 중복 면책 및 실측 0일 주의를 제거하고, 자료 조회 실패(null)는 별도 안내로 구분했습니다. 상단 상태는 우선순위 문장 하나와 나머지 안내의 펼침 상세로 정리하고 헤더 간격을 줄였습니다. 근거: `FE/src/entities/briefing.ts:199`, `BriefingStockSection.tsx:80`, `BriefingNarrativeCard.tsx:77`, `FE/server/briefingComposition.ts:32`.
8. 사용자 텍스트 가드가 소문자 snake_case를 검출합니다. 대문자는 알려진 내부 식별자 목록으로 한정해 OECD·NASA·UNICEF 등 일반 단어의 오탐을 방지합니다. 근거: `FE/src/test/assertUserText.ts:4`; 회귀: `assertUserText.test.ts:4`.
9. URL 없는 기사를 어댑터에서 제외하는 기존 규칙을 유지하고, 기사 칩과 펼친 목록 건수가 남은 기사 수를 따르는 회귀를 추가했습니다. 근거: `BriefingTopBriefing.test.tsx:1312`.

## 검증

- FE 전체 `npm test`: **663/663**, 제외 0건.
- `npm run typecheck`, 최종 `npm run build`, `git diff --check`: 통과.
- 기존 `a11y.mjs`의 OS 임시 사본에 768px 폭만 추가하고 의존성 경로를 맞춰 실행했습니다. 저장소 검증 스크립트는 수정하지 않았습니다.
- 1440/1280/768 × 다크/라이트: axe·가로 넘침·클릭 영역·제목 구조 **24/24 통과**. 로그: `a11y-review.txt`.
- 펼친 참고 통계의 1440/375 다크 실제 캡처: axe 위반 0건씩, 콘솔 오류 0건, 런타임 예외 0건, 내부 식별자 노출 0건, 가로 넘침·카드 잘림 0건.
- 상태 안내 본문은 각 화면 1개, 모바일 범례는 숨김, 모바일 통계 최소 글자는 12px, 카드 간 간격은 16px입니다.
- 갱신된 전체 화면·모바일 뷰포트·참고 통계 확대 캡처를 직접 확인했습니다. 방향 제목·글자 크기·간격·잘림·모바일 범례 숨김을 확인했습니다.

| 화면 | 전체 높이 | 목표 | 초과 |
|---|---:|---:|---:|
| 1440×900 다크, 참고 통계 펼침 | 4,251px | 3,500px | 751px |
| 375×812 다크, 참고 통계 펼침 | 7,315px | 7,000px | 315px |

가독성을 유지한 결과이며 높이 목표는 아직 초과합니다. 실제 시세·요약 상태에 따라 높이가 바뀔 수 있습니다.

## 변경 파일

- `FE/src/features/briefing/BriefingMacroReference.tsx`
- `FE/src/features/briefing/BriefingNarrativeCard.tsx`
- `FE/src/features/briefing/BriefingPage.tsx`, `BriefingPage.test.tsx`
- `FE/src/features/briefing/BriefingStockSection.tsx`
- `FE/src/features/briefing/BriefingTopBriefing.test.tsx`
- `FE/src/features/briefing/briefingTop.css`
- `FE/src/entities/briefing.ts`, `briefing.test.ts`
- `FE/server/briefingComposition.ts`, `FE/src/test/briefingComposition.test.js`
- `FE/src/test/assertUserText.ts`, `assertUserText.test.ts`

## 캡처·서버

fe-check/의 `home-1440-dark-full.png`, `home-1440-dark-viewport.png`, `home-375-dark-full.png`, `home-375-dark-viewport.png`, `reference-1440-dark.png`, `reference-375-dark.png`를 갱신했습니다. 측정은 `ui-review-metrics.json`에 저장했습니다.

재시작 전후 메인에 알렸으며 dev 서버는 **5173 / PID465892 / exec session73197**로 유지합니다.

후속 작업 준비 완료
