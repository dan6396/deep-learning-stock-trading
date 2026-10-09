# M2 fixture 브라우저 검증

스크린샷과 report.json은 localhost의 결정적 fixture 결과입니다. 실제 시장·브로커·유료 분석 데이터를 검증하지 않습니다.

재실행: FE에서 `npm run build` 후 `node scripts/verify/m2-smoke.mjs`. 기존 Edge/Chrome을 사용하며 외부 네트워크와 제품 POST 요청을 차단합니다.
