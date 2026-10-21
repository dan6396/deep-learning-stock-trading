# Frontend API Contract

현재 새 화면은 `src/shared/api/`에서 same-origin `/api/*`를 호출한다. 개발 서버의 `server/routes.ts`와 배포용 `api/` 진입점이 공통 핸들러를 사용한다. `VITE_API_BASE_URL` 공란은 mock 사용이 아닌 same-origin 호출이다. `npm run preview`는 정적 번들만 제공하고 개발 API 미들웨어는 제공하지 않는다.

## 브리핑 TOP5 계약

- 브리핑은 후보 생성 상태와 관계없이 `GET /api/rank`의 원본 `pred_rank` 상위 5종목을 사용한다. 뉴스 보정 순위나 수익률로 대체하지 않는다.
- `ensemble_pred_return`은 fraction 단위다(`0.01 = 1%`). 누락값은 `—`로 표시한다. `prediction_target === "next_session_open_to_close"`일 때만 다음 거래일 시가→종가로 안내하며, 그 외에는 예측 기간 미확인으로 표시한다.
- `POST /api/candidates/run`은 모드 생략 또는 `mode=model_only`에서 모델 추론 후 TOP5의 관련 기사만 수집한다. `mode=full`은 이 브리핑 API에서 거절한다. 독립 Python 연구 흐름과 과거 분석 결과는 보존한다.
- runner와 연결 상태 API의 `PIPELINE_ANALYSIS_MODE` 미설정 기본값은 `model_only`다. 브리핑 POST는 서버 기본값과 관계없이 이번 실행에 `model_only`를 적용한다. `kind=official`/`adhoc`으로 실행 분류를 지정하며 화면 기본값은 `adhoc`이다.
- 기사 수집은 고정 Google News RSS 공급자를 사용하며, 본문·감성 분석·LLM 호출·순위 보정을 하지 않는다. UI 링크는 Google News 경유 링크임을 표시한다. 별칭만 있는 제목은 누락될 수 있으며, 동명이 일반어·스포츠팀인 회사명에는 기업 관련 문맥도 요구한다.
- `related_news.json`은 `startedAt`, 종목 코드, 회사명, 분석 기준일이 현재 모델 결과와 일치해야 연결한다. 관련 제목을 필터링하고 발행 시각 내림차순으로 최대 3건을 표시한다.
- `data_meta.newsStatus`의 `collected`와 빈 기사 배열은 정상 수집 0건, `collection_failed`는 수집 실패, `not_collected`는 현재 분석에 연결할 기사 기록이 없음을 뜻한다. 기사 캐시 저장 실패는 검증된 모델 완료 상태를 무효화하지 않으며 실행 결과의 `articleCollectionStatus`가 `unavailable`이 된다.
- model_only의 실측 수급 overlay는 유지한다. full 모드의 원본 rank에 별도 수급 파일을 새로 덧씌우지 않는다.

## Source Files

모델 전용 실행과 선택적 뉴스 분석의 결과 파일은 다음과 같다. 기본 디렉터리는 `outputs`이며 `PIPELINE_OUTPUT_DIR`로 변경한다. 실행 중·완료·실패 marker와 실행 기록도 같은 설정을 따른다.

- `outputs/final_stock_transformer_news_llm_result.json` (when the optional news step is run)
- `outputs/step2_all_transformer_rank.csv` and `outputs/step2_final_top10.csv`
- `outputs/related_news.json` (model TOP5 related articles and collection states)
- `outputs/step3_final_top5.csv` and `outputs/step3_final_news_event_analysis.json` (full mode)
- `outputs/.candidate-analysis-run.json` (current run marker)
- `outputs/analysis-runs/<runId>.json` (persisted run classification, frozen predictions and outcomes)

아래 JSON 구조는 선택적 뉴스 분석 및 기존 결과 호환용이다. 모델 전용 브리핑은 전체 순위 CSV와 연결 가능한 관련 기사 캐시를 사용하며, 뉴스 보정 최종 후보를 생성하지 않는다.

```ts
type PipelineOutput = Array<{
  result: PipelineAnalysisResult;
  input_row: PipelineInputRow;
  news: PipelineNewsItem[];
}>;
```

