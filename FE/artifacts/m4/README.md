# M4 fixture 브라우저 검증

모든 수치와 PNG는 검증용 fixture입니다. FE에서 `npm run build` 후 `node scripts/verify/m4-smoke.mjs`. 기존 Edge/Chrome과 자동 할당 localhost 포트만 사용합니다. 다른 CDP harness와 동시에 실행하지 마세요. 외부 네트워크와 제품 POST는 차단합니다. 실제 KIS/Vercel/유료 분석/외부 기사는 검증하지 않았습니다.
