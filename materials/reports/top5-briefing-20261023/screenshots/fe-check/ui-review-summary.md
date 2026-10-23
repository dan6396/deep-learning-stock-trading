# 브리핑 화면 승격 수정 결과

주 구현이 직접 수정했습니다. 커밋·푸시 및 Gemini POST 재호출은 하지 않았습니다.

## 차단 사항

1. 참고 통계 범례를 `조건부 비율 / 같은 기간 기준선`으로 일반화했습니다. 전일 종가→종가와 시가→종가의 색 스와치를 구분하고, SVG 접근성 이름에는 각 행의 실제 조건·정의·비율·건수·기준선·신뢰구간을 포함했습니다. 근거: `FE/src/features/briefing/BriefingMacroReference.tsx:20`.
2. 639px 이하에서는 SVG를 숨기고 조건·정의·비율·관측 건수·기준선·신뢰구간의 행 카드를 표시합니다. 실제 375px 화면 최소 글자 크기는 12px이며, 가로 넘침과 카드 잘림은 0건입니다. 근거: `BriefingMacroReference.tsx:50`, `briefingTop.css:1633`.
3. `macroStale` 문구를 한국어 안내로 교체했습니다. 공통 사용자 텍스트 검사 헬퍼로 대문자 내부 코드·macroStale·fallbackReason 노출을 검사합니다. 근거: `BriefingNarrativeCard.tsx:180`, `FE/src/test/assertUserText.ts:4`, `BriefingTopBriefing.test.tsx:1239`.

## 권장 사항

1. 깨진 `-bottom` 선언을 복구하고 종합 브리핑·시장 지표·TOP5 표·구성·종목 섹션 사이 간격을 16px로 통일했습니다.
2. 종목 목록의 기본 ul 패딩·마진·불릿을 제거했습니다.
3. 이름·코드·원본 순위가 없는 종목, 코드·요약이 없는 서사, id·제목·URL·출처가 없는 기사는 제외합니다. 순위 점수·모집단·상위 비율의 누락은 null로 보존하여 화면에 `—`를 표시합니다. 임의 이름·코드·0을 주입하지 않습니다. 근거: `FE/src/entities/briefing.ts:349`, `:369`, `:406`; 회귀: `FE/src/entities/briefing.test.ts:186`.
4. 다른 컴포넌트를 강제하던 높이 축소용 !important 블록을 제거했습니다. 기사 제목은 2줄 클램프와 title, 접힌 종목 요약은 3줄 클램프와 title을 제공합니다. 기사 링크 클릭 높이는 접근성 검사에 맞춰 최소 24px입니다. 최종 전체 페이지 높이는 아래 표와 같이 목표를 초과합니다.
5. 참고 통계의 펼친 영역은 중복 note 대신 방법·한계를 표시합니다. 시장 지표 맥락은 관측일 안내로 줄이고, 구성 카드의 별도 하단 면책은 제거하여 페이지 하단 면책을 유지했습니다. 증감은 아이콘 하나와 화면 낭독용 상승/하락 텍스트로 표시합니다.
6. 종합 카드 지표 시점 배지의 괄호 힌트를 제거하고 title에 남겼습니다.
7. 실측 0일에는 기준 시각을 숨깁니다. 업종 태그의 코드 중복을 제거하고 `측정 일수`로 표기합니다.
8. SVG의 그룹 제목과 축 눈금을 서로 다른 위치에 배치했습니다. 정의 정렬 비교기는 동등 항목에 0을 반환합니다. reduced-motion에서는 하이라이트가 정적 outline이며 막대 전환을 끕니다.
9. TOP5 밖 R: 인용을 숨기고 중복 인용을 제거했습니다. 인용 접근성 이름의 반복도 제거했습니다. 근거: `BriefingNarrativeCard.tsx:68`, `BriefingStockSection.tsx:203`; 회귀: `BriefingTopBriefing.test.tsx:1250`.
10. 근거·주의·기사 칩은 span 정보 표시입니다. 자세히 버튼만 접기를 제어하며 접힌 상태에도 aria-controls 대상 컨테이너는 존재합니다. 근거: `BriefingStockSection.tsx:160`.
11. 이전 브리핑이 있는 갱신 실패에도 안내를 표시합니다. 근거: `BriefingPage.tsx:86`; 회귀: `BriefingPage.test.tsx:67`.
12. 기존 60초 narrative 요청 및 타임아웃 오류 전파 테스트를 확인했고 전체 검사에서 통과했습니다. 근거: `FE/src/shared/api/queries.test.ts:147`.

