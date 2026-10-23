# 최종 모델 웹 화면

루트 [실행 안내](../README.md)와 [API 계약](docs/api-contract.md)을 기준으로 실행합니다.

```powershell
npm ci
npm run dev -- --host 127.0.0.1
```

현재 경로는 `/` 브리핑, `/rank` 전체 순위, `/stock/:code` 종목 리포트, `/watchlist` 관심 목록, `/history` 실행·성과 기록, `/about` 소개입니다. `/next`는 같은 현재 화면으로 연결되는 별칭이며 별도 구현이 아닙니다. 이전 `/legacy` 화면은 제거했습니다.

브리핑 실행은 최종 20일·120일 모델 순위와 TOP5 관련 RSS 기사를 표시합니다. 순위 점수는 수익률이나 상승확률이 아닙니다. 저장 성과는 실제 시가·종가가 모두 확보된 선정 종목으로 계산합니다.

기본 manifest는 `models/final_rank_ensemble/manifest.json`입니다. `PIPELINE_MODEL_MANIFEST`로 이를 덮어쓸 때도 최종 모델 형식만 허용합니다. `PIPELINE_ANALYSIS_MODE`는 `model_only`만 지원합니다. 실행 결과는 루트 `outputs/`에 생성합니다. 실제 API/Python 작업에는 개발 서버 또는 API 서버가 필요하고 정적 preview만으로는 실행되지 않습니다.

API: `GET /api/briefing`은 모델 TOP5·시장 지표 7종(코스피200 야간선물 포함)·기사 출처·근거·주의와 설명을 반환합니다. GET은 LLM을 호출하지 않습니다. `POST /api/briefing/narrative`로 설명을 생성하며 모델 순위는 변경하지 않습니다. 키 없음·오류 시 템플릿으로 동작하고, 갱신 실패 전에 성공한 설명이 있으면 그 설명을 유지합니다. 미국 지표는 정규장 마감/장중 상태와 관측일을 표시하며 모델 기준일 다음 한국 거래일의 시가→종가 대상과 구분합니다.

개요·시장 설명·종목 설명은 필드별로 검증합니다. 실패 필드만 템플릿으로 대체하고 `narrative.fieldSources.overview/marketNote`, `narrative.stocks[].source`로 표시합니다. 일부가 LLM이면 `status="llm"`과 `fallbackReason="partial_template"`, 모두 실패하면 `status="template"`입니다. 숫자는 단위·절댓값과 상승/하락·순매수/순매도 방향을 함께 확인하며 기사 제목의 계약금액은 수치 근거로 쓰지 않습니다. 수급은 원 단위 한국어 금액(예: `20억 8,200만 원`)으로 통일합니다.

`macro.reference`는 저장된 1년 나스닥·코스피 참고 통계이며 LLM 입력에서 제외합니다. `composition`은 동일 비중(각 20%) 참고 구성·KIS 지수업종 중분류·검증된 공식 `model_only` 성과(최대 10일)와 공통 주의입니다. 업종을 확인하지 못하면 null이며 수급 근거에는 조건 통과 대신 측정한 원 단위 합계와 양수 일수를 표시합니다. 키·시간·수치·단위 검증과 정확한 응답 필드는 API 계약을 따릅니다.

업종은 실전 KIS 구성에서 조회합니다. 모의 구성이나 실전 도메인에 모의 앱키를 사용해 `EGW02004`가 발생하는 경우 `composition.sectors/sectorSource=null`을 유지합니다. 다른 KIS 시세 API의 성공만으로 업종 API 지원을 보장하지 않습니다. 서버 안전 로그의 오류 코드·메시지로 원인을 확인하고 실전/모의 키와 도메인을 함께 맞춰야 합니다.

KIS 공통 스로틀 `KIS_MAX_RPS`는 실전/모의 모두 기본 1건/초이며 한꺼번에 보낼 수 있는 토큰은 1개입니다. 공식 계좌 한도는 실전 18건/초·모의 1건/초지만 이번 환경은 5 RPS에서 한도 초과가 발생했고 1 RPS 단일 서버 실측 52회에서는 `EGW00201`이 0건이었습니다. 현재 키의 실효 안정 한도는 1건/초로 판단합니다. 공개 서비스에서는 기본값을 사용하고 실전 키의 한도를 확인한 운영자만 환경변수로 올리세요. `EGW00201`은 750ms 후 한 번만 재시도하며 설정은 공식 상한까지 제한합니다. 다른 Node 서버·Python 작업의 호출은 같은 계좌 한도를 사용하지만 이 프로세스의 스로틀에 합산되지 않습니다. 근거와 상세 동작은 [API 계약](docs/api-contract.md)을 따릅니다.

진행 중인 quote·chart·indices·종목 업종 조회는 같은 요청끼리 Promise를 공유합니다. 차트는 모든 범위를 한 번에 가져오는 기존 방식이며 quote와 같은 원시 현재가 조회도 공유합니다. 브라우저 취소는 다른 대기자의 작업을 취소하지 않습니다. GET 브리핑은 야간선물·업종의 캐시를 즉시 사용하고 만료된 값은 백그라운드 갱신합니다. cold에서는 공유된 최대 1.5초만 기다린 뒤 unavailable/null을 반환하되 수집은 계속해 다음 요청에 반영합니다. 실패·분류 누락은 60초 음성 캐시를 사용하고 성공 업종은 하루 보관합니다. POST의 전체 45초 예산은 유지합니다. 지수 스냅샷에는 기본 20초 완료 캐시가 있으며 `KIS_INDEX_SNAPSHOT_CACHE_TTL_MS`로 조정합니다.

