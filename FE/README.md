# KOSPI AI Trading Desk — Frontend

코스피 종목의 모델 예측·가격·뉴스·수급 근거를 비교하는 React 18 + TypeScript + Vite 프런트엔드입니다. 예측은 실제 성과나 수익 보장이 아니며, 공식 성과 기록 백엔드는 아직 제공되지 않습니다.

## 화면과 경로

| 경로 | 현재 화면 |
| --- | --- |
| `/` | 브리핑. `?code=005930`으로 상세 패널 선택 |
| `/rank` | 전체 예측 순위·검색·정렬·필터 |
| `/watchlist` | 브라우저에 저장한 관심 종목 |
| `/history` | 분석 상태·현재 계약 범위의 기록 안내. 공식 실행 이력/실현 성과는 미제공 |
| `/about` | 서비스 소개. 빌드 시 정적 HTML도 생성 |
| `/stock/:code` | 6자리 종목 코드의 전체 리포트 |
| `/next`, `/next/rank`, `/next/watchlist`, `/next/history`, `/next/about`, `/next/stock/:code` | 같은 새 화면의 미리보기 별칭. 내부 링크도 `/next`를 유지 |
| `/dashboard` | 브리핑 `/`로 이동. query 유지, `#market-table`은 `#candidate-heading`으로 변환 |
| `/legacy`, `/legacy/dashboard`, `/legacy/stock/:code` | 보존한 기존 랜딩·대시보드·종목 상세 |
| 그 밖의 경로 | 404 안내 |

관심 종목은 `localStorage`의 `kospi-watchlist.v1`에 저장합니다. 기본 예시 종목을 자동 등록하지 않으며 저장 실패는 현재 탭에서만 유지된다고 안내합니다.

## 웹에서 분석 실행

브리핑(`/`, `/next`)의 **새 분석 실행**에서 **모델 예측만 / 뉴스 포함**을 선택하고 **분석 시작**을 누르면 서버에 실행을 요청합니다. 선택만으로는 실행되지 않습니다. **다시 조회**는 저장된 결과 조회용입니다. 실행 상태를 확인할 수 없거나 분석이 진행 중이면 시작 버튼은 비활성화됩니다.

선택한 모드는 `POST /api/candidates/run?mode=model_only` 또는 `?mode=full`로 전달되며 이번 작업에만 적용됩니다. `PIPELINE_ANALYSIS_MODE`는 화면의 초기 기본값이며 변경되지 않습니다. 뉴스 포함은 네이버 뉴스와 Gemini 키가 필요하고 유료 API 호출이 포함됩니다. 키가 없으면 시작을 차단합니다. 모드를 생략한 기존 POST는 서버 기본값을 사용합니다. 진행 중인 작업에는 새 모드가 적용되지 않습니다. 개별 종목 뉴스 실행 API는 기존 서버 기본값 정책을 유지합니다.

- `PIPELINE_ANALYSIS_MODE=model_only`: 뉴스 호출 없이 모델 순위를 계산합니다. 완료 후 **전체 순위 보기**에서 확인하세요. 뉴스 보정 최종 후보는 생성되지 않습니다.
- `PIPELINE_ANALYSIS_MODE=full`(미설정 기본값): 뉴스 수집과 Gemini 유료 호출을 포함합니다. 실행 전 화면의 모드 설명을 확인하세요.
- 진행 중에는 서버가 제공한 진행 상태를 5초마다 확인하며 완료 후 결과를 갱신합니다. 실행 요청 오류 시 서버에서 시작됐을 수 있으므로 **실행 상태 다시 확인**으로 확인하세요. 자세한 상태는 **분석 기록 보기**에서 확인합니다.

개발 API 서버와 Python 의존성, KIS 및 해당 모드의 API 설정이 필요합니다. 환경 설정을 변경한 뒤에는 개발 서버를 재시작하세요.

## 개발·검증

저장소의 `FE` 디렉터리에서 실행합니다.

```powershell
npm install
npm run dev -- --host 127.0.0.1
# http://127.0.0.1:5173
```

```powershell
npm test
npm run typecheck
npm run build
npm run preview
```

`npm run preview`는 빌드된 정적 화면 확인용이며 Vite 개발 API 미들웨어를 제공하지 않습니다. 백엔드 연결 확인에는 개발 서버 또는 별도로 연결한 API 서버가 필요합니다.

## 데이터 연결 방식