## Pipeline Result Shape

```ts
type PipelineAnalysisResult = {
  ticker: string;
  company_name: string;
  label: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | string;
  label_ko: string;
  sentiment_score: number;
  confidence: number;
  summary: string;
  positive_factors: string[];
  negative_factors: string[];
  key_data_points: string[];
  used_news_indices: number[];
  caution: string;
};

type PipelineInputRow = {
  ticker?: string;
  company_name?: string;
  model_id?: string;
  prediction_target?: "next_session_open_to_close" | string;
  prediction_base_date?: string;
  ensemble_pred_return?: number;
  pred_rank?: number;
  pred_pool_size?: number;
  // Legacy classification output only; absent for the adopted ensemble.
  p_up?: number;
  [key: string]: unknown;
};

type PipelineNewsItem = {
  index: number;
  pub_date: string;
  source: string;
  title: string;
  url?: string;
};
```

## 기존 랜딩 제안 계약 (현재 새 화면 실행 API 아님)

아래 `market-summary`와 `reports/latest`는 과거 제안이며 현재 `server/routes.ts`에는 구현되지 않았다. 새 화면의 후보·순위는 아래의 실제 백엔드 목록과 `src/shared/api/` 어댑터를 기준으로 한다. 아래 `CandidateResponse`는 과거 정규화 제안으로, 현재 `/api/candidates`의 원시 pipeline 행 구조와 다르다.

### `GET /api/market-summary`

Returns a compact summary for the landing hero dashboard.

```ts
type MarketSummaryResponse = {
  generatedAt: string;
  marketState: "강세 우위" | "중립 우위" | "약세 경계" | string;
  candidateCount: number;
  riskState: "Low" | "Normal" | "Elevated" | "High";
  strategySlots: number;
  averageConfidence: number;
  averagePredictedReturn: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
};
```

### `GET /api/candidates`

Returns ranked candidates derived from the final pipeline result.

```ts
type CandidateResponse = {
  ticker: string;
  companyName: string;
  sentimentLabel: string;
  sentimentLabelKo: string;
  sentimentScore: number;
  confidence: number;
  predictedReturn: number | null;
  lstmStatus: string;
  summary: string;
  positiveFactors: string[];
  negativeFactors: string[];
  newsCount: number;
  latestNewsTitle?: string;
};
```

### `GET /api/reports/latest`

Returns latest report metadata and top candidate summaries.

```ts
type LatestReportResponse = {
  generatedAt: string;
  source: "pipeline";
  candidates: CandidateResponse[];
  warnings: string[];
};
```

## Current Frontend Implementation

새 화면의 `src/shared/api/`는 후보·순위·개별 분석·시세·상태·성과 API를 조회하고 nullable 어댑터로 정규화한다. 성공한 빈 배열이나 오류를 샘플 종목으로 채우지 않는다. 기존 `src/services/tradingData.ts`의 mock/fallback 동작은 레거시 화면용이며 새 화면의 데이터 계약이 아니다.

## Korean Market Board Contract

The market board screen is Korea-only. It should not fetch overseas markets, FX, US ETFs, or global futures.

브라우저는 KIS API를 직접 호출하지 않는다. `server/kisDashboard.ts`가 KIS 응답을 조회·정규화하며 키·시크릿·토큰은 서버에서 관리한다. 아래 `stocks` 및 `stocks/{code}`는 과거 제안 경로로 현재 라우트에 없으며, 개별 시세는 `/api/korean-market/quote?symbol=005930`, 분석은 `/api/stock-analysis?ticker=005930`을 사용한다.

### `GET /api/korean-market/dashboard`

Returns the full initial screen payload.

```ts
type MarketDashboardResponse = {
  generatedAt: string;
  sessionLabel: string;
  indices: MarketIndexSnapshot[];
  stocks: StockQuote[];
  watchlist: StockQuote[];
  focusedStockCode: string;
  events: MarketEvent[];
};
```

### `GET /api/korean-market/stocks?market=KOSPI&sort=tradingValue`

Returns quote rows for the stock table.

