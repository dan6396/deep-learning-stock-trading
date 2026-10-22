# 현재 최종 모델 API 계약

- `GET /api/rank`: 최종 모델의 전체 유효 종목 순위. 실행 미완료·오래된 결과·다른 모델 결과는 제공하지 않습니다.
- `GET /api/stock-analysis?ticker=005930`: 같은 전체 순위에서 해당 종목과 관련 기사를 반환합니다.
- `GET /api/candidates`: 별도 뉴스 보정 최종 목록을 생성하지 않아 빈 배열을 반환합니다. 화면 TOP5는 원본 모델 순위 1~5위입니다.
- `POST /api/candidates/run?mode=model_only&kind=adhoc`: 현재 최종 모델 추론과 RSS 기사 수집을 시작합니다. `kind=official`은 공식 성과 기록 요청입니다.
- `GET /api/candidates/run`: 비동기 실행 상태·진행률.
- `GET /api/backend/status`: 읽기 전용 로컬 구성·실행·산출물 상태.
- `GET /api/performance`: 저장 실행과 실제 가격 성과. 선정 종목 시가·종가가 모두 있어야 계산합니다.
- `/api/korean-market/*`: 지수·시세·차트·거래일 달력.

## 모델 행

`model_id=plain_20_120_rank_mean_v1`, `score_kind=rank_zscore`, `rank_score` 유한 실수, `pred_rank` 원본 순위, `pred_pool_size` 비교 종목 수, `prediction_base_date` 공통 완료 거래일을 사용합니다. `prediction_target=next_session_open_to_close`는 경제적 정답의 대상입니다. `ensemble_pred_return`는 비워 두고 `p_up`을 제공하지 않습니다.

순위 점수는 평균 0·표준편차 1로 변환한 seed별 당일 종목 순위를 6개 평균한 값입니다. 퍼센트나 양수/음수 방향 적중률로 해석하지 않습니다. 전체 CSV와 Top5 CSV의 모델·날짜·모집단·점수·순위가 일치해야 완료로 처리합니다.

RSS 기사는 모델 순위를 변경하지 않습니다. 과거 뉴스/LLM 결과 파일을 읽어 점수에 섞지 않습니다. 실패한 기사 조회는 성공한 0건 조회와 구분합니다.

신규 성과 원장은 점수 유형과 모델 ID를 고정 저장합니다. 성과 응답의 `rankScore`는 원본 점수, `actualReturn`은 실제 시가→종가 수익률입니다. 순위 모델의 `predictedReturn`과 방향 `hitRate`는 null입니다. 집계는 같은 모델·점수 유형끼리 계산합니다.

이전 뉴스 학습·보정 실행 및 `/api/stock-analysis/run` 경로는 제거했습니다. 현재 화면에서 관찰 날짜·자료 출처·실행 ID를 확인할 수 있습니다.