`VITE_API_BASE_URL` 공란은 **same-origin `/api/*` 호출**입니다. 번들 mock을 기본 사용한다는 뜻이 아닙니다. 개발에서는 Vite 미들웨어가 `FE/server/` 핸들러를 제공하며 배포 환경에서는 `FE/api/` 등 실제 API 제공 경로가 필요합니다. 별도 API 서버를 사용할 때만 해당 base URL을 지정합니다.

새 화면은 `src/shared/api/`와 nullable 어댑터를 사용합니다. 후보/순위의 성공 빈 배열은 샘플로 채우지 않으며 초기 오류·이전 결과 갱신 실패·sample/cache/unknown 출처를 구분합니다. 레거시 화면에 남은 mock/fallback 동작을 새 화면의 데이터 계약으로 해석하지 마세요. HTTP 200이나 snapshot 응답만으로 실시간 시세를 뜻하지 않습니다.

| 읽기 API | 용도 |
| --- | --- |
| `GET /api/candidates` | 최종 후보 결과 배열 |
| `GET /api/rank` | 전체 모델 순위 배열. 후보 목록으로 보충하지 않음 |
| `GET /api/candidates/run` | 현재 서버 프로세스의 분석 실행 상태 |
| `GET /api/backend/status` | 읽기 전용 연결 상태: 설정 존재(검증 아님)·현재 실행·디스크 marker·결과 가용성. 키/경로/원문 오류 비노출, `no-store` |
| `GET /api/stock-analysis?ticker=005930` | 종목 분석 결과 또는 null |
| `GET /api/korean-market/quote?symbol=005930` | 개별 종목 시세 |
| `GET /api/korean-market/indices` | 시장 지수 |
| `GET /api/korean-market/stock-chart?symbol=005930&range=1D` | 관측 가격 이력. 출처/실제 제공 범위를 확인 |
| `GET /api/korean-market/dashboard` | snapshot 우선의 대시보드 자료. 없으면 KIS 조회/워밍이 발생할 수 있음 |

## 로컬 백엔드 연결 절차

1. `FE/.env.example`을 참고해 **본인의 `FE/.env.local`**에 필요한 값을 입력합니다. 키·시크릿·토큰을 대화나 보고서에 보내지 마세요. KIS 및 파이프라인 변수는 서버 전용이므로 `VITE_` 접두사를 붙이지 않습니다. `VITE_` 변수는 브라우저에 공개됩니다.
2. 사용할 KIS 환경을 `KIS_ENV=mock` 또는 `real`로 정하고 **같은 환경에서 발급한 pair**를 입력합니다. mock은 `KIS_MOCK_APP_KEY`/`KIS_MOCK_APP_SECRET`, real은 `KIS_REAL_APP_KEY`/`KIS_REAL_APP_SECRET`입니다. 모의 키와 실전 키를 섞지 않습니다. real 시세 환경 선택은 주문 실행을 뜻하지 않습니다.
3. 첫 연결 확인은 `.env.local`에 `KIS_AUTO_WARM=false`를 두고 개별 종목 조회부터 진행하는 것을 권장합니다. 코드의 미설정 기본값은 여전히 true이며, false는 전체 snapshot 자동 워밍을 끄는 옵션입니다. 개별 KIS GET 자체는 외부 호출입니다.
4. 기본 `PIPELINE_PROJECT_ROOT`는 **FE cwd의 부모**, 기본 `PIPELINE_OUTPUT_DIR`는 `<project root>/outputs`입니다. 다른 위치에 실제 결과가 있다면 올바른 절대 경로를 지정합니다. Windows에서는 `C:/path/to/project`처럼 슬래시 경로를 사용할 수 있습니다. `PIPELINE_OUTPUT_DIR`를 지정하면 marker도 그 디렉터리에서 읽으므로 결과 파일만 다른 위치로 옮겨서는 충분하지 않습니다. `PIPELINE_RESULT_PATH`는 후보 JSON/CSV override이며 전체 순위 파일이나 marker 위치를 대신하지 않습니다.
5. FE에서 `npm run dev -- --host 127.0.0.1`로 시작합니다. 환경 파일·키·경로를 바꾼 뒤에는 **개발 서버를 완전히 재시작**합니다. 브라우저 새로고침만으로 서버 설정이 갱신되지 않습니다. `VITE_` 설정을 바꿔 배포 번들에 반영하려면 재빌드도 필요합니다.
6. 먼저 후보·순위·분석 상태 GET을 확인해 서버 연결과 결과 가용성을 구분합니다. 키 설정 후 별도로 허용한 단건 quote GET으로 KIS 연결을 확인합니다. dashboard/refresh/분석 POST를 연결 점검 대신 자동 실행하지 않습니다.

