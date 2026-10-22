# M3 fixture 브라우저 검증

모든 데이터와 PNG는 localhost 검증용 fixture입니다. 실제 시장·KIS·Vercel·유료 분석을 검증하지 않았습니다. 외부 네트워크/제품 POST는 차단되며 기사는 방문하지 않습니다.

FE에서 `npm run build` 후 `node scripts/verify/m3-smoke.mjs`. 기존 Edge/Chrome과 자동 할당 localhost 포트를 사용합니다. 동일 harness를 동시에 실행하지 마세요. 실패 시 report.json의 실제 요청/콘솔/포커스와 failure.png를 확인하세요.
