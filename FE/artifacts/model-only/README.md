# model_only fixture 브라우저 검증

모든 수치와 PNG는 검증용 fixture이며 model-only 실행 후 서버 상태(최종 후보 미생성, 뉴스 보정값 null)를 흉내 냅니다. FE에서 `npm run build` 후 `node scripts/verify/model-only-smoke.mjs`. 기존 Edge/Chrome과 자동 할당 localhost 포트만 사용하고 다른 CDP harness와 동시에 실행하지 마세요. 외부 네트워크와 제품 POST는 차단합니다. 실제 KIS/Gemini/모델 실행은 검증하지 않았습니다.