키 placeholder나 실제 로컬 경로를 이 문서에 저장할 필요는 없습니다. `.env.local`은 개인 환경에서 관리합니다.

## 파이프라인 결과와 빈 응답

FE API는 기존 파일을 읽으며, 후보/순위 GET이 Python 모델이나 뉴스 분석을 실행하지 않습니다. 읽을 수 있는 결과에는 정상 실행이 기록한 `.candidate-analysis-run.json`의 `status: completed`와 실행 시작 시각에 맞는 파일 수정 시각이 필요합니다. 현재 검증은 `file mtime + 1초 >= marker.startedAt`입니다. 이는 해당 실행의 출력인지 확인하는 조건이며 오늘 시장 자료라는 보장은 아닙니다.

주요 결과 파일은 다음과 같습니다.

- `step2_all_transformer_rank.csv`: 전체 순위
- `step3_final_top5.csv`: 최종 후보
- `step3_final_news_event_analysis.json`: 뉴스 사건 근거
- `step2_final_top10.csv`: 실행 완료 검증에도 사용하는 중간 후보 결과

marker가 없거나 running/failed이거나, 파일이 없거나 해당 실행보다 오래되면 후보·순위는 빈 배열, 개별 분석은 null이 될 수 있습니다. **현재 배열/null 계약만으로 정상 분석 후 실제 0건과 입력 부재/실패 차단을 구별할 수 없습니다.** 파일 존재·marker 상태·mtime을 함께 확인해야 합니다. 상태 GET의 idle은 현재 프로세스의 메모리 상태로, 디스크의 과거 failed marker와 동시에 나타날 수 있으며 공식 실행 이력 API가 아닙니다.

marker를 수동 completed로 바꾸거나 unmarked 허용 우회로 오래된 출력을 정상 결과로 만들지 않습니다. 결과 파일의 asOf는 파일 수정 시각이며 실제 가격 관측 시각과 다릅니다. 정상 분석 산출물 확보·Python 실행은 별도 범위입니다.

## 모델 전용 실행(`model_only`)과 연결 상태 API

`PIPELINE_ANALYSIS_MODE=model_only`에서 `POST /api/candidates/run`은 `step2_all_transformer_rank.csv`(전체 순위)와 `step2_final_top10.csv`(모델 선별)만 만듭니다. 이 선별은 **뉴스 보정 최종 후보가 아닙니다.** 완료 marker는 다음이 모두 검증된 뒤에만 기록됩니다.

- 두 CSV가 이번 실행 이후에 갱신되었고 필수 열(`prediction_status`, `pred_rank`, `pred_pool_size`, `prediction_base_date`, `prediction_target` 등)이 있음
- 전체 순위에 `ok` 행이 1개 이상이고, 각 `ok` 행의 예측값이 유한하며 대상이 `next_session_open_to_close`, 기준일이 하나로 같은 유효 날짜
- 순위가 1..N으로 끊김 없이 예측값 내림차순이고 `pred_pool_size`가 N과 같음
- 모델 선별이 비어 있지 않고 같은 순위의 상위 k개이며 원본 값·기준일·모집단이 일치

하나라도 어긋나면 marker는 failed이고 `completed` 빈 결과로 보이지 않습니다. 이 모드에서 `GET /api/candidates`의 `[]`는 "최종 후보 없음"이 아니라 **미생성**이며, `GET /api/backend/status`의 `results.candidates.state`가 `not_produced`로 구분합니다. 화면은 이 상태에서 최종 후보 여부를 "미확인"으로 표시하고, 모델 예측과 원본 순위는 전체 순위(`/api/rank`)에서 보여 줍니다. 뉴스 보정 예측·순위는 `null`로 유지합니다.

`GET /api/backend/status`는 읽기 전용입니다. 키·경로·원문 오류를 반환하지 않고 외부 호출도 하지 않으며 `no-store`입니다. `configured`는 설정 존재만 뜻하고 실제 조회 성공(`verified`)이 아닙니다. 메모리의 현재 실행(`runtime`)과 디스크 marker(`marker`)는 분리되어, 과거 failed marker가 있어도 현재 실행은 idle일 수 있습니다.