```ts
type StockQuote = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  isKospi200?: boolean; // KOSPI200 membership; backend sets true for its pool
  currentPrice: number;
  change: number;
  changeRate: number;
  direction: "up" | "down" | "flat";
  accumulatedVolume: number;
  tradingValue: number;
  tradingValueRank: number;
  investorFlow: {
    personal: number;
    foreign: number;
    institution: number;
  };
  aiSummary: string;
  sentimentLabel: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | string;
  confidence: number;
  predictedReturn: number | null;
  miniSeries: number[];
};
```

### `GET /api/korean-market/stocks/{code}`

Returns one stock detail payload for the side panel.

```ts
type StockDetailResponse = StockQuote & {
  reasons: string[];
  latestNews: Array<{
    title: string;
    source: string;
    publishedAt: string;
    url?: string;
  }>;
};
```

### `GET /api/korean-market/stock-chart?symbol={code}&range={range}`

종목 상세 패널의 가격 이력을 반환한다. 브라우저는 KIS 대신 이 백엔드 API를 호출한다. 현재 공통 route는 `symbol`만 `buildKisStockChart`에 전달하고 백엔드는 전체 기간 묶음을 조회·캐시한다. `range` query로 요청 기간을 선택하는 동작은 연결되어 있지 않다.

```ts
type StockChartResponse = {
  chartData: {
    symbol: string;
    name: string;
    code: string;
    currentPrice: number;
    averageBuyPrice?: number;
    ranges: Record<"1D" | "1M" | "3M" | "1Y" | "3Y" | "5Y", {
      prices: Array<{ date: string; price: number }>;
      candles: Array<{
        time: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume?: number;
      }>;
    }>;
  };
  summary: {
    dayChangeAmount: number;
    dayChangeRate: number;
    previousClose: number;
    openingPrice: number;
    previousVolume: number;
    marketCap: number;
    dividendYield: number;
  };
};
```

### KIS Field Mapping

현재 `server/kisDashboard.ts`의 KIS 시세 매핑은 다음과 같다.

| Frontend field | KIS/current backend source |
| --- | --- |
| `code` | stock code used as `FID_INPUT_ISCD` |
| `name` | `hts_kor_isnm` or static KOSPI pool name |
| `currentPrice` | `stck_prpr` |
| `changeRate` | `prdy_ctrt` |
| `dayChangeAmount` | `prdy_vrss` + `prdy_vrss_sign` |
| `openingPrice` | `stck_oprc` |
| `previousVolume` | previous-volume quote field, or latest completed daily OHLCV volume fallback |
| `accumulatedVolume` | `acml_vol` |
| `tradingValue` | `acml_tr_pbmn` |

대시보드의 KIS 투자자 응답은 다음 구조로 정규화한다.

```ts
{
  personal: number;
  foreign: number;
  institution: number;
}
```

Values should be signed numbers. Positive means net buying, negative means net selling.

### Legacy Mock Data

`src/data/mockMarketDashboard.ts`와 `src/services/tradingData.ts`는 보존한 레거시 화면의 자료다. 새 화면에서는 API 응답의 sample/cache/unknown 출처와 조회 실패를 구분한다. HTTP 200 또는 캐시 snapshot만으로 실시간 조회 성공을 의미하지 않는다.

## Implemented Backend (server/ + api/)

실제 공통 route는 `FE/server`(Vite 개발 미들웨어)와 `FE/api`(배포 진입점)에서 사용한다. 위 과거 제안 경로가 모두 구현된 것은 아니다.

- `GET /api/korean-market/dashboard` — serves the cached snapshot when fresh,
  otherwise builds a small inline slice live and caches it.
- `POST /api/korean-market/refresh` — batch job that fetches the full configured
  KOSPI200 universe **with investor flow** and writes the snapshot. Gate it with
  `SNAPSHOT_REFRESH_KEY` in production and drive it from a scheduler.
