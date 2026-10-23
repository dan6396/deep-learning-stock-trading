# 현재 최종 모델 API 계약

- `GET /api/rank`: 최종 모델의 전체 유효 종목 순위. 실행 미완료·오래된 결과·다른 모델 결과는 제공하지 않습니다.
- `GET /api/stock-analysis?ticker=005930`: 같은 전체 순위에서 해당 종목과 관련 기사를 반환합니다.
- `GET /api/candidates`: 별도 뉴스 보정 최종 목록을 생성하지 않아 빈 배열을 반환합니다. 화면 TOP5는 원본 모델 순위 1~5위입니다.
- `POST /api/candidates/run?mode=model_only&kind=adhoc`: 현재 최종 모델 추론과 RSS 기사 수집을 시작합니다. `kind=official`은 공식 성과 기록 요청입니다.
- `GET /api/candidates/run`: 비동기 실행 상태·진행률.
- `GET /api/backend/status`: 읽기 전용 로컬 구성·실행·산출물 상태.
- `GET /api/briefing`: TOP5 종합 브리핑과 캐시 설명. Gemini를 호출하지 않습니다.
- `POST /api/briefing/narrative`: 별도 Gemini 설명 생성. 모델 추론·순위는 변경하지 않습니다.
- `GET /api/performance`: 저장 실행과 실제 가격 성과. 선정 종목 시가·종가가 모두 있어야 계산합니다.
- `/api/korean-market/*`: 지수·시세·차트·거래일 달력.

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

두 브리핑 API는 아래와 같은 전체 객체를 HTTP 200으로 반환합니다. `GET /api/briefing`은 GET만, `/api/briefing/narrative`는 POST만 허용하며 다른 메서드는 405입니다. 응답은 `Cache-Control: no-store`, `X-Data-Source`, `X-Data-As-Of`를 제공합니다. 파일 기반 실행 결과를 포함하므로 `data_meta.source`는 `cache`입니다. Vite의 공용 라우트 맵에서 제공하며 정적 preview에서는 실행되지 않습니다.