## snapshot 옵션과 운영 경계

| 변수 | 코드 기본값/역할 |
| --- | --- |
| `KIS_ENV` | mock. 선택 환경에 맞는 키 pair 필요 |
| `KIS_UNIVERSE_SIZE` | 20, 인라인 조회 종목 수 |
| `KIS_SNAPSHOT_UNIVERSE_SIZE` | 200, 배치/자동 워밍 종목 수 |
| `KIS_AUTO_WARM` | true. 로컬 최초 단건 검증에는 false 권장 |
| `KIS_WITH_INVESTOR_FLOW` | true. 환경/자료에 따라 수급은 미제공일 수 있음 |
| `DASHBOARD_SNAPSHOT_TTL_MS` | 900000ms(15분). snapshot을 live로 승격하는 기준이 아님 |
| `KIS_REQUEST_DELAY_MS` | 모의 1000 / 실전 200ms |
| `KIS_STOCK_CHART_CACHE_TTL_MS` | 60000ms |
| `KIS_INTRADAY_PAGE_COUNT` | 14, 1D 분봉 페이지 수 |
| `PIPELINE_PROJECT_ROOT` | FE cwd의 부모 디렉터리 |
| `PIPELINE_OUTPUT_DIR` | `<project root>/outputs` |
| `PIPELINE_RESULT_PATH` | 후보 결과 JSON/CSV override |
| `PIPELINE_ANALYSIS_MODE` | 미설정 시 `full`(모델+뉴스+Gemini, 유료 호출). `model_only`는 모델 순위만 실행하고 뉴스 키를 자식 프로세스에서 제거하며 `--run-news`를 넘기지 않음. 그 외 값은 실행 전 거부 |
| `PYTHON_EXECUTABLE` | 파이프라인용 python 절대 경로. 미설정이면 `<root>/venv`·`.venv`, 이후 `py`/`python` |
| `SNAPSHOT_REFRESH_KEY` | POST refresh용 key 설정. `.env.example` 참고 |
| `CRON_SECRET` | cron GET refresh의 Bearer 인증 설정 |

snapshot 배치·refresh는 여러 KIS 호출을 유발할 수 있습니다. 본 연결 점검에서는 실행하지 않습니다. 공개 배포 전에는 legacy 실행 UI를 포함한 분석 POST 관리자 인증과 지속 실행 backend/결과 저장소/운영 host를 결정해야 합니다. 정적 `dist/`만 올려서는 API·Python 작업·결과 파일 공유가 제공되지 않습니다. 이번 작업에서 유료 뉴스 포함 POST, 주문, 배포는 실행하지 않았으며, 사용자 승인 하에 `model_only` 1회 실행을 성공했습니다.

## 초기 로컬 진단 기록 — 2026-10-09 (초기 관찰 기록)

아래는 2026-10-09 작업 초기의 로컬 환경 진단 기록이며, 날짜별 초기 기록으로 보존하되 현재 시점의 최종 검증 상태(이후 사용자 승인 하에 `model_only` 1회 실행 성공 및 로컬 백엔드 연결 검증 완료, `docs/REBUILD_PLAN.md` §16 참조)를 대체하거나 현재 미검증 상태로 오해해서는 안 됩니다.

- 메인 초기 확인: 후보·순위 GET은 HTTP 200/[], 분석 상태 GET은 200/idle, `stock-analysis?ticker=005930`은 200/null, `quote?symbol=005930`은 502/키 미설정.
- 루트 outputs에는 failed marker만 있고 위 주요 결과 파일이 없었습니다. CSV는 0행으로 측정된 것이 아니라 파일 부재였습니다. 실제 환경 값이나 비밀 내용은 문서에 기록하지 않았습니다.
- 메인이 fixture 없이 로컬 rank/history/stock 화면 마운트와 console/exception/blocked 0을 확인했습니다. 화면 연결 확인은 실제 금융 데이터 조회 성공이나 분석 완료를 뜻하지 않았습니다.
- 초기 진단 시점에는 실제 KIS 연결과 신규 파이프라인 실행이 미검증 상태였으며, 백엔드 연결 요청만으로 분석 POST·유료 뉴스·주문을 실행하지 않았고 배포하지 않았습니다.

## 실행 분류와 성과 수집