## 서버 참고 통계

각 구간·조건 행의 ratioPct와 baselinePct, 신뢰구간을 함께 검사합니다. 비율 방향과 신뢰구간이 기준선과의 차이를 뒷받침할 때만 높음/낮음을 서술하며, 기준선을 포함하면 뚜렷한 차이가 관찰되지 않았다고 표시합니다. 신뢰구간이 없으면 판단 자료 부족을 명시합니다. 근거: `FE/server/briefingReference.ts:38`; 회귀: `FE/src/test/briefingReference.test.js:30`.

## 검증

- FE 전체 `npm test`: 648/648 통과, 제외 0건.
- `npm run typecheck`: 통과.
- 최종 `npm run build`: 통과.
- `git diff --check`: 통과. 다른 작성자의 파일에 대한 기존 CRLF 안내는 있습니다.
- `node FE/scripts/verify/a11y.mjs http://127.0.0.1:5173 /`: 1440/1280 × 다크/라이트의 axe·가로 넘침·24px 클릭 영역·제목 순서 총 16개 검사 통과. 로그: `a11y-review.txt`.
- 참고 통계를 펼친 실제 1440/375 다크 화면 axe 위반 0건씩, 콘솔 오류 0건, 런타임 예외 0건. 측정: `ui-review-metrics.json`.
- 전체 캡처와 참고 통계 확대 캡처를 직접 확인했습니다. 글자·간격·잘림을 점검했으며 모바일에서는 SVG 대신 행 카드가 보입니다.

| 화면 | 최종 높이 | 목표 | 초과 | 최소 모바일 통계 글자 | 가로 넘침 / 카드 잘림 |
|---|---:|---:|---:|---:|---:|
| 1440×900 다크, 참고 통계 펼침 | 4,353px | 3,500px | 853px | 해당 없음 | 0 / 0 |
| 375×812 다크, 참고 통계 펼침 | 7,503px | 7,000px | 503px | 12px | 0 / 0 |

글자 크기·기사 클릭 영역·수급 요약을 유지한 결과입니다. 데이터와 요약 상태에 따라 높이는 달라질 수 있습니다. 콜드 진입에서는 템플릿이 보였다가 시장 자료 준비 후 다시 조회하면 기존 AI 일부 대체 요약이 보이는 현상도 관찰했습니다. 이 서버 캐시 전환의 원인은 이번 화면 작업에서 수정·확정하지 않았으며, 최종 전체 캡처는 다시 조회한 뒤 저장했습니다.

## 변경 파일

- `FE/src/entities/briefing.ts`, `FE/src/entities/briefing.test.ts`
- `FE/src/features/briefing/BriefingMacroReference.tsx`
- `FE/src/features/briefing/BriefingNarrativeCard.tsx`
- `FE/src/features/briefing/BriefingMacroGrid.tsx`
- `FE/src/features/briefing/BriefingCompositionCard.tsx`
- `FE/src/features/briefing/BriefingStockSection.tsx`
- `FE/src/features/briefing/BriefingPage.tsx`, `BriefingPage.test.tsx`
- `FE/src/features/briefing/BriefingTopBriefing.test.tsx`
- `FE/src/features/briefing/ModelTopFiveTable.tsx`
- `FE/src/features/briefing/briefingTop.css`, `briefingDashboard.css`
- `FE/src/test/assertUserText.ts`
- `FE/server/briefingReference.ts`, `FE/src/test/briefingReference.test.js`

## 캡처와 서버

- `home-1440-dark-full.png`, `home-1440-dark-viewport.png`
- `home-375-dark-full.png`, `home-375-dark-viewport.png`
- `reference-1440-dark.png`, `reference-375-dark.png` (참고 통계 확대 확인용)
- dev 서버는 5173, PID 438928, exec session 48134로 유지합니다. 재시작 전후 메인에 알렸습니다.

후속 작업 준비 완료