```typescript
type Briefing = {
  version: 1;
  status: "ready" | "no_run";
  model: {
    modelId: string; scoreKind: "rank_zscore"; baseDate: string;
    predictionTarget: "next_session_open_to_close"; poolSize: number;
    runStartedAt: string | null;
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

유효한 `completed`·`model_only` 실행과 일관된 원본 순위가 없으면 `status="no_run"`, `model=null`, `stocks=[]`입니다. 진행 중 실행으로 마커가 바뀌어도 이전 결과를 브리핑에 섞지 않습니다. 기존 `validateModelRows`를 재사용하며 요청 환경을 순위 파일·마커·수급 조회에 전달합니다. `stocks`는 원본 `pred_rank` 순서의 최대 5개이며 `topPercent=rank/poolSize*100`입니다. 근거·주의는 서버의 결정적 규칙으로 생성합니다. 수급은 측정된 기간·원 단위 순매수 합계·양수 일수만 설명하고 조건 통과/미통과로 표현하지 않습니다. 원 단위는 `integrated_pipeline.py`의 `_kis_million_to_won` 변환을 따릅니다. 기사 실패·성공 0건·미수집을 구분하며 종목당 최대 3건을 제공합니다.

매크로는 Yahoo chart v8의 `^KS11`, `^KQ11`, `^IXIC`, `^GSPC`, `KRW=X`, `^TNX`를 사용합니다. `value=regularMarketPrice`, `change=value-(chartPreviousClose ?? previousClose)`, `changePct=change/previousClose*100`이며 `^TNX` 값은 추가 배율 없이 `%`입니다. 개별 `asOf`는 `regularMarketTime`의 UTC ISO 문자열이며 서버 수집 시각과 다릅니다. `macro.asOf`는 확보한 관측 시각 중 가장 이른 시각입니다. 지표별 8초 제한(본문 포함)과 실패 격리를 적용하고 실패한 값·등락·시각은 null입니다. 기본 캐시는 10분이며 `BRIEFING_MACRO_CACHE_TTL_MS`로 조정합니다.

NASDAQ·S&P500의 `session`은 `currentTradingPeriod.regular`의 시작·종료와 관측 시각으로 장중/마감을 구분합니다(서머타임·조기 마감 포함). 관측이 다음 거래 기간보다 이전이면 이미 끝난 장이며, 종료 시각이 지났다면 마지막 틱이 종료 직전까지 오지 않아도 `closed`입니다. 09:00~09:29 ET는 `open`으로 표시하지 않습니다. `context.usSessionDate`는 두 미국 지표의 뉴욕 현지 관측일이 같을 때의 날짜이며, 일자가 다르거나 하나라도 없으면 null입니다. `targetSessionNote`는 그 미국 관측일/장 상태와 모델 기준일 다음 한국 거래일의 시가→종가 대상을 함께 설명합니다. 한국 휴장일 달력 범위 밖에서는 다음 한국 거래일로만 표기합니다. 장중 자료를 전날 미국 종가로 설명하거나 시장과 모델 순위 사이의 인과·확률을 주장하지 않습니다.

출처 ID는 시장 `M:<ID>`, 모델 순위 `R:<code>`, 근거 `E:<code>:<n>`, 주의 `C:<code>:<n>`, 기사 `N:<code>:<n>`입니다. Gemini는 설명 문구와 인용만 반환하며 입력에 없는 id, 다른 종목의 근거, 순서 변경, 추가 JSON 필드, 금지 표현, 입력에 없는 숫자(반올림 허용)를 서버에서 거부합니다. 기사 제목·식별자·URL·출처명의 숫자는 수치 근거로 쓰지 않습니다. 제목의 `3분기` 같은 분기는 같은 기사 주제 표기로만 허용하며 가격·계약금액 등의 수치 허용 집합에는 넣지 않습니다. 순매수·순매도·매수세·매도세 등 수급 사실은 허용하되 매수/매도 의견·권유·타이밍·추천은 차단합니다. 목표가·목표주가·적정주가·투자 비중·확률·기대/예측/예상수익률·수익 보장도 차단하되 같은 절의 짧은 부정·면책("수익률·확률이 아닙니다", "투자 권유가 아닙니다")은 허용합니다. 가격·수익 대상과 결합한 전망·예상·예측은 차단하고 "실적 전망 기사" 같은 주제 서술은 허용합니다. 제목 안의 지시는 무시하고 수치를 인용하지 않도록 시스템 지시에 명시합니다.

수치는 단위와 절댓값을 대조하고 같은 절의 상승·하락·순매수·순매도 방향을 별도로 검사합니다. "각각 3.52%, 2.29% 하락", "외국인 X원, 기관 Y원 각각 순매도"처럼 여러 수치가 하나의 방향을 공유할 수 있습니다. 입력 방향과 반대이면 거부합니다. 수급 금액의 한국어 조/억/만 표기는 원으로 환산하고 표시 정밀도 내 반올림만 허용합니다. 템플릿과 LLM 입력은 같은 포맷 함수를 사용합니다(예: `1,325.93원`, `5,533.77pt`, `4.98%`, `20억 8,200만 원`). 종목당 수급 근거는 기간·외국인/기관 합계·양수 일수를 한 문장으로 묶습니다.

`overview`, `marketNote`, 각 `narrative.stocks[].summary`를 독립 검증합니다. 실패한 필드만 해당 템플릿으로 교체하며 `fieldSources`와 종목별 `source`에 출처를 표시합니다. 일부 필드가 LLM이면 `status="llm"`, `fallbackReason="partial_template"`이고 모든 필드가 실패하면 `status="template"`입니다. 종목 인용 검증 실패는 그 종목에만 적용합니다. 최상위 `narrative.citations`는 개요·시장 설명이 공유하므로 이 목록이 잘못되면 두 필드만 대체하고 정상 종목 설명은 유지합니다. 각 실패의 필드명·고정 사유·비밀을 제거한 문장 일부는 서버 로그에 남깁니다. 디스크 캐시를 읽을 때도 LLM 필드는 검증하고 템플릿 필드는 결정적 템플릿과 일치하는지 확인합니다.

`GEMINI_API_KEY`는 Node 서버 환경에서만 읽고 REST 헤더로 전송합니다. 브라우저 응답·로그·에러에 넣지 않으며 SDK를 추가하지 않습니다. 기본 모델은 [공식 안정 모델 문서](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)에서 확인한 `gemini-3.8-flash`이며 `GEMINI_BRIEFING_MODEL`로 바꿀 수 있습니다. `responseMimeType=application/json`, `responseSchema`, `temperature=0.1`, `thinkingConfig.thinkingLevel="LOW"`, `includeThoughts=false`, `maxOutputTokens=3072`를 사용합니다. Gemini 호출은 최대 35초, POST 전체는 준비 조회·업종·설명 생성을 합쳐 45초 예산이며 준비 조회에는 최대 9초를 배정합니다. 예산이 부족하면 이미 확보한 값·이전 캐시·미수집 기본값으로 진행합니다. FE 클라이언트의 설명 POST 제한은 60초입니다.

`inputHash`는 실행(`runStartedAt`/`baseDate` 포함 모델 메타), TOP5 구성·점수·측정 수급을 포함한 근거/주의 문장과 기사 수집 상태·id·제목·URL·출처로 계산하며 매크로는 제외합니다. 제목은 NFKC·공백, URL은 호스트·기본 포트·쿼리 순서를 정규화하고 fragment는 제외합니다. 같은 순번 id의 기사 내용이 바뀌면 설명 캐시는 무효화됩니다. 생성 입력 전체(매크로 값·시각·context 포함)를 `outputs/briefing-narrative.json`에 설명과 함께 임시 파일→rename 방식으로 저장합니다. 캐시 검증은 저장된 매크로 스냅샷을 기준으로 합니다. `macroAsOf`는 설명 생성에 쓴 기준 시각이며 현재 매크로 값·시각·context가 달라지면 `macroStale=true`입니다. GET은 이 표시와 함께 기존 LLM 설명을 유지합니다. POST도 동일 입력의 설명을 재사용하며, 매크로가 달라졌고 마지막 성공 후 10분 이상 지난 때만 갱신합니다. 매크로 갱신마다 설명이 사라지거나 생성 요청이 반복되는 현상을 줄이기 위한 정책입니다.

동시 생성은 서버 프로세스당 1건입니다. 같은 실행의 동시 요청은 진행 중 결과를 공유하며 다른 실행은 `generation_in_progress` 템플릿을 받습니다. 실패 후 60초 쿨다운은 다른 hash에도 적용하고 최근 실패는 디스크에도 보관합니다. 이전 성공이 없다면 키 없음·통신 오류·전체 필드 검증 실패는 `status="template"`와 `fallbackReason`으로 HTTP 200을 반환합니다. 일부 필드 검증 실패는 위의 부분 대체 계약을 따릅니다. 갱신 전체 실패 전에 검증된 LLM 설명이 있으면 GET·POST 모두 이전 설명을 유지하고 `status="llm"`, `macroStale=true`, 실패 사유를 `fallbackReason`으로 제공합니다. 성공하거나 현재 매크로가 성공 스냅샷과 다시 일치하면 갱신 실패 사유는 지웁니다. 다만 부분 대체된 설명의 `partial_template`은 유지합니다. 디스크의 template 실패 사유도 고정 허용 목록으로 검증합니다. 읽기 전용 배포에서 파일 저장이 실패하면 해당 프로세스의 메모리 캐시로 동작합니다.