- 브리핑에서 모드와 **공식 성과 기록 요청**을 선택한 뒤 분석을 시작합니다. 기본은 수시 실행입니다. `POST /api/candidates/run?mode=model_only&kind=official`처럼 호출할 수도 있습니다. `mode`는 `model_only`/`full`, `kind`는 `official`/`adhoc`입니다. 뉴스 포함 모드는 기존 뉴스·LLM 호출을 실행합니다.
- 백엔드는 UUID를 발급하고 `outputs/analysis-runs/<runId>.json`에 분류, 실행 시각, 상태, 선정 종목과 예측을 저장합니다. 완료 예측은 SHA-256으로 확인하며 이후 가격 수집으로 바꾸지 않습니다. 기존 CSV는 과거 공식 실적으로 소급 등록하지 않습니다.
- 공식 집계는 **기준일·모드별 최초 완료 공식 요청**으로 제한합니다. 기준일 15:30 이후부터 목표 거래일 09:00(한국시간) 이전까지 완료돼야 합니다. 특별장 개장 시각과 무관한 고정 검증 기준입니다. 중복·시간 초과·수시 실행은 기록에 남고 공식 집계에서 제외됩니다. 모델 전용과 뉴스 포함 성과는 따로 계산합니다.
- `GET /api/performance`는 저장 기록을 읽습니다. `?symbol=005930`으로 선정 종목을 필터링할 수 있습니다. 기록 화면의 **실제 가격 수집**은 `POST /api/performance/collect`를 호출하며, 실행별 종목 상세에서 고정 예측과 KIS 원시 시가·종가를 확인합니다.
- 목표 거래일은 KIS 휴장일 달력으로 확인합니다. 현재처럼 달력 권한이 거절되는 앱키는 실제 코스피 일별 거래 기록으로 다음 거래일을 사후 확인합니다. 기준일이 응답 범위에 없거나 미래 거래일을 아직 확인할 수 없으면 추정하지 않고 이유와 대기 상태를 저장합니다. 달력은 하루 한 번 조회하고 반환 범위를 재사용합니다.
- 목표일 18:30 이후 선정 종목 전부의 정확한 날짜·양수 시가·종가·거래량을 확보해야 확정합니다. 일부 누락 시 평균에 넣지 않고 재수집합니다. 수익률은 `(종가-시가)/시가`, 선정 종목 동일 비중, 비용 차감 전 가격 성과입니다. 실제 주문 손익이 아닙니다. 공식 최근 최대 20거래일의 일평균·복리 누적·방향 적중률을 제공합니다.
- 로컬 Vite 서버는 한국시간 18시 이후 및 익일 08시 전 15분마다 미확정 기록을 수집합니다. 서버가 켜져 있어야 합니다. 중단 기간은 재시작 후 재수집합니다. 배포 환경에서는 영속 디스크를 `PIPELINE_OUTPUT_DIR`에 지정하고 외부 스케줄러로 `GET /api/performance/collect`와 `Authorization: Bearer <CRON_SECRET>`를 호출해야 합니다. 정적 파일만 배포하거나 임시 파일 시스템을 사용하는 서버리스 구성은 실행 기록 보존·예약 수집을 보장하지 않습니다.
- 수급은 조회한 일별 **외국인 순매수 금액 + 기관 순매수 금액 > 0**인 날짜 수를 `combined_positive_days`로 저장합니다. 현재 수급 조회 범위는 모델 선정 종목이며, 나머지 전체 순위는 수급 미조회 사유를 표시합니다. 개별 양수 일수를 합하거나 겹침을 추정하지 않습니다.

KIS API 요청 규격: [휴장일 조회](https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock/chk_holiday), [지수 일별 시세](https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock/inquire_daily_indexchartprice), [종목 일별 시세](https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock/inquire_daily_itemchartprice).

## 구조

```text
src/app/                 # 공통 shell·root/next 경로·라우트 포커스
src/features/            # briefing, stock, rank, watchlist, search, history, about
src/entities/            # nullable 데이터·출처·신호 판정
src/shared/api/          # same-origin fetch·Abort·TanStack Query
src/shared/lib/          # 포맷·관심 종목 저장소
src/shared/ui/           # 새 공용 UI
src/pages/, components/  # 보존한 legacy 화면/컴포넌트
src/styles/              # 새 토큰과 격리한 legacy 스타일
server/, api/            # 개발 미들웨어와 배포 API의 공통 핸들러
scripts/verify/          # localhost fixture/CDP 검증. 실 KIS 검증과 구분
```
