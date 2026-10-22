# 최종 모델 웹 화면

루트 [실행 안내](../README.md)와 [API 계약](docs/api-contract.md)을 기준으로 실행합니다.

```powershell
npm ci
npm run dev -- --host 127.0.0.1
```

현재 경로는 `/` 브리핑, `/rank` 전체 순위, `/stock/:code` 종목 리포트, `/watchlist` 관심 목록, `/history` 실행·성과 기록, `/about` 소개입니다. `/next`는 같은 현재 화면으로 연결되는 별칭이며 별도 구현이 아닙니다. 이전 `/legacy` 화면은 제거했습니다.

브리핑 실행은 최종 20일·120일 모델 순위와 TOP5 관련 RSS 기사를 표시합니다. 순위 점수는 수익률이나 상승확률이 아닙니다. 저장 성과는 실제 시가·종가가 모두 확보된 선정 종목으로 계산합니다.

기본 manifest는 `models/final_rank_ensemble/manifest.json`입니다. `PIPELINE_MODEL_MANIFEST`로 이를 덮어쓸 때도 최종 모델 형식만 허용합니다. `PIPELINE_ANALYSIS_MODE`는 `model_only`만 지원합니다. 실행 결과는 루트 `outputs/`에 생성합니다. 실제 API/Python 작업에는 개발 서버 또는 API 서버가 필요하고 정적 preview만으로는 실행되지 않습니다.

검증: `npm test`, `npm run typecheck`, `npm run build`. 브라우저 점검 도구는 `scripts/verify/`에 있으며 새 산출물은 루트 `outputs/ui-verification/`에 저장합니다. 과거 화면·점검 기록은 [materials](../materials/README.md)에 모았습니다.
