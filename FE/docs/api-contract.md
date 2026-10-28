# 현재 최종 모델 API 계약

## 서버·쓰기 인증

FE/vercel.json과 api/*는 지원하지 않는 배포 경로다. 단일 Node 인스턴스(npm run start)만 지원한다. 파일 기반 배포에는 시작 시 토큰 검사 보장이 없고, 프로세스 내 잠금·제한기를 공유할 수 없으며, 브리핑 API 진입점도 없습니다. 해당 파일은 보존하지만 지원 배포 대상으로 사용하지 않습니다.

`npm run build && npm run start`에 해당하는 두 명령을 순서대로 실행하면 Node 24 + tsx 운영 서버가 dist 정적 페이지와 기존 공통 API 라우터를 제공합니다. `PORT` 기본 3000, `HOST` 기본 0.0.0.0입니다. 환경은 프로세스에 주입하며 운영 서버는 dotenv를 자동으로 읽지 않습니다. 운영 서버와 Vite 개발 서버 모두 성과 수집·refresh-ahead를 기동하고 종료 시 정리합니다. 정적 preview는 API를 제공하지 않습니다.

| 요청 | 허용 자격 |
| --- | --- |
| POST `/api/candidates/run` | `Authorization: Bearer <ADMIN_API_TOKEN>` 또는 `<CRON_SECRET>`. 관리자 요청은 adhoc 강제. official은 cron만 허용. kind 생략 시 adhoc. |
| POST `/api/briefing/narrative` | 관리자 또는 cron Bearer |
| POST `/api/performance/collect` | 관리자 또는 cron Bearer |
| GET `/api/performance/collect` | 기존 cron Bearer만 허용, 수집 완료까지 대기 |
| GET `/api/korean-market/refresh` | 기존 cron Bearer 계약 유지 |
| POST `/api/korean-market/refresh` | SNAPSHOT_REFRESH_KEY 검사. `x-refresh-key` 헤더 권장, query `key`도 지원. 운영에서 키 미설정은 401. 개발 키 미설정은 아래 로컬 규칙 적용. |

관리자·cron은 서로 다른 서버 환경 토큰을 사용합니다. expected는 trim 후 고정 길이 SHA-256 해시로 상수 시간 비교합니다. 운영 서버는 빈 ADMIN_API_TOKEN·CRON_SECRET을 경고하고 해당 인증을 거부하며, 설정된 토큰이 32자 미만이거나 두 값이 같으면 시작을 거부합니다. 값은 로그에 남기지 않습니다. 미설정·불일치는 401, 관리자 official 요청은 403이며 실행 공급자를 호출하지 않습니다.

SNAPSHOT_REFRESH_KEY는 trim 후 빈 값이면 미설정으로 취급합니다. 비어 있지 않은 값이 32자 미만이면 운영 서버 시작을 거부합니다. URL 기록에 키를 남기지 않도록 query보다 `x-refresh-key` 헤더를 권장합니다.

Vite에서 관리자·cron 토큰이 모두 비어 있을 때 분석·요약·성과 POST의 로컬 예외를 허용합니다. refresh POST는 snapshot 키가 비어 있을 때 같은 로컬 규칙을 적용합니다. 실제 socket peer가 127.0.0.1/::1(IPv4 mapped loopback 포함), Host 호스트명이 localhost/127.0.0.1/[::1], x-forwarded-*·forwarded·cf-connecting-ip·cf-ray 헤더 없음이어야 합니다. Origin이 있으면 요청 scheme·Host와 동일한 origin이어야 하고, 없으면 Sec-Fetch-Site가 same-origin/none이거나 헤더가 없어야 합니다. 터널·크로스 사이트 요청은 거부합니다. 로컬 예외로 official을 만들 수 없으며 운영 서버에는 예외가 없습니다. snapshot 전체 갱신은 같은 KIS 구성·갱신 옵션의 in-flight 빌드와 저장을 공유하며 실패 후 재시도할 수 있습니다.

`/api/*`의 POST/PUT/PATCH/DELETE 등 쓰기 메서드는 토큰을 먼저 검증합니다. 유효한 admin/cron은 각각 IP와 무관한 별도 고정 60초 창 30회 버킷을 사용하고, 유효한 refresh 키·로컬 예외도 각 30회입니다. 미인증 요청은 IP별 10회이며 익명 IP 소진이 cron 버킷에 영향을 주지 않습니다. 초과 시 429 및 `Retry-After` 초를 반환합니다. IP 맵은 최대 10,000개이며 포화되면 가장 오래된 항목을 제거합니다. GET/HEAD/OPTIONS는 제외합니다. 기본 IP는 socket peer입니다. `TRUST_PROXY=N`(양의 정수)에서만 X-Forwarded-For 오른쪽 N번째 주소를 사용하며 `1`은 마지막 주소입니다. 체인이 짧거나 선택 값이 유효한 IP가 아니면 socket으로 되돌아갑니다. 신뢰 홉 수를 실제 경로와 맞추고 각 ingress가 실제 peer를 추가/덮어쓰도록 구성하며 원본 서버 직접 접근을 막아야 합니다. 창 상태와 pipelineRunner 실행 잠금은 프로세스별입니다. 같은 kind의 동시 요청만 기존 runId·kind를 HTTP 200으로 공유합니다. 다른 kind는 HTTP 409와 진행 중인 runId·kind·retry 안내를 반환하며 완료 후 요청한 kind로 재시도해야 합니다. 단일 인스턴스 배포를 전제로 합니다.

운영 CSP는 `default-src 'self'; script-src 'self' 'sha256-<시작 시 dist/index.html 테마 스크립트에서 계산한 해시>'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`입니다. API는 같은 origin으로 제공합니다. `/assets/*`는 `public, max-age=31536000, immutable`, HTML은 `no-cache`, mtime+size ETag와 If-None-Match 304를 지원합니다. 텍스트 자산은 gzip 협상과 Vary: Accept-Encoding을 지원하고 `/api`는 404 JSON입니다. 비동기 미처리 라우트 실패는 headersSent 전에 500 JSON, 이후에는 응답 종료로 처리하며 원본 예외는 공개하지 않습니다. 운영 서버는 unhandledRejection·HTTP 서버 오류를 값 없는 안전 로그로 남기며 EADDRINUSE 안내를 제공합니다.

브라우저 관리자 진입은 `?admin`이며 토큰을 현재 탭의 sessionStorage에만 저장·해제합니다. 공통 클라이언트는 POST에만 Bearer를 첨부하며 리디렉션을 따라 토큰을 보내지 않습니다. 401·403·429는 각각 토큰 재입력·수시 실행·대기 후 재시도 안내로 표시합니다. `ADMIN_API_TOKEN`/`CRON_SECRET`을 VITE_ 변수에 넣지 않습니다. `DEV_ALLOWED_HOSTS`는 쉼표로 구분한 Vite 허용 호스트 목록이며 비어 있으면 Vite 기본값을 유지합니다. 설정됐는데 관리자·cron 토큰이 모두 비어 있으면 개발 서버 시작을 거부합니다. 터널 사용 시 loopback 예외를 방지하도록 토큰을 반드시 설정합니다.

CSP의 `connect-src 'self'` 때문에 운영에서 `VITE_API_BASE_URL`로 다른 오리진을 사용할 수 없습니다. API를 같은 오리진으로 제공해야 합니다. HTTP 전달 헤더가 없는 TCP 터널(`ssh -R`)은 실제 loopback·로컬 Host 조건을 보존해 개발 로컬 예외를 통과할 수 있으므로 반드시 토큰을 설정해야 합니다.

정적 파일은 ReadStream의 open 이벤트 이후에만 `stream/promises.pipeline`을 시작해 원본·gzip 압축기·응답을 함께 종료합니다. 열기 실패는 응답을 파괴하기 전에 500 JSON과 `Cache-Control: no-store`를 반환합니다. 클라이언트 중단의 `ERR_STREAM_PREMATURE_CLOSE`는 조용히 무시하고 그 외 오류는 headersSent를 확인해 응답 가능한 경우 500 JSON과 `Cache-Control: no-store`, 전송 이후에는 응답 종료로 처리합니다. unhandledRejection 로그는 error.name·code만 기록하며 메시지는 제외합니다. 제한기의 전체 만료 순회는 요청 시 최소 1초 간격이고 요청한 IP의 만료는 전체 순회 사이에도 즉시 초기화합니다.

## 외부 공식 실행 예약

외부 스케줄러(예: Windows 작업 스케줄러)를 한국 시간 기준 장 마감 후 18:40에 실행하도록 설정합니다. 거래일·휴장일과 특별장 종료 시각은 운영자가 확인하고 일정을 조정합니다. 아래 PowerShell 예시는 프로세스에 주입된 CRON_SECRET을 Authorization 헤더로 전달하며, 409 충돌이면 30초 간격으로 최대 30분 재시도합니다. 제한을 넘기면 스케줄러에 실패를 보고해 누락을 감지하도록 합니다.

```powershell
$endpoint = 'https://service.example/api/candidates/run?mode=model_only&kind=official'
$headers = @{ Authorization = 'Bearer ' + $env:CRON_SECRET.Trim() }
$accepted = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $run = Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers
    $accepted = $true
    break
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409) {
      Start-Sleep -Seconds 30
    } else {
      throw
    }
  }
}
if (-not $accepted) { throw 'Official analysis was not accepted: retry window exhausted.' }
$run | Select-Object runId, kind, status
```

HTTP 200은 실행 접수·동일 종류 실행 공유를 뜻하며 완료 보장이 아닙니다. GET `/api/candidates/run`을 폴링해 접수한 runId와 kind=official, status=completed를 확인하고 실패·다른 runId·시간 초과를 경보로 처리합니다. HTTP 409 본문은 `{error, runId, kind, retry}`이며 runId·kind는 진행 중인 실행입니다. 수시 실행이 끝났다고 공식 기록이 자동 생성되지는 않습니다.

`GET /api/briefing`과 narrative POST는 결과 실행 메타에서 판단한 최상위 `kind: official | adhoc | unknown`을 제공합니다. 완료된 결과와 메타가 일치할 때만 분류하고, 보관된 결과는 당시 kind를 유지합니다. 확인 가능한 메타가 없으면 unknown입니다. 공개 실행 정보 영역은 adhoc일 때 ‘수시 분석 결과 · 공식 기록 아님’, unknown일 때 ‘공식 여부 확인 불가’를 표시합니다.

## 엔드포인트

- `GET /api/rank`: 최종 모델의 전체 유효 종목 순위. 실행 중·실패 시 마지막 완료 순위를 반환합니다. 보관된 완료 결과가 없거나 오래된 결과·다른 모델 결과이면 빈 배열입니다.
- `GET /api/stock-analysis?ticker=005930`: 같은 전체 순위에서 해당 종목과 관련 기사를 반환합니다.
- `GET /api/candidates`: 별도 뉴스 보정 최종 목록을 생성하지 않아 빈 배열을 반환합니다. 화면 TOP5는 원본 모델 순위 1~5위입니다.
- `POST /api/candidates/run?mode=model_only&kind=adhoc`: 관리자 Bearer 인증으로 최종 모델 추론·RSS 기사 수집·완료 전 AI 요약 생성을 시작합니다. 관리자 수동 실행은 항상 adhoc이며 official 요청은 403입니다. `kind=official`은 장 마감 후 외부 예약 작업의 CRON_SECRET Bearer 요청만 허용합니다.
- `GET /api/candidates/run`: 비동기 실행 상태·진행률.
- `GET /api/backend/status`: 읽기 전용 로컬 구성·실행·산출물 상태.
- `GET /api/briefing`: TOP5 종합 브리핑과 캐시 설명. Gemini를 호출하지 않습니다.
- `POST /api/briefing/narrative`: 별도 Gemini 설명 생성. 모델 추론·순위는 변경하지 않습니다.
- `GET /api/performance`: 저장 실행과 실제 가격 성과. 선정 종목 시가·종가가 모두 있어야 계산합니다.
- `/api/korean-market/*`: 지수·시세·차트·거래일 달력.

### 진행 중·실패 시 완료 결과 보관

서버 프로세스는 완료 마커 식별자(runId·startedAt 등), 검증된 비어 있지 않은 전체 순위(관련 기사·공개 수급 포함), ready 브리핑 페이로드(시장 지표·구성·설명 포함)를 하나의 메모리 스냅샷으로 복사합니다. 새 브리핑 조립이 끝나고 마커가 여전히 같을 때 순위와 브리핑을 함께 교체합니다. 빈 순위·오래된 CSV·검증 실패·조립 중 실행 변경은 기존 스냅샷을 덮어쓰지 않습니다. 출력 경로와 수급 공개 정책별로 분리하며 `kind`는 반환하는 결과의 공식/수시 구분을 유지합니다.

시작 응답을 반환하기 전 같은 프로세스의 활성 실행 상태를 running으로 기록해, 디스크 마커가 아직 completed여도 두 API가 즉시 `previousRun.reason="running"`을 반환합니다. Python 모델 검증과 기사 수집 뒤, 마지막 ‘AI 요약 생성’ 단계에서 새 결과로 브리핑과 설명을 비공개 조립합니다. 이 동안 디스크 마커·분석 상태는 running이고 두 API는 이전 스냅샷을 반환합니다. 요약까지 끝난 뒤 완료 원장·completed 마커를 기록하고 순위·브리핑·요약을 함께 발행한 다음 completed 상태를 노출하고 실행 잠금을 해제합니다. 조회가 없어도 완료 즉시 발행합니다. 진행률은 총 8단계이며 요약 생성은 `stage="AI 요약 생성"`, `stageIndex=7`, `stageCount=8`, `progressPercent=99`, 완료는 100입니다. 다음 Python 시작 전에는 디스크의 직전 완료 실행과 저장된 스냅샷의 식별자를 비교합니다. 같은 완료 실행일 때만 재사용하고, 다르면 메모리의 새 running 상태를 무시하고 직전 완료 파일·저장된 설명으로 새 스냅샷을 조립합니다.

실행 전 capture 및 완료 조립 실패 시 복구 capture는 시장 지표·구성 공급자를 호출하지 않으며 제한 시간은 1.5초입니다. capture 진행 중이면 이전 스냅샷이 있어도 두 API가 같은 준비 작업을 기다립니다. 실패·시간 초과에서는 이전 스냅샷으로 응답하고, 이전 스냅샷도 없으면 no_run·빈 순위를 반환합니다. 시간 초과된 작업은 늦게 끝나도 발행할 수 없습니다. 후속 조회도 같은 제한 시간을 적용해 재시도합니다. GET 조립의 하위 실패는 캐시 또는 결정적 기본값으로 처리하며, 검증 가능한 새 결과가 없으면 기존 스냅샷을 유지합니다.

자동 요약은 `BRIEFING_AUTO_NARRATIVE=0`일 때만 꺼지고 기본은 켜짐입니다. 완료 전 조립·자동 생성의 전체 예산은 30초(준비 조회 최대 9초)이며, 생성 요청은 남은 예산으로 제한하고 시간 초과 시 중단합니다. 같은 입력 해시의 유효 LLM 캐시는 매크로가 오래되어도 그대로 재사용해 추가 Gemini 호출을 하지 않습니다. 실행 잠금은 이 단계까지 유지하므로 같은 종류의 동시 실행은 기존 실행을 공유하고 다른 종류는 기존 409 계약을 따릅니다. 실행당 자동 호출은 최대 한 번이며 재시도하지 않습니다. 미설정·통신 실패·시간 초과·전체 필드 검증 실패·60초 실패 쿨다운은 template으로 발행하고 분석은 completed로 처리합니다. 부분 필드 검증 실패는 기존 부분 대체 계약을 유지합니다. 자동 생성 비활성화 시 최초 발행 설명은 template(`auto_disabled`)이며 Gemini를 호출하지 않습니다. 자동 생성 실패 사유는 고정 사유 코드만 서버 로그에 남깁니다. 수동 narrative POST와 인증·localWriteAllowed 계약은 그대로입니다.

자동 생성의 `cooldown`·`auto_disabled` 결과도 현재 `inputHash`와 함께 설명 캐시에 저장하므로, 완료 직후 GET과 서버 재시작 후 GET에서 `not_generated`로 바뀌지 않습니다. 호출을 생략한 것은 새 실패로 계산하지 않아 기존 60초 쿨다운 만료 시각을 연장하지 않습니다. 쿨다운 때문에 수동 재생성을 생략한 응답은 이전 실패 사유 대신 `fallbackReason="cooldown"`을 반환하며, 기존 실패 기록은 캐시에 유지합니다. `auto_disabled`는 화면에서 ‘자동 요약 생성이 꺼져 있습니다’라는 중립 안내입니다. 완료 전 조립은 설명 생성과 병렬로 기존 구성 공급자도 호출해 업종·성과·분산 지표를 같은 스냅샷에 포함합니다. 구성 조회 실패·전체 예산 초과 시에만 확보한 구성 캐시 또는 결정적 기본값으로 대체합니다.

`GET /api/briefing` 및 narrative POST는 보관 결과일 때 최상위 `previousRun: { reason: "running" | "failed" }`를 추가합니다. `/api/rank`는 배열 계약을 유지하고 각 행의 `data_meta.previousRun`에 같은 플래그를 붙입니다. 플래그 외의 저장된 데이터는 그대로입니다. 실행 표시줄은 ‘새 분석 진행 중 · 이전 결과 표시’ 또는 ‘새 분석 실패 · 이전 결과 표시’를 보여줍니다. 브라우저는 서버의 `no_run`을 임의로 ready로 바꾸지 않습니다.

FE 순위 어댑터는 행의 플래그를 `CandidateData.previousRun`으로 보존합니다. 실행 표시줄은 표시 중인 브리핑의 `model.finishedAt`(ISO 완료 시각), `model.elapsedMs`(밀리초), `model.poolSize`를 우선 사용합니다. 완료 시각과 소요 시간은 해당 완료 스냅샷 마커의 `finishedAt`, `finishedAt-startedAt`에서 계산하며, 과거 마커에 완료 시각이 없으면 둘 다 null입니다. 이전 결과 표시 중에는 현재 실행의 메타로 대체하지 않습니다. 이 두 메타는 설명 생성 입력·해시에 추가하지 않습니다. failed 플래그가 있으면 AI 요약 생성 버튼을 비활성화하고 분석 완료 후 재생성하도록 안내합니다.

재시작 후 완료 마커와 일치하는 디스크 결과는 첫 조회 또는 실행 전 확보 시 읽습니다. 별도 스냅샷 파일은 만들지 않습니다. 재시작 시 running·failed 마커만 있으면 덮어쓴 입력의 안전성을 보장할 수 없어 `/api/briefing`은 no_run, `/api/rank`는 빈 배열을 반환합니다. 이 서버 실행기를 거치지 않은 외부 파일 덮어쓰기는 사전 보관을 보장하지 않습니다.

`/api/backend/status`의 `localWriteAllowed`는 개발 서버이며 ADMIN_API_TOKEN과 CRON_SECRET이 모두 공백/미설정일 때만 true입니다. 값이나 개별 설정 여부는 추가 공개하지 않습니다. UI는 DEV·loopback hostname·이 boolean이 모두 참일 때만 토큰 없는 쓰기를 표시하고, 조회 전에는 허용하지 않습니다. 실제 요청은 계속 socket loopback·Host·Origin·전달 헤더를 검사합니다.

## 모델 행

`model_id=plain_20_120_rank_mean_v1`, `score_kind=rank_zscore`, `rank_score` 유한 실수, `pred_rank` 원본 순위, `pred_pool_size` 비교 종목 수, `prediction_base_date` 공통 완료 거래일을 사용합니다. `prediction_target=next_session_open_to_close`는 경제적 정답의 대상입니다. `ensemble_pred_return`는 비워 두고 `p_up`을 제공하지 않습니다.

순위 점수는 평균 0·표준편차 1로 변환한 seed별 당일 종목 순위를 6개 평균한 값입니다. 퍼센트나 양수/음수 방향 적중률로 해석하지 않습니다. 전체 CSV와 Top5 CSV의 모델·날짜·모집단·점수·순위가 일치해야 완료로 처리합니다.

RSS 기사는 모델 순위를 변경하지 않습니다. 과거 뉴스/LLM 결과 파일을 읽어 점수에 섞지 않습니다. 실패한 기사 조회는 성공한 0건 조회와 구분합니다.

신규 성과 원장은 점수 유형과 모델 ID를 고정 저장합니다. 성과 응답의 `rankScore`는 원본 점수, `actualReturn`은 실제 시가→종가 수익률입니다. 순위 모델의 `predictedReturn`과 방향 `hitRate`는 null입니다. 집계는 같은 모델·점수 유형끼리 계산합니다.

이전 뉴스 학습·보정 실행 및 `/api/stock-analysis/run` 경로는 제거했습니다. 현재 화면에서 관찰 날짜·자료 출처·실행 ID를 확인할 수 있습니다.

분석 실행의 지수 이력은 `MARKET_INDEX_SOURCE=kis`(기본) 또는 `pykrx`를 선택합니다. KIS는 실전 키가 필요하며 `FHKUP03500100`·시장 `U`·업종 `2001`(KPI200)/`0001`(KOSPI)의 2019-06-03 이후 완료 일봉을 수집합니다. 16시 이전에는 전일까지를 대상으로 합니다. 캐시는 `outputs/market_index_history/KPI200.csv`, `KOSPI.csv`이며 날짜·Close·Volume·source·수집시각을 저장합니다. 다음 실행에는 최근 5거래일과 새 날짜만 받아 정정값을 덮어쓰고, 손상된 캐시는 전체 재수집합니다. 두 지수 달력이 다르면 거부하며 임시 파일→rename으로 저장합니다. 최초 실측은 지수별 1,813행·합계 HTTP 109회(재시도 포함)·약 123초였고, 즉시 재실행은 HTTP 2회·약 2.8초였습니다. 기간·통신·재시도에 따라 시간은 달라집니다.

로그와 `outputs/market_index_history/latest-request.json`의 `market_index_source`가 실제 출처입니다. 이 메타는 현재 FE 응답 필드를 추가하지 않습니다. FE 토큰 캐시를 Python 인증에서 재사용하며 모델 파일·피처·순위 정의는 유지합니다. `pykrx`는 기존 조회 경로를 보존하며 해당 서비스의 인증·접속 환경이 필요할 수 있습니다. 기존 Python 설정은 루트 `.env`를 우선하는 동작이 남아 있습니다. 새 지수 수집기만 dotenv 적용 전 외부 요청 환경의 읽기 전용 스냅샷을 우선하므로, 나머지 수급 단계의 실전/모의 설정까지 자동으로 바꾸지는 않습니다.

## TOP5 종합 브리핑 (version 1)

날짜는 `baseDate/asOf/runStartedAt/pubDate/usSessionDate`와 결정적 문장 속 ISO 날짜에서 연·월·일만 분리합니다. 출력의 `YYYY-MM-DD`, `YYYY년 M월 D일`, `M월 D일`, `M/D`를 허용 날짜 집합과 비교하며 시·분·초·밀리초는 일반 수치 근거에서 제외합니다. 일반 수치는 숫자와 단위를 함께 검사합니다(`changePct/topPercent`는 %, `rankScore`는 단위 없음, 지표 값은 pt/KRW/%, 수급은 원). 입력에 없는 만/억/조 승수·%·%p·단위 변경과 비정상 쉼표 표기를 거부합니다. Gemini 키는 trim하고 공백 키를 미설정 처리하며 민감 출력 검사는 길이 16자 이상 키에만 적용합니다. 공급자 응답 본문은 최대 1MiB까지 읽습니다.

`KOSPI200_NIGHT`는 `name="코스피200 야간선물"`, `unit="pt"`, `source="kis"`입니다. 실전 KIS 구성에서 기존 인증·헤더로 `inquire-price`(`FHMIF10000000`)를 조회합니다. `KIS_NIGHT_FUTURES_MARKET_CODE`는 기본 `CM`이며 공식 REST 예제에 야간 구분이 명시되지 않아 실호출 확인이 필요합니다. 주간 `F` 값을 야간 값으로 간주하지 않습니다. `KIS_NIGHT_FUTURES_CODE`로 종목을 지정할 수 있고 기본값은 3·6·9·12월 둘째 목요일 만기와 만기일 오후 롤오버로 계산합니다. 현재 [공식 지수선물 마스터 정제 예제](https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/domestic_index_future_code.py)의 마스터는 `A01612`(2026년 12월), `A01703`(2027년 3월) 형식을 제공합니다.

가격은 [공식 현재가 응답 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_futureoption/inquire_price/chk_inquire_price.py)의 `output1.futs_prpr/futs_prdy_clpr/futs_prdy_vrss/futs_prdy_ctrt`만 사용합니다. 명시적인 관측 날짜·시각이 없거나 검증에 실패하면 [공식 분봉 API](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_futureoption/inquire_time_fuopchartprice/inquire_time_fuopchartprice.py) `inquire-time-fuopchartprice`(`FHKIF03020200`)를 같은 시장/종목으로 한 번 더 조회합니다. [분봉 응답 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_futureoption/inquire_time_fuopchartprice/chk_inquire_time_fuopchartprice.py)가 명시한 `output2[].stck_bsop_date/stck_cntg_hour/futs_prpr`로 야간 범위에 속하는 최신 봉의 값을 사용합니다. `futs_prdy_clpr`가 같은 응답 또는 현재가 응답에 명시돼 있을 때만 등락을 계산하며 없으면 `change/changePct=null`입니다.

KST 평일 18:00~익일 06:00(금요일 장의 토요일 새벽 포함)을 확인합니다. 자정 이후 분봉 요청은 세션 시작일과 24시간대 시각을 사용하고, 응답의 24~30시 표기를 다음 날짜로 정규화합니다. 30:00:00 종료봉은 허용하되 이를 초과하면 거부합니다. 날짜·시각이 없거나 주간·주말·미래·4일 이상 오래된 관측은 제외합니다. 거래소 임시 휴장 여부를 별도로 보증하지 않습니다. 양쪽 경로 모두 확인할 수 없으면 `unavailable`이며 키·원문 대신 고정된 내부 실패 사유만 로그에 남깁니다. 추가 호출도 매크로 TTL·동시 조회 병합의 적용을 받으며 WebSocket은 사용하지 않습니다.

`macro.reference`는 `materials/reports/macro-nasdaq-kospi/result.json`을 최초 요청에 읽어 보관합니다. `periods[name="requested"]`의 1년 구간과 `alignments.latest_prior`만 사용하며 `close_to_close`/`open_to_close`·상승/하락 조건의 4개 행에 조건부 비율·분자·분모·같은 표본의 방향별 baseline·95% 구간을 옮깁니다. `periodEnd`와 실제 자료가 있는 `lastObservedDate`는 다릅니다. 파일 손상·누락·비율 불일치는 null입니다. 과거 관측이며 예측을 보장하지 않습니다. 참고 통계와 `composition`은 Gemini 입력·수치 검증·매크로 stale 판정에서 제외합니다. 과거 비율을 예측 확률로 재해석할 위험과 검증 복잡도를 줄이기 위한 분리입니다.

`composition`은 최적화하지 않은 동일 비중 참고 구성입니다. 업종은 [공식 주식기본조회 응답 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/search_stock_info/chk_search_stock_info.py)의 `idx_bztp_mcls_cd_name`(지수업종 중분류)을 사용합니다. 표준산업 세분류보다 후보를 묶어 보기 적합한 수준으로 선택했습니다. `search-stock-info`(`CTPF1002R`, `PRDT_TYPE_CD=300`, `PDNO=<code>`)에서 종목 일치·업종명을 확인하고 성공한 분류를 한국 날짜 기준 하루 보관합니다. 분류 누락·통신·API 실패는 60초 음성 캐시를 적용한 뒤 다시 시도합니다. 하나라도 확인할 수 없으면 `sectors/sectorSource=null`이며 임의 업종표를 사용하지 않습니다.

업종 조회는 실전 KIS 구성이 필요하며 모의 구성에서는 제공하지 않습니다. 다른 KIS 조회가 성공하더라도 실전 도메인과 모의 앱키의 조합은 `EGW02004`("실전투자 도메인은 모의투자 앱키로 호출하실 수 없습니다.")로 실패할 수 있습니다. 이때 업종은 null을 유지하고 서버에는 키·토큰을 제거한 `rt_cd/msg_cd/msg1`만 진단용으로 남깁니다. 앱키와 도메인을 함께 맞춰야 하며 자동으로 다른 키나 도메인으로 재시도하지 않습니다.

KIS 시세·차트·지수·야간선물·업종 요청은 Node 프로세스 공통의 용량 1 토큰 버킷을 거칩니다. `KIS_MAX_RPS` 기본은 실전/모의 모두 1이며 양의 설정값은 0.1~실전 18/모의 1 범위로 제한합니다. [공식 유량 공지(2026-04-20 기준)](https://apiportal.koreainvestment.com/community/10000000-0000-0011-0000-000000000001/post/d0d1a83f-6f8d-4437-9700-6d26702fd989)는 계좌 단위 실전 18건/초·모의 1건/초와 동시 요청의 간격 유지를 안내합니다. 이번 환경은 실전 도메인에서도 5 RPS에서 `EGW00201`이 발생했으나 단일 서버·1 RPS의 cold 홈/warm 홈/패널 총 52회에서는 해당 오류가 0건이었습니다. 현재 키의 실효 안정 한도를 1건/초로 판단하며, 공개 서비스는 기본값을 권장합니다. 실전 키의 한도를 확인한 운영자만 환경변수로 올립니다. `EGW00201`은 공통 경로에서 750ms 후 1회 재시도하고 기존 재시도 루프에서는 추가 반복하지 않습니다. 그 코드가 없는 기존 한도 초과 메시지의 최대 5회 재시도는 유지합니다. 인증 토큰 발급은 별도 기존 캐시 경로를 유지하며, Python·다른 서버 프로세스와 계좌 전체의 유량을 합산 제어하지는 않습니다.

GET 브리핑의 야간선물·업종은 stale-while-revalidate를 사용합니다. 성공 캐시가 신선하면 즉시 사용하고, 만료됐으면 이전 값을 즉시 반환하면서 백그라운드 갱신합니다. cold 요청은 야간선물과 전체 업종 묶음에 공유된 최대 1.5초 예산만 기다리고 이후 야간선물 unavailable/업종 null을 반환합니다. 수집은 취소하지 않아 완료된 값을 다음 GET에서 읽을 수 있습니다. 백그라운드 조회도 진행 중 Promise를 공유하며 실패 후 60초간 재요청을 막고 이전 성공 값이 있으면 보존합니다. 야간선물 성공 TTL은 매크로 TTL, 업종 성공 TTL은 한국 날짜의 종료까지입니다. Yahoo 6종 캐시와 야간선물 캐시는 분리해 cold의 야간선물 unavailable이 10분간 고정되지 않게 합니다. POST narrative는 이 GET 대기 제한을 사용하지 않고 기존 45초 전체 예산을 유지합니다.

`GET /api/korean-market/indices`는 지수 묶음의 완료 결과를 기본 20초 캐시하며 `KIS_INDEX_SNAPSHOT_CACHE_TTL_MS`로 조정합니다. 캐시 반환 시 `source="cache"`, 최초 스냅샷의 `asOf`를 유지합니다. FE의 15초 staleTime 이후 재조회도 이 TTL 안에서는 KIS를 다시 호출하지 않습니다.

같은 인증·도메인의 진행 중 quote는 종목별, stock-chart는 종목·전체 범위(`ALL`)별, indices는 지수 묶음별, 업종은 종목별 Promise를 공유합니다. chart API는 모든 범위를 한 번에 반환하므로 범위 탭마다 별도 KIS 조회를 만들지 않습니다. quote와 chart의 완성 응답은 다르지만 현재가 TR·파라미터·원시 `output`은 동일하므로 그 진행 중 조회를 함께 사용합니다. 완료 캐시 TTL은 유지하며 새 quote 완료 캐시는 추가하지 않습니다. 성공·실패 후 진행 중 맵을 비우고, 브라우저 요청 취소를 공유 작업의 취소 신호로 전달하지 않습니다. 서로 다른 대기자는 복제된 결과를 받아 한 대기자의 변경이 다른 결과에 전파되지 않습니다.

구성 성과는 `performance.ts`가 이미 만든 `model_only`·동일 최종 모델의 검증된 공식 동일 비중 시가→종가 수익률만 읽습니다. 기존 `summarizePerformance`와 같은 공식 자격·완료·일별 중복 제거 기준을 적용해 최근 최대 10일을 요약합니다. 종목 수익률이나 새 포트폴리오 수익률을 계산하지 않고 기존 `actualReturn`을 %로 표시합니다. 기록이 없으면 `measuredDays=0`·평균 null이며 원장 읽기 실패는 `performance=null`입니다. 공통 주의는 기사 전부 없음·시장 지표 누락·점수 해석 등의 결정적 규칙으로 생성합니다.

두 브리핑 API는 아래와 같은 전체 객체를 HTTP 200으로 반환합니다. `GET /api/briefing`은 GET만, `/api/briefing/narrative`는 POST만 허용하며 다른 메서드는 405입니다. 응답은 `Cache-Control: no-store`, `X-Data-Source`, `X-Data-As-Of`를 제공합니다. 파일 기반 실행 결과를 포함하므로 `data_meta.source`는 `cache`입니다. Node/Vite의 공용 라우트 맵에서 제공하며 정적 preview에서는 실행되지 않습니다.

```typescript
type Briefing = {
  version: 1;
  status: "ready" | "no_run";
  kind: "official" | "adhoc" | "unknown";
  previousRun?: { reason: "running" | "failed" };
  model: {
    modelId: string; scoreKind: "rank_zscore"; baseDate: string;
    predictionTarget: "next_session_open_to_close"; poolSize: number;
    runStartedAt: string | null;
    finishedAt: string | null; elapsedMs: number | null;
  } | null;
  macro: {
    asOf: string | null;
    indicators: {
      id: "KOSPI" | "KOSDAQ" | "NASDAQ" | "SP500" | "USDKRW" | "UST10Y" | "KOSPI200_NIGHT";
      name: string; value: number | null; change: number | null;
      changePct: number | null; unit: "pt" | "KRW" | "%";
      asOf: string | null; source: "yahoo" | "kis"; status: "ok" | "unavailable";
      session?: "closed" | "open" | null;
    }[];
    context?: { usSessionDate: string | null; targetSessionNote: string };
    reference: {
      title: "직전 미국장(나스닥) 방향과 코스피";
      periodStart: string; periodEnd: string; lastObservedDate: string;
      rows: {
        definition: "close_to_close" | "open_to_close"; label: string;
        condition: "nasdaq_up" | "nasdaq_down"; ratioPct: number;
        count: number; total: number; baselinePct: number;
        ciLowPct: number | null; ciHighPct: number | null;
      }[];
      note: string; source: "Yahoo Finance 일봉, 팀 재검증(2026-10-23)";
    } | null;
  };
  stocks: {
    rank: number; code: string; name: string; rankScore: number;
    poolSize: number; topPercent: number;
    evidence: { id: string; kind: "model" | "supply" | "news"; text: string }[];
    cautions: { id: string; kind: "model" | "supply" | "news" | "macro" | "data"; text: string }[];
    news: {
      status: "collected" | "collection_failed" | "not_collected";
      articles: { id: string; title: string; url: string; source: string; pubDate: string | null }[];
    };
  }[];
  narrative: {
    status: "llm" | "template"; generatedAt: string; llmModel: string | null;
    inputHash: string; fallbackReason: string | null;
    overview: string; marketNote: string;
    stocks: { code: string; summary: string; citations: string[]; source?: "llm" | "template" }[];
    fieldSources?: { overview: "llm" | "template"; marketNote: "llm" | "template" };
    citations: string[]; macroAsOf?: string | null; macroStale?: boolean;
  };
  disclaimer: string;
  composition: {
    basis: "equal_weight_reference";
    note: "최적화하지 않은 동일 비중(각 20%) 참고 구성입니다. 투자 권유가 아닙니다.";
    sectors: { name: string; codes: string[] }[] | null;
    sectorSource: string | null;
    performance: {
      asOf: string | null; measuredDays: number; averageReturnPct: number | null;
      positiveDays: number; recent: { date: string; returnPct: number }[];
    } | null;
    commonCautions: string[];
  };
  data_meta: { source: "live" | "cache" | "sample"; asOf: string | null };
};
```

유효한 `completed`·`model_only` 실행과 일관된 원본 순위가 없으면 `status="no_run"`, `model=null`, `stocks=[]`입니다. 단, running·failed 상태에서 보관된 마지막 완료 브리핑이 있으면 페이로드 전체를 `previousRun` 플래그와 함께 반환합니다. 현재 실행의 부분 파일과 보관된 결과를 조합하지 않습니다. 기존 `validateModelRows`를 재사용하며 요청 환경을 순위 파일·마커·수급 조회에 전달합니다. `stocks`는 원본 `pred_rank` 순서의 최대 5개이며 `topPercent=rank/poolSize*100`입니다. 근거·주의는 서버의 결정적 규칙으로 생성합니다. 수급 공개를 활성화한 경우에만 측정된 기간·원 단위 순매수 합계·양수 일수만 설명하고 조건 통과/미통과로 표현하지 않습니다. 원 단위는 `integrated_pipeline.py`의 `_kis_million_to_won` 변환을 따릅니다. 기사 실패·성공 0건·미수집을 구분하며 종목당 최대 3건을 제공합니다.

매크로는 Yahoo chart v8의 `^KS11`, `^KQ11`, `^IXIC`, `^GSPC`, `KRW=X`, `^TNX`를 사용합니다. `value=regularMarketPrice`, `change=value-(chartPreviousClose ?? previousClose)`, `changePct=change/previousClose*100`이며 `^TNX` 값은 추가 배율 없이 `%`입니다. 개별 `asOf`는 `regularMarketTime`의 UTC ISO 문자열이며 서버 수집 시각과 다릅니다. `macro.asOf`는 확보한 관측 시각 중 가장 이른 시각입니다. 지표별 8초 제한(본문 포함)과 실패 격리를 적용하고 실패한 값·등락·시각은 null입니다. 기본 캐시는 10분이며 `BRIEFING_MACRO_CACHE_TTL_MS`로 조정합니다.

NASDAQ·S&P500의 `session`은 `currentTradingPeriod.regular`의 시작·종료와 관측 시각으로 장중/마감을 구분합니다(서머타임·조기 마감 포함). 관측이 다음 거래 기간보다 이전이면 이미 끝난 장이며, 종료 시각이 지났다면 마지막 틱이 종료 직전까지 오지 않아도 `closed`입니다. 09:00~09:29 ET는 `open`으로 표시하지 않습니다. `context.usSessionDate`는 두 미국 지표의 뉴욕 현지 관측일이 같을 때의 날짜이며, 일자가 다르거나 하나라도 없으면 null입니다. `targetSessionNote`는 그 미국 관측일/장 상태와 모델 기준일 다음 한국 거래일의 시가→종가 대상을 함께 설명합니다. 한국 휴장일 달력 범위 밖에서는 다음 한국 거래일로만 표기합니다. 장중 자료를 전날 미국 종가로 설명하거나 시장과 모델 순위 사이의 인과·확률을 주장하지 않습니다.

출처 ID는 시장 `M:<ID>`, 모델 순위 `R:<code>`, 근거 `E:<code>:<n>`, 주의 `C:<code>:<n>`, 기사 `N:<code>:<n>`입니다. Gemini는 설명 문구와 인용만 반환하며 입력에 없는 id, 다른 종목의 근거, 순서 변경, 추가 JSON 필드, 금지 표현, 입력에 없는 숫자(반올림 허용)를 서버에서 거부합니다. 기사 제목·식별자·URL·출처명의 숫자는 수치 근거로 쓰지 않습니다. 제목의 `3분기` 같은 분기는 같은 기사 주제 표기로만 허용하며 가격·계약금액 등의 수치 허용 집합에는 넣지 않습니다. 순매수·순매도·매수세·매도세 등 수급 사실은 허용하되 매수/매도 의견·권유·타이밍·추천은 차단합니다. 목표가·목표주가·적정주가·투자 비중·확률·기대/예측/예상수익률·수익 보장도 차단하되 같은 절의 짧은 부정·면책("수익률·확률이 아닙니다", "투자 권유가 아닙니다")은 허용합니다. 가격·수익 대상과 결합한 전망·예상·예측은 차단하고 "실적 전망 기사" 같은 주제 서술은 허용합니다. 제목 안의 지시는 무시하고 수치를 인용하지 않도록 시스템 지시에 명시합니다.

수치는 단위와 절댓값을 대조하고 같은 절의 상승·하락·순매수·순매도 방향을 별도로 검사합니다. "각각 3.52%, 2.29% 하락", "외국인 X원, 기관 Y원 각각 순매도"처럼 여러 수치가 하나의 방향을 공유할 수 있습니다. 입력 방향과 반대이면 거부합니다. 수급 금액의 한국어 조/억/만 표기는 원으로 환산하고 표시 정밀도 내 반올림만 허용합니다. 템플릿과 LLM 입력은 같은 포맷 함수를 사용합니다(예: `1,325.93원`, `5,533.77pt`, `4.98%`, `20억 8,200만 원`). 종목당 수급 근거는 기간·외국인/기관 합계·양수 일수를 한 문장으로 묶습니다.

`overview`, `marketNote`, 각 `narrative.stocks[].summary`를 독립 검증합니다. 실패한 필드만 해당 템플릿으로 교체하며 `fieldSources`와 종목별 `source`에 출처를 표시합니다. 일부 필드가 LLM이면 `status="llm"`, `fallbackReason="partial_template"`이고 모든 필드가 실패하면 `status="template"`입니다. 종목 인용 검증 실패는 그 종목에만 적용합니다. 최상위 `narrative.citations`는 개요·시장 설명이 공유하므로 이 목록이 잘못되면 두 필드만 대체하고 정상 종목 설명은 유지합니다. 각 실패의 필드명·고정 사유·비밀을 제거한 문장 일부는 서버 로그에 남깁니다. 디스크 캐시를 읽을 때도 LLM 필드는 검증하고 템플릿 필드는 결정적 템플릿과 일치하는지 확인합니다.

`GEMINI_API_KEY`는 Node 서버 환경에서만 읽고 REST 헤더로 전송합니다. 브라우저 응답·로그·에러에 넣지 않으며 SDK를 추가하지 않습니다. 기본 모델은 [공식 안정 모델 문서](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)에서 확인한 `gemini-3.8-flash`이며 `GEMINI_BRIEFING_MODEL`로 바꿀 수 있습니다. `responseMimeType=application/json`, `responseSchema`, `temperature=0.1`, `thinkingConfig.thinkingLevel="LOW"`, `includeThoughts=false`, `maxOutputTokens=3072`를 사용합니다. Gemini 호출은 최대 35초, POST 전체는 준비 조회·업종·설명 생성을 합쳐 45초 예산이며 준비 조회에는 최대 9초를 배정합니다. 예산이 부족하면 이미 확보한 값·이전 캐시·미수집 기본값으로 진행합니다. FE 클라이언트의 설명 POST 제한은 60초입니다.

`inputHash`는 실행(`runStartedAt`/`baseDate` 포함 모델 메타), TOP5 구성·점수·공개한 수급을 포함한 근거/주의 문장과 기사 수집 상태·id·제목·URL·출처로 계산하며 매크로는 제외합니다. 제목은 NFKC·공백, URL은 호스트·기본 포트·쿼리 순서를 정규화하고 fragment는 제외합니다. 같은 순번 id의 기사 내용이 바뀌면 설명 캐시는 무효화됩니다. 생성 입력 전체(매크로 값·시각·context 포함)를 `outputs/briefing-narrative.json`에 설명과 함께 임시 파일→rename 방식으로 저장합니다. 캐시 검증은 저장된 매크로 스냅샷을 기준으로 합니다. `macroAsOf`는 설명 생성에 쓴 기준 시각이며 현재 매크로 값·시각·context가 달라지면 `macroStale=true`입니다. GET은 이 표시와 함께 기존 LLM 설명을 유지합니다. POST도 동일 입력의 설명을 재사용하며, 매크로가 달라졌고 마지막 성공 후 10분 이상 지난 때만 갱신합니다. 매크로 갱신마다 설명이 사라지거나 생성 요청이 반복되는 현상을 줄이기 위한 정책입니다.

동시 생성은 서버 프로세스당 1건입니다. 같은 실행의 동시 요청은 진행 중 결과를 공유하며 다른 실행은 `generation_in_progress` 템플릿을 받습니다. 실패 후 60초 쿨다운은 다른 hash에도 적용하고 최근 실패는 디스크에도 보관합니다. 이전 성공이 없다면 키 없음·통신 오류·전체 필드 검증 실패는 `status="template"`와 `fallbackReason`으로 HTTP 200을 반환합니다. 일부 필드 검증 실패는 위의 부분 대체 계약을 따릅니다. 갱신 전체 실패 전에 검증된 LLM 설명이 있으면 GET·POST 모두 이전 설명을 유지하고 `status="llm"`, `macroStale=true`, 실패 사유를 `fallbackReason`으로 제공합니다. 성공하거나 현재 매크로가 성공 스냅샷과 다시 일치하면 갱신 실패 사유는 지웁니다. 다만 부분 대체된 설명의 `partial_template`은 유지합니다. 디스크의 template 실패 사유도 고정 허용 목록으로 검증합니다. 읽기 전용 배포에서 파일 저장이 실패하면 해당 프로세스의 메모리 캐시로 동작합니다.

### 수급 공개 정책·시연 표시

서버 환경 `BRIEFING_SHOW_SUPPLY`는 기본 false이며 `true` 또는 `1`일 때만 수급 측정값을 공개합니다. false에서는 `/api/rank`, `/api/stock-analysis`의 `input_row`에서 `supply_*`, `foreign_*`, `inst_*`, `institution_*`, `combined_*` 필드를 생략합니다(null이나 0으로 대체하지 않음). 관련 CSV 수급 설명도 생성하지 않습니다. `/api/briefing`은 `kind="supply"` 근거·주의, 수급 금액·일수를 만들지 않습니다. Gemini 입력과 템플릿에도 포함하지 않고, 수급 근거 없이 작성한 외국인/기관 순매수·순매도 주장은 다른 지표의 같은 숫자로 정당화할 수 없습니다.

`inputHash`에는 공개 정책 버전이 포함됩니다. 기본 비공개 상태에서는 원본 수급 값이 바뀌어도 해시에 영향을 주지 않으며, 공개/비공개 전환으로 실제 근거가 달라지면 해시도 바뀝니다. 정책 도입 이전 및 수급 문장을 포함한 기존 설명 캐시는 재사용하지 않습니다. 브라우저에 별도의 수급 공개 플래그를 전달하지 않으며, 서버가 제공한 근거만 표시합니다. 파이프라인 원본 CSV·모델 순위·성과 정의는 변경하지 않습니다.

`macro.indicators[].status`, `composition.sectors=null`, `fieldSources`, `stocks[].source`, `fallbackReason`은 원래 계약을 유지합니다. 화면은 unavailable 지표 카드를 생략하고 모두 unavailable일 때만 안내하며, 업종 null 영역과 표시할 값이 없는 통계 행을 생략합니다. 부분 대체는 필드별 ‘자동 생성’으로 표시하며 정상 상태에서 경고로 표현하지 않습니다. 순위 표의 기사 열은 TOP5 수집 범위임을 밝히고 TOP5 밖 행은 비웁니다. `VITE_DEMO_HIDE_RUN=1`은 헤더 버튼만 숨기는 빌드/기동 옵션이며 서버 분석 POST 권한·동작을 바꾸지 않습니다.

### 표시 단위·정밀도와 예측 대상 세션

LLM에는 시장 수치를 소수 2자리까지 반올림한 숫자와 `display` 문자열로 제공합니다. 환율은 원, 지수는 pt, 금리는 %(소수 2자리)로 표시합니다. 응답의 영문 통화 코드 KRW/USD와 공개된 입력보다 정밀한 소수 자릿수는 `ungrounded_number`로 거부하며 해당 필드만 자동 생성 문장으로 대체합니다. 기존 저장 설명도 같은 규칙으로 필드별 재검증해 다른 검증 통과 문장을 유지합니다. 이 재검증은 Gemini를 호출하지 않습니다. API의 원본 매크로 숫자·관측 시각과 캐시 스냅샷은 보존합니다.

시세 캐시와 갱신: 현재가 장중 25000ms, 지수 20000ms, 차트 분봉/전체 묶음은 60000ms입니다. `KIS_INDEX_SNAPSHOT_CACHE_TTL_MS`·`KIS_STOCK_CHART_CACHE_TTL_MS`는 각각 장중 지수·묶음 간격을 덮어씁니다. 장중 값은 마감 때 다시 갱신하며 장후·휴장일의 성공값은 다음 장 시작까지 유지합니다. 14일 보관 상한 안의 오래된 성공값은 즉시 반환하고 백그라운드 갱신하며 갱신 실패에도 보존합니다. 캐시 응답은 `X-Data-Source: cache` 및 payload `source: cache`이고 `asOf`/`X-Data-As-Of`는 원래 성공 수집 시각을 유지합니다. 캐시 적중·실패·응답 시각으로 `asOf`를 새로 만들지 않습니다. 여러 기간을 재사용한 차트의 최상위 `asOf`는 포함된 수집 시각 중 가장 오래된 값이며, 실제 관측일·범위는 각 기간 원본 시각과 coverage를 읽습니다. 캐시라는 사실은 실시간 또는 데이터 완전성을 뜻하지 않습니다.

차트 API는 종전처럼 모든 기간을 한 묶음으로 반환합니다. 3M·1Y는 일봉, 5Y는 월봉이며 이 기간 원본은 다음 거래일 마감까지 메모리/파일에서 재사용합니다. 파일은 `FE/server/cache/market-v1/`의 공개 시세 JSON(해시로 구분한 환경/종목/기간)이며 원자적으로 저장하고 형식이 손상되면 재수집합니다. 서버 재시작 후 전체 묶음 파일을 먼저 반환하므로 장중 만료 시에도 새 KIS 수집을 기다리지 않습니다. 후속 일봉 수집은 마지막 날짜 이후와 최근 14일(월봉 62일)을 다시 받습니다. 여러 페이지를 연결해 1Y의 KIS 100행 제한을 보완하며, 후속 분봉은 최근 한 페이지와 같은 거래일의 기존 원본을 합칩니다. 실패한 기간은 이전 원본·시각을 보존합니다.

`REFRESH_AHEAD=0`을 제외한 Node 운영 서버와 Vite 개발 서버는 시작 시 최신 모델 TOP5 현재가·차트와 3개 지수를 예열합니다. 장중 현재가·지수 30초, 분봉 60초이며 마감 직후 한 번 갱신 후 다음 장까지 대기합니다. 빌드·테스트·preview에서는 스케줄러를 시작하지 않습니다. 공용 KIS 기본 1 RPS 안에서 사용자 대기열이 먼저 처리되고 백그라운드는 최대 30회/분입니다. 초기 수집·미보유 종목 조회는 네트워크 지연이 남습니다. 브리핑 매크로/야간선물/업종 계약은 변경하지 않습니다. 클라이언트는 30분 보관·현재가/지수 20초·분봉 60초·일봉 탭 10분의 staleTime을 사용하고 기존 값을 유지하면서 갱신합니다. 현재가·지수·차트 요청 제한은 75000ms입니다.

서버 내부 `getDailyHistory(code, { start?, end?, allowNetwork? })`는 `{ code, rows: [{ date, open, high, low, close, volume }], source, asOf, complete, missingDates, calendarSource } | null`을 반환합니다. `date`는 KST 거래일 오름차순, 가격은 원, 거래량 결측은 null이며 raw OHLC가 검증되지 않으면 해당 행을 제외합니다. 대상은 1Y 실제 일봉(최대 390달력일)입니다. 기본은 캐시만 읽고 없으면 null이며 `allowNetwork:true`도 백그라운드 호출만 허용합니다. start 기본은 최근 365일, end 기본은 현재 미완성 일봉 제외입니다. `pipelineProjectRoot()` 아래 `outputs/market_index_history/KOSPI.csv`의 유효한 `source=kis` 날짜를 거래일 참조로 우선 사용하고, 파일 미보유·손상 또는 끝 이후는 지원되는 내장 KRX 달력으로 보완합니다. 달력을 확인한 범위의 모든 거래일이 종목 원본에 있을 때만 `complete:true`입니다. 상장 전·거래정지·누락을 임의 구분하지 않고 `missingDates`에 남깁니다. `calendarSource`는 `kis-index-cache` 또는 `krx-table`입니다.

홈은 기존 `/api/korean-market/next-session`의 KIS/KRX 달력 결과로 대상 거래일을 확인합니다. 현재 KST가 그 거래일 15:30 이후이면 ‘예측 대상 정규장은 종료되었으며 다음 거래일 순위는 새 분석 후 표시된다’는 중립 안내와 실행 안내 링크를 제공합니다. 이전·장중에는 숨기고, 달력에서 날짜를 확인하지 못하면 추측하지 않습니다. 페이지를 열어 둔 상태에서도 종료 경계에 안내를 갱신합니다. 브리핑 JSON 필드는 추가하지 않습니다.

## 근거 투명형 리포트 (추가 계약)

`GET /api/stock-insight?code=042660`은 기존 종목 분석 계약을 바꾸지 않는 읽기 전용 엔드포인트입니다. 잘못된 6자리 코드는 400, GET 이외 메서드는 405입니다. 분석 실행·Gemini 호출·KIS 일봉 수집을 시작하지 않습니다. 기본 구조는 `version:1, code, name, status:ready|no_model, baseDate, model, sensitivity, news, cautions, data_meta`입니다. 구체 타입은 `src/types/stockInsight.ts`, `src/types/modelEvidence.ts`를 따릅니다. 과거 실행과 캐시가 없는 종목도 값·순위·통계를 지어내지 않습니다.

STEP2 CSV에는 다음 열이 선택적으로 추가됩니다. 기존 `rank_score`와 `pred_rank` 계산·정렬은 그대로입니다. 동결된 6모델을 한 번 추론할 때 `return_raw=True`로 받은 출력만 후처리하며 재학습·모델 파일·입력 피처 변경은 없습니다.

- `score_lb20`, `score_lb120`: 각 lookback의 3시드 원시 출력을 유니버스 전체에서 각각 rank-zscore로 바꾸고 평균한 값입니다. 최종 점수는 기존과 같이 6개 rank-zscore 전체의 평균이며 lookback 평균을 다시 평균해 부동소수 연산 순서를 바꾸지 않습니다.
- `rank_lb20`, `rank_lb120`: 해당 점수 내림차순, 동점이면 종목코드 오름차순의 1..N 순위입니다.
- `model_agreement`: 두 순위 차이/N이 0.10 이하면 `일치`, 0.25 이하면 `부분 일치`, 그 밖은 `불일치`입니다. 동일 순위나 모델 성능의 보장을 뜻하지 않습니다.
- `feat_pct_f_open/high/low/close/volume/rsi/macd/macd_signal/pct_b/norm_bw/rel_bw`: 정확한 열 이름은 각 피처 앞에 `feat_pct_`를 붙입니다(예: `feat_pct_f_close`). 마지막 날짜의 **실제 float32 입력**을 유니버스 안에서 오름차순 평균 순위/N×100으로 표현한 백분위입니다. 원값은 응답에 싣지 않습니다. 필수값은 유한수, 백분위 범위는 (0,100]입니다. 기간별 근거 묶음이 있으면 두 순위·점수·일치도가 모두 유효해야 하며 기존 CSV의 열 부재는 허용합니다.

실제 11개 입력은 전일 종가 대비 당일 OHLC의 로그 비율(4개), log1p 거래량의 과거 60일 평균·표준편차 대비 z값, RSI14/100, MACD/종가·신호선/종가, Bollinger 밴드 내 종가 위치·평균 대비 밴드 폭·종가 대비 밴드 폭입니다. 5일·20일 누적 수익률은 이 모델의 종목 입력이 아니므로 추가하지 않습니다. 백분위가 50 이상이면 상위 꼬리 `(N+1)/N×100−백분위`, 그 미만이면 하위 꼬리 `백분위`로 표기하며 꼬리가 작은 순서의 최대 3개를 제공합니다. 같은 값은 평균 순위입니다. 이는 **특징의 상대적 위치이며 모델 기여도·인과적 설명이 아닙니다**. OHLC·밴드 피처끼리 겹칠 수 있습니다.

`model`은 전체 순위·모집단·상위 비율·순위 점수, `lookbacks[{sessions,rank,score}]`, `agreement`, `features[{key,label,percentile,side,tailPercent,text}]`, `note`를 제공합니다. 브리핑 `stocks[].modelEvidence`도 같은 선택 필드입니다. 과거 결과는 기간별 근거와 특징이 비어 있고 새 분석 후 추가됩니다.

`sensitivity`는 `status:ready|preparing`, `samples`, `periodStart/periodEnd`, `metrics[{definition,correlation,beta,samples}]`, `conditional`, `complete`, `source`, `note`와 선택 필드 `asOf`(종목 일봉 수집 시각)입니다. 종목 KIS 1년 일봉 캐시를 읽으며 Yahoo 나스닥 일봉은 처음에 백그라운드로 준비하고 하루 재사용합니다(실패 후 60초 대기). KIS를 기다리거나 추가 호출하지 않습니다. 자료가 도착하면 응답의 자료 지문이 바뀌므로 준비 중 상태를 하루 고정하지 않습니다. 결과는 자료 지문이 같은 경우 하루 캐시합니다.

정렬은 `scripts/analysis/nasdaq_kospi_conditional.py`의 `latest_prior`, 즉 한국 거래일 D보다 **엄격히 이전**인 가장 최근 미국 거래일 U입니다. 같은 날짜 미국장이나 미래 가격을 연결하지 않습니다. 휴장 차이로 U가 재사용될 수 있습니다. 최근 365달력일의 유효 쌍이 200개 이상일 때 두 수익 구간(종가→종가·시가→종가)의 Pearson 상관계수와 `Cov(미국 수익률, 종목 수익률)/Var(미국 수익률)` 베타를 표시합니다. 상수·비정상 시계열에는 값을 만들지 않습니다. `conditional`은 나스닥 상승 표본이 30개 이상일 때 종목 시가→종가 상승 `count/total·ratioPct`와 **동일 유효 표본**의 `baselineCount/baselineTotal·baselinePct`를 제공합니다. 0 수익률은 상승에 포함하지 않습니다. 명시된 결측 거래일은 빈 가격으로 유지하고 그 다음 날 종가 수익률도 제외합니다. `complete:false`라도 유효 표본이 충분하면 표본 수·누락 한계를 함께 표시합니다.

`news.summary`는 `narrative.newsSummaries`의 해당 종목 항목만 사용합니다. `source:"llm"`이며 현재 기사 N: 인용·숫자·문장 검증(`selectHeadlineSummary`)을 다시 통과할 때만 채택하고, 아니면 기사 수를 기술하는 규칙 문장으로 대체합니다. 종목 분석용 `narrative.stocks[].summary`는 뉴스 요약으로 사용하지 않습니다. `source:"llm"|"template"`, 선택 필드 `summarySource?:"llm"|"template"`, `summaryBasis?:"body"|"title"`, `summary`, `articles`, 기사 id인 `citations`, `bodyCollected:boolean`, `limitation`을 제공합니다. `summaryBasis`는 채택된 요약이 실제 본문을 사용했는지를 뜻하고, `bodyCollected`는 현재 기사 중 내부 캐시에 본문이 확보된 기사가 있는지를 뜻합니다. 신형 서버는 source/summarySource를 같은 값으로 제공합니다. 화면은 ‘AI 요약’/‘규칙 기반 기본 안내’와 ‘기사 본문 기반 요약’/‘기사 제목 기반 요약’을 독립적으로 표시합니다. 구형 응답의 두 선택 필드 누락은 허용하며 제목 기반으로 표시합니다. 본문 자체나 bodyText/resolvedUrl/articleBodies는 API 응답에 포함하지 않습니다. 민감도·성과·상관행렬은 종목 의견의 숫자 허용 집합에 추가하지 않습니다.

뉴스 요약에 한해 구형 캐시 버전·입력 해시와 독립적으로 읽기 전용 복구를 허용합니다. 현재 종목의 기사 목록과 저장 입력의 id·제목·URL·출처·발행일·수집 상태가 일치하고, 저장된 `source:"llm"` 요약이 현행 문장·인용·숫자 검증을 통과해야 합니다. 제목 공백/NFKC 및 URL 쿼리 순서/fragment만 정규화합니다. 동일 N: id라도 내용이 바뀌면 복구하지 않습니다. 브리핑 GET과 종목 인사이트가 같은 복구·검증 함수를 사용하며, 브리핑 화면은 `narrative.newsSummaries`를 표시합니다. 복구는 파일을 쓰거나 외부 호출을 하지 않으며 종합 설명 캐시를 새 정책의 성공 캐시로 승격하지 않습니다. 따라서 다음 허용된 종합 생성은 그대로 실행합니다. 브리핑의 기존 실행 보관 스냅샷은 발행 당시 내용이며, 종목 인사이트는 제공 직전에도 재검증합니다.

브리핑 `composition.diversification`은 선택 필드이며 `status`, `codes`, `samples`, `periodStart/periodEnd`, `matrix`, `averageCorrelation`, `highestPair:{codes,correlation}|null`, `nasdaqBetas[{code,closeToClose,openToClose,samples}]`, `commonRisks`, `note`를 제공합니다. 최근 60거래일 중 다섯 종목이 **같은 직전 거래일을 가진 공통 관측** 55개 이상일 때 종가 일수익률 상관행렬을 표시합니다. 평균은 대각선 제외 10쌍의 단순 평균입니다. 최고 상관 쌍이 0.8 이상이면 공통 위험으로 기술하며 업종 중복은 검증된 업종 분류가 있을 때만 기술합니다. 표본 부족 시 수치 대신 준비 중을 표시합니다. 기존 동일 비중 참고·공식 성과 정의는 변경하지 않습니다.

설명 `inputHash`는 시장 확보 상태에 의존하는 `kind:macro` 주의를 제외하고 종목별 주의의 kind·문장만 포함합니다. 시장 상태는 생성 당시 매크로 스냅샷과 `macroStale`로 처리합니다. 해시가 현재 정책과 일치하는 디스크 캐시만 재사용하며 주의 인용 id는 현재 같은 사실에 맞춰 연결합니다. 따라서 야간선물 unavailable→ok 전환만으로 AI 설명을 버리지 않습니다.

두 가격 차트는 같은 인라인 SVG를 사용합니다. Y축 원 단위 nice tick, 기간별 X축 시각/날짜, 마지막 관측 가격, 기간 시작가 점선·등락률, 최고·최저 관측, 포인터 탐색·좌우 키·스텝 버튼·aria-live를 제공합니다. 형식에 전일 종가가 없으므로 기준선은 일관되게 **기간 시작 관측가**입니다. 마지막 관측을 실시간 현재가로 단정하지 않습니다. 캔들에서도 같은 축을 쓰며 캔들·선의 결측을 보간하지 않습니다.


### 캐시 보관과 설명 검증 보완

설명 디스크 캐시의 선택 필드 `rawFields`는 필드별 원문·인용·복원 또는 응답 출처를 보관하며 `rawModel`은 원 응답 모델입니다. HTTP 응답에는 노출하지 않습니다. 원문을 읽을 때도 같은 입력 사실과 현재 스키마·인용·수치·금지 표현 검증을 적용합니다. 통과한 필드는 `llm`, 실패 필드는 `template`이며 전부 통과하면 `fallbackReason=null`입니다. 원문이 없는 과거 캐시는 기존 검증 동작을 유지합니다. 재검증 결과는 프로세스 메모리에서 입력 해시·검증 규칙 버전별로 재사용하며, 생성/캐시 갱신 시 폐기합니다. 규칙이 강화되면 이전 AI 문장도 자동 생성으로 대체됩니다. 입력 해시·생성 시각은 재검증 때문에 바꾸지 않고 Gemini도 호출하지 않습니다.

종목 통계 캐시의 지문은 일봉·결측 거래일·기간 시작/끝·수집 시각·나스닥 자료의 SHA-256이며, 이력 없는 종목은 저장하지 않고 LRU 최대 300개를 유지합니다. `sensitivity.asOf`는 해당 일봉 캐시의 원래 수집 시각인 선택 필드입니다. 시장 파일·메모리 캐시는 기본 14일을 초과하면 무시하고 기존 수집 경로로 다시 받습니다. 만료 파일 자체를 삭제하지는 않습니다. 화면의 지난 관측 태그는 장중 30분 초과, 장후·휴장·개장 전에는 가장 최근 완료 KRX 거래일 15:30 이전의 `asOf`에 표시합니다. 달력은 기존 내장 표를 공유하며 지원 범위 밖에서는 30분 기준을 사용합니다. 현재가 asOf는 수집 시각이며 마지막 체결 시각으로 추정하지 않습니다.

예열 작업의 예외·null 결과는 60초부터 지수 백오프로 재시도하고 최대 간격은 10분입니다. 성공 후에는 기존 장중 주기·장후 다음 개장 정책으로 돌아갑니다. warmup은 차트 예열 후 브리핑과 TOP1 근거를 한 번 더 GET해 나스닥 이력 준비를 시작하며 POST는 하지 않습니다.

부분 대체 배지는 ‘AI 요약 · 일부 자동 생성 문장 포함’이며 사용 모델도 표시합니다. 입력 해시의 함수·사실·숫자는 변경하지 않습니다. 날짜 주의의 입력 원문은 해시에 그대로 남기되, 응답의 종목 주의 목록과 연결된 전역/종목 인용에서는 제외합니다. 다른 주의의 ID는 변경하지 않습니다. 대상 세션 안내 문장은 자동 생성 종목 요약에만 남고 응답 주의에는 없으며, TOP5 행·패널의 대상일 표시는 별도로 유지합니다. 날짜 주의만 인용하던 종목의 `narrative.stocks[].citations`는 빈 배열일 수 있습니다. 화면은 유효한 인용 칩만 표시하며 남은 주의가 없으면 주의 칩을 표시하지 않고, 펼친 영역에 ‘표시할 주의점이 없습니다’를 표시합니다. 순위 점수는 LLM 요청의 표시 숫자와 문자열만 최대 소수 4자리로 제공하며 검증도 공개 정밀도와 4자리 중 작은 한도를 적용합니다. 기존 수급 비공개 필터에는 `total_supply_`도 포함됩니다. 수급 미제공 시 띄어 쓴 순매수·역어순·숫자 없는 매수세/매도세 주장도 차단하고 명시적인 기사 주제 서술만 허용합니다.

한국어 조사는 한글 받침으로 결정합니다. 숫자는 한국어 읽기의 마지막 음절(0·1·3·6·7·8은 받침), 영문은 마지막 알파벳의 한국어 명칭(L·M·N·R은 받침)을 사용하고 알 수 없는 끝 문자는 모음으로 처리합니다. 영문 회사명의 실제 발음을 추측하거나 사전을 만들지 않습니다. `3Q26`/`Q3` 같은 기사 주제 표기는 ‘3분기’로 정규화할 수 있지만 기사 금액·목표가는 숫자 근거로 허용하지 않습니다. 직접 부정 ‘나타내지 않습니다’와 ‘의미하지 않으며 … 권유가 아닙니다’는 허용하고 이중 부정·긍정 주장 우회는 계속 차단합니다.

관측 후처리에서만 오류가 발생하면 16개 선택 관측 열을 공란으로 남기고 기존 유한 모델 점수와 순위는 유지합니다. 모델 추론 자체의 실패나 비유한 최종 점수를 정상으로 바꾸지는 않습니다.

## 장전 시장 지표·AI 최종 의견·제목 기반 뉴스 요약 (추가 계약)

기존 브리핑 version 1과 6종 매크로 필드는 유지한다. 다음 필드는 optional이며, 없는 구형 응답·캐시는 기존 화면으로 표시한다.

- `macro.preOpen[]`: UST10Y, NASDAQ, USDKRW, KOSPI200_FOREIGN_FUTURES. 각 항목은 `value/change/changePct`, 실제 관측일의 `history[{date,value}]`(최대 5개), `fiveDayChange/fiveDayChangePct`, `asOf/source/status`, `comment{text,placeholder:true,ruleId}`를 제공한다. 결측·휴장일은 보간하지 않는다. 금리 차이는 %p, 환율은 원이다. 선물 지표는 KIS 일별 계약 수량을 사용하고 미확보 시 `unavailable`이며 현물 수급으로 대체하지 않는다. 단위 미확정 거래대금은 제공하지 않는다.
- `narrative.marketOutlook`: `{stance,text,citations,source}`. stance는 상승 우위/하락 우위/중립/판단 보류. 이 필드에만 시장 장 초반 방향·인과 표현을 허용하며, 종목 권유·목표가·비중·확률 생성·순위 재정렬·수익 보장은 계속 금지한다. 실제 확보된 장전 지표의 M: 인용만 허용한다. 검증 실패는 판단 보류와 규칙 요약으로 대체한다.

시장 의견은 원문 전체가 현행 검증을 통과하면 그대로 채택한다. 실패하면 문장별로 같은 금지·숫자·인용 검사를 적용하고, 안전한 문장이 2개 이상 남으며 선택한 stance를 말하는 문장이 보존되고, 재결합한 본문이 stance 일치·전체 검증을 다시 통과할 때만 부분 채택한다. stance 한 문장만 남거나 stance 문장이 제거되면 규칙 의견으로 대체한다. ‘가능성이 있습니다’ 같은 정성적 시장 방향 표현과, 실제 외국인 선물 관측에 연결된 ‘우호적인 수급’은 허용하되 수치 확률·종목 행동 권유는 허용하지 않는다.

외국인 선물 복합 문장의 직전일 계약 수·연속 일수·최근 5일 합계는 절별로 입력 항목에 결합한다. ‘670계약으로 4거래일 연속 순매수이자 5일 합계 4,218계약’ 같은 연결에서는 주체를 외국인 선물로 유지한다. 입력에 숫자가 존재하더라도 직전일 수치를 합계로, 합계를 직전일로 바꾸거나 5일 합계를 다른 기간의 합계로 부르면 거부한다. 현물·비외국인 주체·반대 부호 차단은 유지한다.
- `narrative.newsSummaries[]`: `{code,text,citations,source,summaryBasis?:"body"|"title",sentenceCitations?:string[][]}`. TOP5 순서를 유지하며 2~3문장으로 기사가 보도한 사실을 기사에 귀속한다. 본문 사용 문장은 sentenceCitations에 같은 순서의 종목 N: 인용을 제공한다. 숫자와 단위는 그 문장의 인용 기사 제목·본문에 그대로 있는 것만 허용하며 반올림·단위 승수 변경·다른 기사나 모델 수치 차용은 거부한다. 본문 없는 기사만 인용하면 기존 제목 기반 규칙(주제만, 수치 인용 금지)을 유지한다. 인과 표현·주가/실적 방향 예측·호재/악재 판정·권유는 본문 확보 및 기사 귀속 여부와 무관하게 계속 금지한다. 안전한 문장 2개 이상일 때만 부분 채택하고, 실패 시 필드 단위 기본 안내로 대체한다.

### 종목 AI 최종 의견: 분석 요약형

`GET /api/stock-insight?code=<6자리 코드>`는 TOP5에 포함되고 연결된 브리핑에 의견이 있는 종목에만 아래 선택 필드를 반환한다. TOP5 밖, 구형 보관 결과에는 필드가 없으며 화면은 숨긴다. 이 GET은 새 분석이나 Gemini 생성을 시작하지 않는다.

```ts
type StockAiOpinion = {
  source: "llm" | "template";
  text: string;
  citations: string[];
  generatedAt?: string;
};
// StockInsight.aiOpinion?: StockAiOpinion
// BriefingNarrative.stockOpinions?: (StockAiOpinion & { code: string })[]
```

기존 Gemini 종합 호출 한 번에 `stockOpinions[{code,text,citations}]`를 TOP5 입력 순서로 요청한다. 새 입력에서는 4~6문장으로 모델 결과(순위·모집단·상위%·점수와 20/120일 비교), 입력 지표 위치, 관측된 시장 배경, N: 기사 확인 사항, C: 주의·불확실성을 구성한다. 문장 단위 검증 후 최소 3문장을 유지해야 부분 채택하며, 구형 analysisMetrics 없는 캐시는 기존 최소 2문장을 허용한다. 단순 순위+한 문장으로 축소되는 것을 막고 한 문장 실패로 전부 대체되는 비율을 낮추기 위한 기준이다. 시장 방향을 허용하는 marketOutlook의 예외는 종목 의견에 적용하지 않는다. 종목 방향/stance·행동 권유·목표가·비중·확률·기대수익·보장·순위 재정렬·현물/종목 수급·다른 종목명·숫자 생성·기사 지시 실행을 거부한다. 장전 지표와 외국인 선물 계약 수는 관측 사실 배경만 허용하며 종목 순위와의 인과 및 시장 전망 반복은 금지한다. 기사 속 숫자는 별도 newsSummaries에서만 기사별 근거를 통해 허용한다. `BRIEFING_SHOW_SUPPLY` 공개 정책은 바꾸지 않는다.

### 종목 의견 입력과 본문 내부 캐시

`stocks[].analysisMetrics?: { rawRank:number|null; adjustedRank:number|null; lookbacks:{sessions:20|120;rank:number;topPercent:number}[]; agreement:"일치"|"부분 일치"|"불일치"|null; features:{key:"f_rsi"|"f_pct_b"|"f_high";label:string;percentile:number;side:"upper"|"lower";tailPercent:number}[] }`를 제공한다. 전체 순위/종목 모델 카드와 같은 원본 순위 및 특징 백분위를 사용한다. 모델별 순위·상위%, 특징별 백분위는 각각 자기 항목과 대조하며 다른 항목의 수치를 빌려 쓰지 못한다. `stockOpinionMarketFacts`는 장전 4종의 값·등락·실제 5일 관측·선물 합계/연속일·규칙 코멘트다. 같은 호출에서 생성할 marketOutlook 출력은 입력으로 넣지 않는다. 이전 모델 값·최종 보정 예측 등 예측 수익률 성격의 값은 기대수익 유도를 피하기 위해 제외한다. 원본 modelEvidence 객체도 그대로 보내지 않고 화이트리스트 지표만 전달한다.

추가 인용 ID: `R:<code>:raw`, `R:<code>:adjusted`, `R:<code>:20`, `R:<code>:120`, `E:<code>:feature:f_rsi`, `E:<code>:feature:f_pct_b`, `E:<code>:feature:f_high`. 기본 `R:<code>`는 필수 순위 앵커다. 장전 지표는 확보된 `M:<ID>`를 쓴다. 프런트 어댑터는 자기 종목의 새 ID를 허용하지만 화면에 실제 이동 대상이 등록되지 않은 ID는 칩을 숨긴다.

기사 본문은 분석 후 RSS 뉴스 수집 단계에서 최대 15건, 2개 동시·기사당 5초·전체 20초 예산 안에서 수집한다. 다음 요청의 5초를 확보하지 못하면 시작하지 않는다. HTTPS 공개 DNS 주소를 검증하고 접속 주소를 핀닝하며 리다이렉트도 다시 검사한다. User-Agent는 `StockBriefingResearch/1.0`이다. robots.txt 404/410은 정책 없음으로 허용하고, 명시적 Disallow는 금지하며, 5xx·차단·네트워크 오류는 이번 시도 실패로 처리한다. Google RSS의 로컬 해석 가능한 URL 또는 허용된 리다이렉트/기사 링크만 해석하며 robots 금지 경로를 우회하지 않는다. 추출은 articleBody/기사 영역만 사용하고 스크립트·광고·메뉴를 제외해 약 2,000자로 제한한다. 새 외부 의존성은 추가하지 않았다.

캐시는 `PIPELINE_OUTPUT_DIR/.private-news-bodies/<URL SHA256>.json`이며 기본 outputs 전체가 git에서 제외된다. 성공은 24시간 재사용하고 실패는 60초부터 증가하는 백오프를 적용한다. 본문은 생성 시 네트워크 수집 없이 전용 캐시만 읽어 신뢰할 수 없는 JSON bodyText 필드로 프롬프트에 넣는다. `briefing-narrative.json`에는 articleBodies 사본을 쓰지 않고 기사 ID별 `input.articleBodyHashes`만 저장한다. 해시만 있는 입력과 본문이 있는 입력의 inputHash 계산은 동일하다. 재검증 때는 전용 캐시에서 저장 해시와 일치하는 본문만 일시적으로 복원한다. 본문을 사용한 생성에서는 rawFields 전체를 저장하지 않으며, 출력에 본문과 일치하는 연속 80자 이상 구간이 있으면 그 필드를 비워 해당 필드만 안전하게 대체한다. 브리핑/종목 API·화면·로그에는 본문을 내보내지 않고 거부된 모델 문장도 본문이 있으면 로그에 출력하지 않는다. 본문 해시는 입력 정체성에 포함해 확보 상태 변화에 따라 캐시를 무효화한다. 현재 Google News RSS 기사 15건은 robots 정책으로 모두 제목 폴백됐으며 이를 우회하기 위한 새 데이터 소스는 추가하지 않았다.

종목 의견과 뉴스에는 가격 방향·밸류에이션 평가어(급등/급락·저평가/고평가·상방/하방·모멘텀·영문 방향어 등) 및 대상(주가/가격/실적/종목/시장)과 미래/가능성 표현의 결합을 거부한다. NFKC와 공백·구두점 제거 결과도 검사하며 기사 귀속이어도 예외를 두지 않는다. 이 구조 규칙은 marketOutlook에는 적용하지 않는다. 접두 그룹명을 제거한 타 종목 별칭도 검사하되 생성 별칭이 2글자 이하면 일반어 오탐 위험 때문에 제외한다. 자기 종목 별칭은 허용한다.

robots는 정규식 조합 없이 별표로 분리한 리터럴을 KMP 순방향 검색하고 `$` 끝 고정을 검사한다. 정책 256KB·규칙 2,048개·패턴 1,024자·별표 64개·조회 경로 8,192자 상한을 넘으면 금지한다. User-agent는 대소문자와 무관한 정확한 제품 토큰(StockBriefingResearch)만 일치시키며 빈 값은 무시한다. 본문은 HTML/XHTML 응답만 대상으로 순방향 토크나이저를 사용한다(전체 1MB·태그 12,000개·중첩 256·태그 8,192자 상한). Teredo/6to4/문서용 등 특수 IPv6 대역은 차단한다.

뉴스 복구 파일은 1MiB 상한을 검사하고 mtime/크기/inode 기준 메모리 캐시로 JSON 재해석을 줄인다. 본문 기반 뉴스는 제목·URL뿐 아니라 인용한 본문의 해시도 일치해야 복구하며 본문이 바뀌거나 사라지면 제목 기반으로 몰래 재분류해 재사용하지 않는다. 복구된 브리핑은 저장된 뉴스의 원 생성 시각·모델을 보존하며 현재 시각으로 새 생성처럼 표시하지 않는다. 새 인용의 R:raw/adjusted는 해당 순위, R:20/120은 해당 모델 비교, E:feature:*는 실제 표시된 특징 막대로 이동한다. 화면에 없는 특징과 M: 지표 칩은 숨김을 유지한다. M:의 브리핑 링크는 비동기 화면의 실제 지표 대상 준비·초점 이동을 보장하는 흐름을 별도로 갖출 때 추가한다.

시장 의견은 실제 수치에 맞는 최신일·연속일·5일 합계 복합 문장을 허용한다. 잘못된 수치 귀속·현물 혼동은 계속 거부한다. 문장 일부가 실패하면 선택한 stance를 담은 문장과 안전한 문장 총 2개 이상이 남고, 합친 결과도 전체 검증을 통과할 때만 부분 채택한다. ‘가능성이 있습니다’와 ‘우호적인 수급’은 수치 확률·종목 권유가 없는 시장 장 초반 해석에 한해 허용하며 종목 의견에는 방향 판단 예외를 적용하지 않는다.

인용은 해당 종목의 R:/E:/C:/N: 및 확보된 M:로 제한한다. 순위 R:는 필수이며 입력 근거·주의·기사 범주를 언급하면 존재하는 해당 범주의 인용이 필요하다. 공개하지 않는 수급 근거는 허용하지 않는다. 다른 TOP5와 서버 모집단 목록의 종목명·코드도 차단한다. 숫자는 해당 종목 및 시장 입력에 근거해야 하며 근거/주의/기사 건수는 입력 배열 길이만 허용한다. 문장별 거부 후 2문장 이상 남고 필드 검증을 통과하면 채택한다. 실패한 종목만 사실 기반 규칙 템플릿으로 대체하며 다른 종목·기존 요약·시장 의견·뉴스 요약을 지우지 않는다. 템플릿은 입력 원문이나 기사 제목을 복사하지 않는다. `source`는 종목별 최종 출처이며 구형 응답의 새 필드 누락은 기존 출처/상태 의미를 바꾸지 않는다.

새 생성 정책을 입력 해시와 `NARRATIVE_VALIDATION_VERSION`(`2026-10-28-fact-anchors-no-sp500-v6`)에 반영한다. 이전 해시 캐시는 유효 캐시로 승격하지 않으며 GET은 템플릿, 다음 허용된 생성 시 새 종합 응답을 만든다. 신형 캐시의 원문 의견도 매번 현재 필드 검증을 적용하며 개별 실패는 템플릿으로 바꾼다. 기존 35초 호출 제한·60초 실패 쿨다운·`BRIEFING_AUTO_NARRATIVE=0`·자동 생성/수동 POST 정책을 유지한다. 인사이트의 `generatedAt`은 브리핑 생성 시각이며 종목별 별도 호출 시각이 아니다. 화면 표기는 `AI 의견 · 투자 권유 아님 · 방향 판단 아님`이다.

새 필드는 기존 Gemini 요청 1회에 함께 생성한다. 자동 완료 준비의 전체 제한은 35초이고 기존 캐시·60초 실패 쿨다운·BRIEFING_AUTO_NARRATIVE 제어를 유지한다. 일부 필드가 대체되면 전체 `status`는 유효한 LLM 필드가 남을 때 llm, `fallbackReason`은 partial_template이다. 각 필드의 source가 실제 출처다.

미국 지표는 직전 완료 미국장 관측일에 맞춘 일봉 자료다. 선물 수급은 별도로 국내 직전 거래일을 사용한다. 제공자가 과거 종가의 정확한 시각을 주지 않는 경우 asOf는 날짜이며 종가 시각 미확인으로 기록한다. 미국 지표는 5개 관측일을 확보하지 못했으면 실제 개수를 제공한다. 카드의 출처·기준 시각·단위·관측일 수는 API와 title에 유지하며 화면 메타 줄은 표시하지 않는다. 접근성 설명은 aria-describedby로만 제공하고, 참조하는 hidden 노드는 읽기 순서에서 제외해 중복 낭독하지 않는다. title은 호버 보조다. 금리·나스닥·환율의 그래프 제목은 중립색 ‘5일 추세’다. 최대·최소 값은 Y축에만 표시하고 나머지 값은 별도 라벨 띠에 표시한다. 선물은 0축과 막대별 부호 있는 값 라벨을 표시한다. 차트 group은 기간·최소·최대·마지막만 요약하고, 각 점 button의 접근성 이름에 날짜와 값을 제공한다. SVG title과 시각 라벨의 중복 낭독은 제거한다. 툴팁은 같은 정보를 화면에만 보여주며 키보드/hover/터치로 열 수 있다. 한글 단위의 문자 폭을 포함해 축 여백을 확보하고 툴팁은 차트 아래 예약된 여백에 표시한다. 44×44px 터치 영역과 점 주변 포커스 링은 분리한다. 기존 TOP5 Sparkline에는 영향을 주지 않는다.

공통 기준일은 나스닥의 마지막 완료 관측일이다. 나스닥 기준일을 확인하지 못하면 금리·환율도 장전 묶음에서는 unavailable로 둔다. 개별 시점의 최신값은 기존 매크로 응답에 남는다. 금리 변화는 화면·모델 입력·검증에서 소수 3자리 %p, 다른 값은 최대 소수 2자리를 사용한다. 미확정 지표는 인용 ID 목록에서 제외한다. 의견은 종목명·6자리 코드·권유를 거부하고 stance 문구와 본문 일치를 검사한다. 제목 기반 뉴스는 최대 3문장에서 규칙에 탈락한 문장을 제거하되 안전한 문장이 2개 이상일 때만 채택한다.

재검증 자료의 46.6%는 직전 나스닥 상승 후 코스피 시가→종가 상승 비율이고, 50.6%는 같은 표본의 전체 상승일 비율이다. 46.6%를 일반 방향 일치율로 표현하지 않는다.

코스피200 선물 외국인 순매수는 KIS FHPTJ04040000의 U/0001/K2I/F001 조합으로 조회한다. 현재 KST 날짜를 제외한 직전 확인 거래일과 그 앞 4거래일이 모두 있을 때만 제공하며, 하루라도 결측이면 오래된 관측으로 대체하지 않고 unavailable로 둔다. `value/history[].value`는 부호 있는 계약 수이고 선택 필드 `fiveDaySum`은 정확한 5거래일 합계, `consecutiveDays`는 그 창의 마지막 연속 순매수(양수)/순매도(음수) 거래일 수다. `fiveDayChange/fiveDayChangePct`는 null이고 첫날 대비 차액·백분율은 계산하거나 의견 수치 근거로 허용하지 않는다. 거래대금과 0001 참조 지수는 수급 응답·화면·LLM 입력에 넣지 않는다. `asOf`는 거래일이며 출처는 ‘KIS 시장별 투자자매매동향(일별) · 직전 거래일’로 title에 보존하고 게시 최종 확정 시각을 추정하지 않는다. 화면 그래프의 날짜·일별 계약 수·0 기준선으로 사용자가 검산할 수 있다. 거래일별 첫 성공 응답을 메모리·디스크에서 재사용하므로 같은 기준일의 후속 정정치가 반영되지 않을 수 있다. 실패는 60초부터 지수 백오프(최대 10분), 차가운 GET은 기존 1.5초 대기 폴백을 사용한다. 조회 실패·빈 결과·5거래일 창 결측은 unavailable 카드로 표시하며 4카드 2열 배치를 유지한다. 종목 현물 수급 공개 여부와는 별개이며 의견의 명시적인 선물 외국인 계약 사실에만 수치 근거를 허용한다. 합계·직전일·연속일 방향은 각각 실제 부호와 대조하고 쉼표·접속어 뒤 현물/주식/시장 전체 수급 주장을 거부한다.

운영 확인 사항: K2I 응답에는 명시적인 시장 식별 필드가 없으므로 HTS 0404 값과 주기적으로 대조해야 한다. 2027 KRX 거래일 달력은 별도 추가가 필요하며 달력을 확인할 수 없는 연도는 unavailable로 처리한다.

외국인 선물 관측은 다른 주체의 수급을 입증하지 않는다. 수급 서술 앞 명사구와 은/는/이/가/도/과/와 조사를 판정해 외국인 선물·선물 외국인·그 수급 별칭만 근거 주체로 허용한다. 비교 주체 이름은 열거하지 않으며 공동 주어도 거부한다. 주어가 생략되면 직전 절의 주어를 상속하고 비외국인 주어 뒤에는 외국인 선물 문맥을 상속하지 않는다. 투자자 관점·심리·증권가 시각·은행주 등 배경 어휘 자체는 거부 근거가 아니다. 외국인 선물 관측을 지켜보는 투자자 서술도 허용한다. 실제 자료와 일치하는 합계·직전일·연속일과 수치·부호 검증은 유지한다.

## 문장별 사실 앵커 및 표시 지표 정책 (2026-10-28)

- `stockOpinions`는 각 문장의 입력 수치·항목 귀속 검증 뒤 모델 순위/점수/백분위, 입력 건수, N: 기사 주제, 시장 관측 수치 또는 제한된 고정 주의 문장 중 하나를 요구한다. 앵커가 없으면 `no_anchor`로 제외하며, 기존 금지 규칙은 앵커 유무와 무관하게 유지한다.
- `newsSummaries`의 각 문장은 N: 인용 기사와 겹치는 구체 주제 및 `~를 다룬 기사`/`~라고 보도했습니다`/`~를 발표했습니다` 형태의 기사 귀속이 필요하다. 일반 안내 문장은 제외한다. 기사 주제의 어휘 일치는 의미적 사실 함의 전체를 증명하지 않으며, 원문과 요약의 수동 대조가 필요하다.
- S&P 500은 수집·응답의 기존 `macro.indicators` 필드를 호환 목적으로 유지하지만, 브리핑 카드·모델 입력·허용 인용·요약 수치 근거에서는 제외한다. 구형 `M:SP500` 칩은 화면에 표시하지 않는다. 정책 버전 변경으로 다음 명시적 생성에서 입력 해시가 바뀐다.
- 과거 캐시에 남은 `input.articleBodies`는 읽기 전용 GET에서 원본 파일을 다시 쓰지 않는다. 다음 허가된 요약 생성의 저장 시 본문을 제거하고 `articleBodyHashes`만 남긴다. 원본 결과를 보존해야 하는 운영 절차에서는 기존 사본의 보관 정책을 별도로 적용한다.