운영 전 1 RPS 설정에서 cold·warm 홈의 요청 수와 quote·chart·indices 응답 완료 시간을 함께 측정하세요. KIS 대기열 때문에 FE 기본 15초 요청 제한보다 늦게 완료될 수 있으며, 실측 cold 지수 응답이 약 15초를 넘은 사례가 있습니다. 이 경우 무조건 제한을 높이기보다 캐시 준비·조회 범위·화면 대기 안내와 클라이언트 제한을 함께 검토해야 합니다. narrative POST의 FE 제한 60초는 별도입니다.

공통 스로틀·진행 중 Promise·Gemini 생성 동시성 및 쿨다운은 Node 프로세스/인스턴스별 메모리 상태입니다. 디스크 캐시 파일을 공유해도 인스턴스 사이의 호출 제한이나 재생성 잠금을 보장하지 않습니다. 다중 인스턴스와 Python 작업은 계좌 전체 한도를 공유하므로 운영 시 공용 제한기·분산 잠금 또는 단일 호출 담당자를 별도로 마련해야 합니다.

실전 KIS 야간선물은 현재가→분봉 두 경로에서 명시된 날짜·시각이 야간 범위일 때만 제공합니다. `KIS_NIGHT_FUTURES_MARKET_CODE`(기본 `CM`)와 `KIS_NIGHT_FUTURES_CODE`(기본 만기 규칙 계산)로 덮어쓸 수 있습니다. 공식 예제에 야간 REST 시장코드는 명시되지 않으므로 실제 환경 확인이 필요하며 확인할 수 없는 관측은 unavailable입니다.

지표 ID는 `KOSPI200_NIGHT`이며 `source="kis"`, `unit="pt"`, `session="open"|"closed"|null`을 제공합니다. 야간 범위는 KST 18:00~익일 06:00이며 자정 이후 요청·응답의 24~30시 표기를 정규화합니다. 종료봉 30:00:00까지 허용하고 미래·주간·오래된 관측은 제외합니다.

서버 환경의 `GEMINI_API_KEY`로 Gemini를 활성화하고 `GEMINI_BRIEFING_MODEL`(기본 `gemini-3.8-flash`)로 모델을 지정합니다. 키는 FE 클라이언트 환경 변수에 넣지 않습니다. 매크로 캐시는 `BRIEFING_MACRO_CACHE_TTL_MS`(기본 600000), Gemini 설명 캐시는 실행·TOP5·측정 수급·주의·기사 상태/id/제목/URL/출처 기준이며 생성 당시 매크로 스냅샷을 `outputs/briefing-narrative.json`에 원자적으로 보관합니다. 새 매크로와 다르면 `macroStale`로 표시하고 성공 후 최소 10분·실패 후 60초 간격을 적용합니다. 자세한 필드와 실패 계약은 [API 계약](docs/api-contract.md)을 따릅니다.

`narrative.macroAsOf`는 설명 생성에 사용한 매크로 기준 시각, `macroStale`은 현재 관측과 스냅샷의 값·시각·문맥이 다른지 나타냅니다. GET은 오래된 설명도 이 표시와 함께 유지합니다. Gemini는 `thinkingLevel="LOW"`, `includeThoughts=false`, 출력 최대 3072토큰, temperature 0.1이며 호출 최대 35초입니다. POST 전체 예산은 준비 조회·업종을 포함해 45초, FE 요청 제한은 60초입니다. 준비 조회는 최대 9초 후 확보한 데이터·캐시·미수집 기본값을 사용합니다.

분석에 필요한 지수 이력은 `MARKET_INDEX_SOURCE=kis`가 기본이고 `pykrx`로 기존 경로를 선택할 수 있습니다. KIS 실전 구성으로 2019-06-03부터 완료 거래일까지 수집해 루트 `outputs/market_index_history/KPI200.csv`, `KOSPI.csv`에 보관합니다. 최초 실측은 지수별 1,813행에 약 123초(재시도 포함 HTTP 109회), 즉시 재실행은 약 2.8초(HTTP 2회)였으며 이후 최근 5거래일과 신규 날짜만 갱신합니다. 캐시 손상 시 전체 수집하므로 첫 실행은 더 오래 걸릴 수 있습니다. 출처·호출 수는 같은 폴더의 `latest-request.json`과 파이프라인 로그로 확인합니다. 기존 Python 단계는 루트 `.env` 우선 동작이 남아 있고 새 지수 수집기만 외부 요청 환경을 우선하므로, 다른 수급 단계의 실전/모의 설정은 별도로 확인해야 합니다.

검증: `npm test`, `npm run typecheck`, `npm run build`. 브라우저 점검 도구는 `scripts/verify/`에 있으며 새 산출물은 루트 `outputs/ui-verification/`에 저장합니다. 과거 화면·점검 기록은 [materials](../materials/README.md)에 모았습니다.