- `GET /api/korean-market/stock-chart?symbol=000660` — KIS 가격 이력·시세 요약 묶음을 반환하며 KIS 환경·종목·전체 기간 기준으로 캐시한다. `range` query는 현재 처리하지 않는다.
- `GET /api/candidates` — 최종 후보 pipeline 행 배열. 완료된 `model_only`에서는 미생성을 뜻하는 `[]`이며 새 화면은 mock으로 대체하지 않는다.
- `GET /api/rank` — `step2_all_transformer_rank.csv` 기반 원본 모델 순위. 브리핑은 `pred_rank` 상위 5개를 표시한다.
- `GET /api/stock-analysis?ticker=005930` — 종목 분석 행 또는 null.
- `GET /api/candidates/run` — 현재 프로세스의 실행 상태와 진행률. 저장된 전체 실행 이력이 아니다.
- `POST /api/candidates/run` — 모델 추론·결과 검증 후 TOP5 RSS 기사 수집. `mode`는 생략 또는 `model_only`만 허용하며 `full`은 400이다. 모델 전용 실행은 대시보드의 뉴스 분석 필드를 갱신하지 않는다.
- `GET /api/backend/status` — 설정 존재(실제 제공자 검증 아님), 메모리 실행 상태, 디스크 marker, 후보·순위 가용성. `no-store`이며 외부 호출·쓰기 없이 키·경로·원문 오류를 숨긴다. `results.candidates.state=not_produced`는 모델 전용 후보 미생성을 구분한다.
- 결과 읽기는 완료 marker와 실행 시작 시각에 맞는 파일 mtime을 확인한다. marker 부재·실패·실행 중·오래된 파일이면 배열은 비거나 분석은 null일 수 있다. 파일 mtime은 실제 시장 관측 시각이 아니다.

### 실행 기록과 공식 성과

- 실행별 UUID, `official`/`adhoc` 분류, 시작·완료·실패 상태, 고정 예측과 SHA-256을 `analysis-runs/<runId>.json`에 저장한다. 과거 CSV를 공식 성과로 소급 등록하지 않는다.
- `GET /api/performance`는 저장된 실행·종목별 고정 예측·실제 시가/종가·성과 요약·수집 상태를 반환한다. `?symbol=005930`으로 종목을 필터링한다. 응답 구조는 `src/types/performance.ts`의 `PerformancePayload`다.
- `POST /api/performance/collect`는 가격 수집을 시작한다. 스케줄러용 `GET /api/performance/collect`는 `CRON_SECRET`의 Bearer 인증 후 수집 완료를 기다린다. 두 성과 API는 `no-store`다.
- 공식 집계는 기준일·모드별 최초 완료 공식 요청 중 기준일 15:30 이후, 목표 거래일 09:00 한국시간 전 완료 조건을 만족한 실행만 포함한다. 목표 거래일은 KIS 달력 또는 실제 거래일 자료로 확인한다.
- 목표일 18:30 이후 선정 종목 모두의 해당 날짜·양수 시가/종가/거래량이 확인돼야 성과를 확정한다. 수익률은 `(종가-시가)/시가`, 선정 종목 동일 비중, 비용 차감 전 가격 성과이며 주문 손익이 아니다. 공식 최근 최대 20거래일의 일평균·복리 누적·방향 적중률을 모드별로 분리한다.
- 정적 preview는 API·예약 수집을 실행하지 않는다. 실행 기록 보존과 운영 수집에는 영속 결과 디렉터리 및 실행 가능한 백엔드·스케줄러가 필요하다.

### AI / investor field sources

`buildKisDashboard` merges KIS quotes with pipeline output by 6-digit ticker:

| `StockQuote` field | Source |
| --- | --- |
| `currentPrice` / `changeRate` / `accumulatedVolume` / `tradingValue` | KIS `inquire-price` (`FHKST01010100`) |
| `investorFlow.{personal,foreign,institution}` | KIS `inquire-investor` (`FHKST01010900`) → `prsn_ntby_qty` / `frgn_ntby_qty` / `orgn_ntby_qty`, most recent non-empty daily row |
| `aiSummary` | pipeline `result.summary` |
| `confidence` | pipeline `result.confidence` |
| `predictedReturn` | pipeline `input_row.ensemble_pred_return ?? lstm_pred_return` |
| `sentimentLabel` | pipeline `result.label` (falls back to a direction-based guess) |

When a stock has no matching pipeline row, the AI fields stay empty
(`confidence: 0`, `predictedReturn: null`) and the UI renders "—" rather than a
misleading zero. Investor flow is only reliably populated in the **real** KIS
environment; the mock (VTS) environment frequently returns empty net-buy figures.
