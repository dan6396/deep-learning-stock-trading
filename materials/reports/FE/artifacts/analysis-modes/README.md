# 분석 실행 모드 선택 검증

브리핑의 새 분석 실행에서 `모델 예측만` 또는 `뉴스 포함`을 선택합니다. 선택은 해당 실행에만 적용되며 서버 기본값은 유지됩니다. 뉴스 포함에는 네이버 뉴스와 Gemini 설정이 필요하고 유료 API 호출 안내를 표시합니다.

- 전체 Vitest: 29개 파일, 362개 테스트 통과. 마지막 선택 고정 변경 후 관련 컴포넌트 테스트 12개 재확인.
- TypeScript 및 Vite 빌드 통과.
- 브라우저 검증 23개 통과: 키보드 선택/실행, 모드 전달, 설정 부족 차단, 실행 중 변경 차단, 모바일/데스크톱 및 두 테마, axe WCAG A/AA 위반 없음.
- API 라우트와 Python 실행 인자/키 전달은 모의 실행으로 검증했습니다. 실제 Python 작업 및 유료 뉴스·Gemini 호출은 실행하지 않았습니다.

`verification.json`은 브라우저 결과이며 PNG는 각 모드 화면입니다. 재현: FE에서 `npm run build`, `node scripts/verify/analysis-control-smoke.mjs`.
