# 프론트엔드 리빌딩 설계·이행 계획

- 작성: 2026-10-07 · 갱신: 2026-10-09 · 상태: 웹 프론트엔드 로컬 기술 완료 — 최종 메인 검증·Sonnet 코드 검토·Opus 최종 승인 완료. 외부 배포 승인은 아님.
- 확정 시안: `workspace-v3-toss.html` (토스뱅크 스타일, 기본 다크 + 라이트)
- 범위: `FE/` 화면·데이터 계층·FE 서버 API. Python 파이프라인 변경은 M5에서 별도 승인 후 진행.
- 완료한 프런트엔드 범위: M4 전체 순위·관심·검색, M5 분석 기록 UI의 현재 계약/미제공 상태, About 정적 소개, M6 root 전환·legacy 별칭 연결이다. Python 자동 실행·공식 로그·20거래일 실현 성과·관리자 인증·운영 호스트·구 코드 물리 삭제는 미완료이며 이번 구현 범위 밖이다. 웹 UI 완성이 백엔드 성과/운영 체계 완료나 배포 승인을 뜻하지 않는다.

## 1. 핵심 결정

1. React 18 + Vite + TypeScript를 유지하고, 같은 앱 안에서 화면을 단계적으로 교체한다. 새 앱 디렉터리를 따로 두지 않는다.
2. 스타일은 Tailwind CSS + shadcn/ui(Radix)로 옮기고, 색은 CSS 변수 토큰으로 관리한다(다크·라이트 1세트씩). 기존 `global.css`는 마지막 단계에서 삭제한다.
3. 서버 데이터는 TanStack Query로 관리한다. 경합·이전 상태 잔존 결함(리뷰 ①③⑤)을 구조적으로 없애는 것이 주목적이다.
4. 화면은 브리핑(`/`) 중심으로 재구성하고, 종목 상세는 브리핑의 오른쪽 패널(`/?code=`)과 전체 리포트(`/stock/:code`) 두 단계로 둔다.
5. 성과 기록은 실제 데이터가 쌓이기 전까지 예시를 쓰지 않는다. "기록 수집 중"으로 표시한다.

## 2. 스택

| 영역 | 결정 | 근거 |
|---|---|---|
| 앱 | React 18 + Vite + TS 유지 | 서버·API·파이프라인 연동을 그대로 재사용한다. Next.js 전환은 파이프라인 실행 위치(Vercel 불가)가 정해지기 전에는 이점보다 위험이 크다. 이 서비스는 검색 노출(SEO)이 필요하지 않다. |
| 스타일 | Tailwind v4 + shadcn/ui(Radix) | 4,000줄 단일 CSS를 컴포넌트 단위로 대체한다. Radix가 키보드·ARIA 동작을 제공해, 직접 만든 combobox·탭의 결함 재발을 줄인다. |
| 토큰 | CSS 변수(`--bg`, `--surface`, `--text`, `--up`, `--down`, `--accent` …) → Tailwind 테마에 매핑 | 다크·라이트를 같은 이름의 토큰으로 처리한다. 값은 시안에서 대비(AA)를 검증한 것을 쓴다(§7). |
| 서버 상태 | TanStack Query v5 | 쿼리 키가 종목 코드별로 분리되고, 요청 취소와 경합 처리가 내장돼 있다. 분석 실행 폴링은 `refetchInterval`로 처리한다. |
| 표 | 비교표(5행)는 native `Table`, 전체 순위는 native table + 20행 페이지네이션 | 199행에는 순수 정렬·필터와 native `aria-sort`로 충분하다. TanStack Table offline 캐시 부재 및 온라인 설치 자동 승인 검토 거절로 추가 의존성 없이 구현했다. |
| 차트 | 기존 SVG 차트(면적·캔들) 유지·이식 | 5단계에서 키보드 탐색과 요약 문구를 이미 갖췄다. 차트 라이브러리를 새로 추가하지 않는다. |
| 검색 | native `dialog` + 전체 순위 검색(⌘K) | 구현에서는 추가 라이브러리 없이 포커스 순환·닫기·복원과 전체 집합 검색을 검증했다(§15). |
| 아이콘·폰트 | lucide-react, Pretendard 유지 | 이미 도입돼 있다. |
| 테스트 | Vitest + Testing Library 추가. 기존 CDP·axe 스크립트를 `FE/scripts/verify/`로 편입 | 지금은 단위 테스트가 없다(§6). |

## 3. 정보 구조와 라우트

| 경로 | 화면 | 비고 |
|---|---|---|
| `/` | 브리핑: 다음 거래일 요약, 후보 5종목 비교표, 성과 기록, 오른쪽 상세 패널 | 선택한 종목은 `/?code=267250`로 딥링크한다. 새로고침과 공유 시에도 유지된다. |
| `/rank` | 전체 예측 순위(약 199종목): 정렬, 필터, 검색 | 후보 외 종목은 "뉴스·수급 미분석"으로 표시한다. |
| `/watchlist` | 관심 종목 | 저장소: localStorage. 기존 키를 이전한다. |
| `/history` | 분석 기록(실행별 결과)과 성과 기록 상세 | M5 |
| `/stock/:code` | 종목 전체 리포트 | 상세 패널의 "전체 리포트" 버튼에서 연결된다. |
| `/dashboard`, `/dashboard#market-table` | `/`로 리다이렉트 | 기존 링크를 호환한다. |
| `/about` | 서비스 소개·방법론·유의사항 (현재 랜딩을 대체) | 공개 서비스이므로 유지한다. 검색 노출을 위해 빌드 시 정적 HTML로 미리 렌더링한다. `/`의 첫 방문 안내 띠에서 연결한다. |

검색 대상은 분석 결과로 줄어든 목록이 아니라 **전체 순위 집합**으로 한다. 기존 문제인 "분석 후 검색·관심 목록이 후보 5개로 축소"가 함께 해결된다.

## 4. 데이터 계약

| 화면 요소 | 출처 | 상태 |
|---|---|---|
| 분석 기준일·실행 시각·소요 | 파이프라인 `prediction_base_date`(`src/data/pipelineAdapter.ts:66`), 분석 실행 상태 API | 있음 |
| 다음 거래일(06.22 월) | 휴장일 반영이 필요 | **없음**. KRX 휴장일 목록을 정적 파일로 두거나 KIS 영업일 API를 쓴다. |
| 시장 판단("관망 우위") | 현재 클라이언트 휴리스틱(지수 등락·기울기, `MarketWorkspace.tsx` `buildMarketRegime`) | 있음. 단 휴리스틱이므로 "지수 흐름 기반 단순 판단"이라고 표시한다. |
| 후보 5종목·예측수익률·순위 | `step3_final_top5.csv`, 최종 JSON(`server/pipelineResults.ts:12-14`), `pred_rank`/`pred_pool_size`(`pipelineAdapter.ts:63-64`) | 있음 |
| 모델 신호 | `pred_rank`, `ensemble_pred_return`(`pipelineAdapter.ts:67`) | 있음. 판정 규칙은 §5에 정의한다. |
| 뉴스 신호 | LLM 집계(`newsSentimentTally`), 기사별 판정, `news_applied`(`pipelineAdapter.ts:70-80`) | 있음 |
| 수급 신호 | `foreign_net_buy_sum`, `inst_net_buy_sum`, `*_positive_days`, `supply_window`(`pipelineAdapter.ts:72-77`) | 있음 |
| 근거 일치도 | 위 세 신호에서 파생 | 파생(§5) |
| 주의 신호: 수급 매도 우위, 근거 불일치, 부정 기사 비중 | 위 데이터에서 파생 | 파생 |
| 주의 신호: 실적 발표 일정, "기관 n일 연속 순매도" | 공시 일정, 일별 수급 시계열 | **없음**. 공시 일정은 DART 연동이 필요(키 필요)하고, 일별 수급은 파이프라인 출력 확장이 필요하다. M5 이후 별도 결정. |
| 전체 순위 | `step2_all_transformer_rank.csv`(`server/pipelineResults.ts:15`) | 있음 |
| 시세·지수 | KIS API, 실패 시 캐시·샘플 | 있음. 출처를 지수별로 표시하고, 지수 시계열에 `source: history \| interpolated`를 추가한다(리뷰 ② 해소, `server/kisDashboard.ts:231`). |
| **성과 기록**(최근 N거래일 후보 성과 vs 지수) | — | **없음.** `research/regime_benchmark/published/daily_equity.csv`는 사후에 선택한 3개 구간의 탐색 실험이고, README가 실거래 신호로 쓰지 말라고 명시한다. 따라서 "최근 성과"로 표시하지 않는다. M5에서 일별 예측 로그와 다음 날 실현 수익 평가를 새로 만든다. 그 전까지는 "기록 수집 중 (n/20일)"으로 표시한다. |

## 5. 신호 판정 규칙 (초안, 검토 대상)

규칙은 한 곳(`src/entities/signals.ts`)의 순수 함수로 두고 단위 테스트로 고정한다. 화면에는 규칙 설명을 "근거 판정 기준"으로 공개한다.

- **모델**: 최종 후보에 들었으면 긍정(정의상 상위 5). 전체 순위 화면에서는 상위 5%이면서 예측수익률 > 0이면 긍정, 예측수익률 ≤ 0이면 부정, 그 외는 중립.
- **뉴스**: LLM 집계에서 긍정 > 부정이면 긍정, 부정 > 긍정이면 부정, 같거나 기사가 0건이면 중립. 키워드 추정만 있으면 "판정 불가"(중립으로 집계하지 않는다).
- **수급**: 외국인+기관 합계 > 0이고 매수 우위 일수가 절반 이상이면 긍정, 합계 < 0이고 절반 미만이면 부정, 그 외는 중립.
- **근거 일치도**: 긍정 개수/3. "판정 불가"는 분모에서 빼고 따로 표시한다.

## 6. 아키텍처

```
FE/src/
  app/        router, providers(QueryClient, Theme), layout(상단 내비)
  features/
    briefing/ BriefingBar, CandidateTable, DetailPanel, TrackRecord
    rank/     RankTable
    watchlist/
    history/
    stock/    StockReport (기존 StockDetailPage 이식)
  entities/   candidate(어댑터·타입), signals(판정 규칙), market(국면)
  shared/
    ui/       shadcn 컴포넌트
    api/      fetch 클라이언트, 쿼리 키·쿼리 함수
    lib/      포맷(원·%·날짜), 브랜드 상수(이름·로고 1곳)
```

- **쿼리 키**: `['dashboard']`, `['indices']`, `['candidates', runId]`, `['rank', runId]`, `['stock', code]`, `['quote', code]`, `['chart', code, range]`, `['analysis-run']`(실행 중에만 5초 폴링).
- **출처 표시**: 모든 쿼리 결과가 `{ data, source: live|cache|sample, asOf }`를 갖고, 화면은 이 값만 보고 배지를 표시한다(리뷰 ③ 해소).
- **분석 실행**: `useMutation`으로 시작하고, 완료되면 `['candidates']`를 무효화한다. 새로고침과 경합하면 마지막 요청만 반영된다(리뷰 ⑤ 해소).
- **종목 상세**: 상태를 `code`별 쿼리로만 관리해 이전 종목 데이터가 남지 않는다(리뷰 ① 해소).
- **포커스 이동**: 라우트 전환 시 페이지 컴포넌트가 마운트된 뒤 main에 포커스한다(프레임 수 제한 제거, 리뷰 ⑥ 해소).
- **FE 서버**: `vite.config.ts` 미들웨어와 `FE/api/*.ts`에 중복된 핸들러를 `server/routes.ts` 한 곳으로 모은다.

## 7. 디자인 토큰 (시안 기준, AA 검증값)

| 토큰 | 다크(기본) | 라이트 |
|---|---|---|
| bg / surface / surface-2 | #17171c / #202027 / #2c2c35 | #f2f4f6 / #ffffff / #f2f4f6 |
| text / text-2 / muted | #e4e4e5 / #c3c3c6 / #9e9ea4 | #191f28 / #4e5968 / #6b7684 |
| up / down | #ff5a6a / #4c9aff | #d91f35 / #1b64da |
| 주 버튼 | #1b64da + 흰 글자 | #1b64da + 흰 글자 |
| 데이터 막대·근거 점 | 중립(text-2/text) | 중립 |
| 카드 모서리 | 22px, 테두리 없음 | 동일 |

파랑은 버튼·링크 같은 조작 요소와 하락에만 쓴다. 데이터 강조에는 쓰지 않는다.

## 8. 이행 단계

각 단계는 별도 커밋이며, 단계마다 빌드·타입 검사, 단위 테스트, CDP·axe 검증을 통과해야 한다. 금융 수치를 다루는 단계(M1, M2, M5)는 다른 계열 모델의 독립 리뷰를 받는다.

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| **M0 기반** (구현됨, 아래 기록 참조) | Tailwind·shadcn 기반, 토큰·테마 전환(다크 기본, 선택 저장), QueryClient, `/next` 아래 새 화면 골격, 브랜드 상수, Vitest, 접근성 검증 스크립트 | 빈 셸에서 axe 위반 0, 기존 화면 회귀 없음 |
| **M1 데이터 계층** | API 클라이언트, 쿼리, 출처 메타, 신호 판정 함수와 단위 테스트, 지수 시계열 출처 필드(서버), 핸들러 통합 | 판정·포맷 단위 테스트 통과, 기존 화면 동작 유지 |
| **M2 브리핑 `/`** | 브리핑 줄, 비교표(키보드 선택), 상세 패널(`?code`), 성과 기록 영역은 "수집 중" | 리뷰 ①④⑤⑥ 재현 시나리오가 통과, axe 0, 1280·1440 스크린샷 |
| **M3 종목 리포트 `/stock/:code`** | 기존 상세 페이지를 새 구조로 이식 | 종목 전환 시 이전 데이터 0건 잔존 |
| **M4 전체 순위·관심·검색** | `/rank`(native table, 20행 페이지네이션), `/watchlist`, ⌘K 검색 | 199행 정렬·`aria-sort`, 검색 대상이 전체 순위 집합 |
| **M5 실행 체계·분석 기록·성과 기록** | Python: 장 마감 후 자동 실행(공식 기록), 일별 후보 로그, 다음 날 실현 시가→종가 수익 평가(거래비용 반영값과 미반영값 모두 저장, 비용 모델은 `portfolio_replay.py`와 동일하게 명시). 서버: 수동 실행은 관리자 인증 뒤에만 허용, 동시 실행 잠금. FE: `/history`(공식·수시 실행 구분), 성과 기록 활성화(공식 기록 20거래일 이상) | 평가 로직과 인증·권한 독립 리뷰, 데이터가 부족하면 미표시 |
| **M6 정리** | 구 화면·`global.css`·미사용 코드 삭제, 랜딩 결정 반영 | 빌드 크기·CSS 감소 확인, 전체 회귀 통과 |

## 9. 결정 사항 (2026-10-07 확정)

1. **공개 서비스다.** `/`는 브리핑이고, 처음 온 방문자를 위해 닫을 수 있는 서비스 설명 띠를 둔다. 현재 랜딩은 `/about`(소개·방법론·유의사항)으로 바꾸고, 정적 HTML로 미리 렌더링한다.
2. **브랜드는 보류한다.** 기본값("KOSPI AI Desk")을 유지하되, `src/shared/lib/brand.tsx` 한 곳에서만 관리한다.
3. **성과 기록을 추가한다(M5).** 표시 기준: 공식 기록 20거래일 이상, 거래비용 반영값을 기본으로 보여 주고 미반영값은 상세에서 함께 제공한다.
4. **주의 신호는 있는 데이터로만 시작한다.** 수급 매도 우위, 근거 불일치, 부정 기사 비중으로 시작한다. 공시 일정(DART)은 나중에 추가한다.
5. **데이터 막대는 중립색이다.**
6. **실행은 자동과 수동을 모두 쓴다.**
   - 장 마감 후 자동 실행이 **공식** 결과이고, 이것만 성과 기록에 들어간다.
   - 수동 실행은 **관리자만** 할 수 있고(공개 방문자에게는 버튼을 보이지 않는다), 결과는 "수시 분석"으로 구분해 표시한다. 결과가 좋을 때까지 재실행해 기록이 오염되는 것을 막기 위해서다.
   - 실행 위치는 Vercel 밖이어야 한다(장시간·Python 필요). 정해진 시간 실행과 관리자 수동 실행을 받을 상시 백엔드가 필요하다.

### 배포 전 필수 조건 (2026-10-07 확정)
- **관리자 수동 실행 권한을 배포 전에 갖춘다.** 현재 코드는 누구나 분석 실행(POST `/api/candidates/run`)을 호출할 수 있다. 공개 배포 전에 다음을 완료해야 한다.
  - 서버: 실행 API를 관리자 인증 뒤에서만 허용하고, 동시 실행을 잠근다.
  - 화면: 관리자가 아니면 실행 버튼을 보이지 않는다.
  - 인증·권한 변경이므로 다른 계열 모델의 독립 리뷰를 받는다.
- 이 조건은 M5 전체를 기다리지 않는다. 배포 일정이 먼저 오면 이 부분만 앞당겨 구현한다.
- **관리자 인증 방식**과 **백엔드 호스팅 위치**는 이 작업 착수 전에 정한다.

### 참고
- **법적 검토:** 대학교 프로젝트이므로 사업화 전까지 보류한다. 사업화 시 유사투자자문업 해당 여부를 확인한다. 화면의 유의사항(상대 순위이며 수익 보장 아님, 투자 책임은 본인)은 정보 정직성 차원에서 유지한다.

## 10. 위험

- Tailwind의 기본 스타일 초기화(preflight)가 기존 `global.css` 화면을 깨뜨릴 수 있다. M0에서는 새 레이아웃에만 적용하고, 기존 화면은 M6까지 격리한다.
- 신호 판정 규칙(§5)이 화면의 "근거 일치도"를 결정한다. 규칙이 바뀌면 의미도 바뀌므로, 버전을 붙여 출력에 기록한다.
- 성과 기록을 실제 데이터 없이 보여 주면 신뢰를 잃는다. 데이터가 부족하면 표시하지 않는다.
- 다음 거래일 계산에는 휴장일 데이터가 필요하다. 없으면 틀린 날짜를 보여 줄 수 있다.
- 공개 서비스에서 수동 실행이 인증 없이 노출되면 비용(Gemini)과 호출 한도(KIS)를 남용당할 수 있다. 관리자 인증 전까지 공개 배포에서는 실행 버튼을 숨긴다.
- 공개 서비스는 검색 노출이 필요하다. 현재 단일 페이지 앱이라 `/about`만 정적 렌더링으로 보완한다. 검색 유입이 핵심 지표가 되면 Next.js 전환을 다시 검토한다.

## 11. M0 구현 기록 (계획과 달라진 점)

§11~14는 각 단계 완료 당시의 기록이다. 당시의 자리표시자·미구현·검토 대기·화살표 history push 언급은 현재 상태가 아니다. 현재 root/History/About와 M4 완료 상태, 최종 검증·승인 및 남은 운영 범위는 §15를 기준으로 읽는다.

- **경로 전환 시점 변경**: 새 화면이 완성되기 전에 `/`·`/dashboard`를 바꾸면 쓰던 화면이 끊긴다. 그래서 새 화면은 `/next` 아래(`/next`, `/next/rank`, `/next/watchlist`, `/next/history`, `/next/stock/:code`)에서 만들고, 리다이렉트는 새 화면이 갖춰진 뒤(M6 또는 M2·M3 완료 시점)에 한다.
- **CSS 레이어**: 레이어 밖 스타일은 모든 레이어보다 우선하므로, `global.css`를 가장 낮은 `legacy` 레이어로 넣었다(`src/styles/index.css`). Tailwind preflight는 기존 화면 보호를 위해 M6까지 넣지 않는다.
- **토큰 이름 충돌 해결**: Tailwind v4 테마 변수(`--text-*`, `--radius-*`, `--shadow-*`)가 같은 이름의 기존 토큰을 더 높은 레이어에서 덮어써, 기존 화면 11장이 모두 바뀌었다. 기존 토큰을 `--type-*`, `--corner-*`, `--elev-*`로 바꾼 뒤, 기존 화면이 기준선과 바이트 단위로 같아진 것을 확인했다.
- **color-scheme**: `:root`에 두면 기존 밝은 화면의 스크롤바와 기본 입력창까지 어두워지므로, 새 화면 래퍼(`.ds-root`)에만 적용했다.
- **shadcn 컴포넌트**: 기반(`cn`, class-variance-authority, tailwind-merge)만 넣었다. 개별 컴포넌트는 쓰는 단계(M2~)에서 추가한다.
- **검증 도구**: `npm test`(Vitest, 테마 4건), `npm run verify:a11y`(axe WCAG 2.2 AA, 가로 넘침, 24px 대상, 제목 구조 / 5개 경로 × 다크·라이트 × 1440·1280).

## 12. M1 구현 기록 (2026-10-08, 메인 검증·독립 재검토 통과)

- **새 데이터 계층**: `entities/{candidate,market,source,value,signals}.ts`, `shared/api/{client,queries,analysis}.ts`, `shared/lib/format.ts`. 원본 숫자의 누락·빈 문자열·NaN·Infinity는 null로 보존하며 기존 `pipelineAdapter.num()`에 의존하지 않는다. 원화·예측수익률(소수 단위)·시세 등락률(% 단위)·서울 시간 포맷과 누락 표시 `—`를 제공한다. 거래일 달력이 없으므로 다음 거래일은 null/미확인이다.
- **서버 호환**: `server/routes.ts`를 Vite middleware와 기존 `api/*.ts`가 함께 사용한다. 기존 배열/단일 종목/null 응답 형태를 유지하고 `data_meta`, `source`, `asOf`, `X-Data-Source`/`X-Data-As-Of`를 추가했다. 전체 순위용 `/api/rank`를 추가했으며 후보 목록으로 축소하지 않는다. refresh의 기존 POST key/GET cron 인증과 `{generatedAt, stocks}` 응답을 보존하고 Vite에도 동일 계약을 적용했다. 인증 정책 변경은 하지 않았다.
- **출처**: 파이프라인 파일은 cache이며 asOf는 파일 수정 시각이다(가격 관측 시각이 아님). fresh/stale 서버 dashboard snapshot은 HTTP 200이어도 cache이고 자식 sample/unknown을 보수적으로 집계한다. API 결과에는 `unknown`을 추가해 출처 없는 레거시 응답을 live로 추정하지 않는다. 지수 miniSeries에는 `history | interpolated | unknown`을 사용한다. 원래 시계열 출처가 없는 snapshot은 unknown이며 sample을 history로 승격하지 않는다. 기존 숫자 필드와 호환하면서 `rawValues`에 시세·지수 원본 nullable 값을 추가해, 새 소비자가 서버의 과거 0 치환에 의존하지 않도록 했다.
- **신호 규칙**: 버전 `m1-2026-10-08-v2`. 최종 후보도 원본 모델 예측값·대상 기간이 없으면 판정 불가다. 전체 순위는 원본 예측수익률 ≤0이면 부정, 양수+상위 5%이면 긍정, 그 밖은 중립이다. event overlay가 legacy final 값/순위를 보완하더라도 `rawFinalPrediction`/`rawModelRank`를 보존해 새 어댑터에서 생성값과 원본을 구분한다. 일치도는 긍정/평가 가능 신호 수이며 분모가 0이면 null/`—`다. 공개 설명 문자열도 같은 모듈에 둔다.
- **B1 뉴스 경계 수정**: 원본 `news_fusion/live.py:152~169`의 성공 상태는 `analyzed`, `no_usable_article`뿐이다. `api_key_missing`, `api_budget_reached`, `news_fetch_failed`와 unknown/누락/pending/disabled 등은 성공으로 추정하지 않는다. `unclear`/빈 기사 감성도 명시적 NEUTRAL로 바꾸지 않는다. `crolling.py:205~244, 390~393, 278~284`의 레거시 Gemini 파일은 성공 LLM 평가만 저장하지만 상태 필드가 없고 크롤링 실패를 []로 숨긴다. 따라서 빈 배열/0건 집계만으로 수집 성공을 인정하지 않는다. 비어 있지 않은 명시 LLM 집계·기사 판정은 `llm_evidence` provenance로 사용할 수 있으며 이 provenance는 실제 0건 수집을 증명하지 않는다. 키워드 감성과 모델·뉴스 종합 점수는 뉴스 신호로 사용하지 않는다.
- **수급 정의 보류**: `integrated_pipeline.py:339~374`는 외국인/기관 개별 양수일수와 `supply_data_days`, `supply_data_enough`, `supply_status`만 제공한다. 합산 순매수 일수가 없으므로 현재 원본의 수급 일관성 신호는 판정 불가다. 양수일수를 더하거나 양쪽 각각 절반이라는 다른 규칙으로 바꾸지 않는다. 금액 합계는 두 원본 값이 모두 있을 때 별도로 표시할 수 있다. 향후 합산 일수를 받더라도 금액·일수·기간·충분성·상태를 모두 검증한다.
- **경합·실행 준비**: 모든 fetch에 Query AbortSignal과 timeout을 전달한다. 종목/시세/차트(code+range) 및 후보·순위(runId) 키를 분리하고 이전 종목 placeholder를 사용하지 않는다. 실행 상태는 running에서만 5초 폴링한다. mutation은 가장 최근 요청만 실행 상태 캐시에 반영하고, 완료 시 기존 읽기를 취소한 뒤 candidates/rank/stock/dashboard를 무효화한다. M2는 `useAnalysisRun`/`useStartAnalysis`와 query options를 연결할 수 있다. API는 최신 결과만 제공하므로 runId 키는 캐시 격리용이며 과거 실행 조회 기능은 아니다.
- **검증**: mock fetch/fixture로 null/빈 API/출처/원본 누락/신호/포맷/Abort/종목 전환/요청 순서/무효화/refresh 인증 계약을 검사했다. 원본의 비수집 2상태와 성공 2상태, 레거시 Gemini의 status 없는 [] 및 unclear 기사 감성을 추가 검증했다. 서버 계약 테스트는 JS로 분리해 app/server의 TypeScript composite 프로젝트 경계를 유지한다. `npm test` 94건, `npm run typecheck`, `npm run build` 통과(최종 재실행 결과는 작업 보고 참조). 실제 분석·외부 API·브로커 호출은 하지 않았다.
- **메인 검증**: 메인이 94개 테스트·타입 검사·빌드 및 기존 5개 새 경로 × 다크/라이트 × 1280/1440 CDP·axe 검사를 별도로 재실행해 모두 통과했다. Claude 독립 재검토에서도 차단 사항이 없어 M2 착수를 승인했다.
- **후속/제한**: M0 미커밋 파일과 기존 `/`·`/dashboard`를 보존했다. 기존 서비스/화면에는 여전히 mock fallback·0 어댑터가 남아 있으며 M1은 새 계층과 서버 메타를 준비했다. 오래된 snapshot에서 이미 사라진 원본 누락값은 복구할 수 없다. 종목의 기존 합성 miniSeries는 실제 history로 표시하면 안 된다. 커밋·푸시·배포는 하지 않았다.

## 13. M2 구현·검증 기록 (2026-10-08, 메인 최종 검토 완료)

- **브리핑 연결**: `/next`만 `features/briefing/BriefingPage.tsx`로 교체했다. 분석 기준일·조회 시각, 지수별 출처/관측 시각/시계열 출처, 후보 비교표, 오른쪽 상세 패널, 첫 방문 안내 띠, 성과 기록 “수집 중”, 버전이 있는 판정 기준을 제공한다. 기존 `/`, `/dashboard`, `/stock/:code` 및 M3~M5 자리표시자는 유지한다. 거래일 달력이나 실제 성과 기록이 없으므로 다음 거래일은 미확인이며 n/20·성과 수치는 생성하지 않는다. 공개 브리핑은 분석 실행 버튼 없이 GET 상태 재접속·완료 무효화만 사용한다.
- **멤버십·경합**: URL `?code=6digit`와 종목별 쿼리 키를 사용하며 새로고침·뒤로가기·닫기 포커스를 유지한다. 성공한 후보 목록만 후보/비후보를 확정한다. 최초 조회 pending은 확인 중, 오류는 미확인이며 모델 신호를 판정 불가로 처리한다. 갱신 오류로 이전 표를 유지할 때도 표·패널 모두 현재 멤버십/모델 신호를 미확인으로 처리하고 일치도 분모를 다시 계산한다. 성공 상태에서는 후보의 원본 예측·순위·기간·멤버십이 상세 응답보다 우선하여 표와 패널이 일치한다. `DetailPanel.tsx:13`, `membership.ts:5`, `BriefingPage.tsx:59`.
- **금융 누락·출처**: 후보 []는 실제 빈 화면, 초기 오류와 이전 결과 갱신 오류는 별도 문구다. sample은 예시임을 표시한다. 분석·모델·가격과 개별 지수에 source/asOf를 표시하며 HTTP 200을 live로 승격하지 않는다. 합성 종목 시계열은 그리지 않는다. 시장 판단은 평가 가능한 지수 2개 이상의 등락률 평균에 따른 단순 판단임을 공개하며 sample/누락은 제외한다. 누락한 모델값이 예전 summary의 Huber 0% 문장으로 나타나지 않도록 패널에서 검증된 누락 안내로 대체한다. 이벤트 overlay의 누락 `final_score`, `news_delta`, `accepted_events`도 input/key points/summary에서 null/미확인으로 보존하며 ensemble을 final 값으로 대입하지 않는다. meta.newsTally의 명시적 null은 이전 입력·문구의 집계로 덮지 않는다. `DetailPanel.tsx:41`, `MarketOverview.tsx:6`, `server/pipelineResults.ts:577`, `entities/candidate.ts:66`.
- **디자인·접근성**: 확정 토큰, Pretendard, Lucide, 22px 카드와 중립 근거 막대를 유지했다. 패널은 데스크톱 380px(1280에서는 360px), 작은 폭에서는 스택이다. 비교표는 native table/button이며 Enter/Space, ArrowUp/Down/Home/End를 지원한다. 선택됨·신호 상태는 텍스트와 아이콘으로 표시한다. 버튼 접근 가능한 이름은 화면의 종목명·코드·선택 상태에서 자연스럽게 생성한다. 작은 보조 글자는 문맥에 맞게 기존 `--ds-fg-2`를 사용하여 라이트 배경 대비를 확보했고 토큰 값은 변경하지 않았다. 브랜드와 페이지 제목은 `BRAND_NAME`을 공유한다. 라우트 포커스는 MutationObserver와 cleanup으로 실제 main 마운트를 기다리며 30프레임 제한을 제거했다. `CandidateTable.tsx:11`, `briefing.css:8`, `app/routeFocus.ts:2`.
- **시안·스킬 근거**: 저장소에서 `workspace-v3-toss.html`을 찾지 못해 본 계획 §7과 기존 M0 토큰을 기준으로 구현했다. ui-ux-pro-max 로컬 검색의 React effect cleanup/dependency·키보드 포커스 조언만 적용했다. 마케팅 스타일 검색 결과로 확정 시안을 교체하지 않았으며 React 19 useEffectEvent도 사용하지 않았다.
- **단위·계약 검증**: 실제 mock fetch/fixture로 종목 전환 Abort/늦은 응답, deeplink/뒤로가기/닫기 포커스, [] 대체, 초기·갱신 오류, pending/error/성공 [] 멤버십, 표·패널 모델 일치, sample/history/interpolated 출처, 누락 모델 prose 0 방지, null 집계·이벤트 값 보존, 누락 등락률 중립 색상, GET 완료 무효화를 검사했다. `npm test` **115개/11 suite 통과**, `npm run typecheck` 및 `npm run build` 통과. 메인도 최신 115개 테스트·타입 검사·빌드를 확인했다. Sonnet 독립 M2 재검토와 Opus 최종 검토 모두 차단 사항이 없어 코드 완료를 승인했다.
- **실제 브라우저 검증**: 기존 설치 Edge/Chrome으로 dist+localhost fixture 전용 서버를 실행하는 `scripts/verify/m2-smoke.mjs`를 작성했다. 50개 검사 통과: 클릭·네이티브 Enter/Space/Arrow 선택, A→B/늦은 A, deeplink/reload/back, 닫기 포커스, 소개 띠/테마 저장, 1.3초 늦은 lazy route main 포커스, []/오류/멤버십 경계, sample/cache/interpolated 출처, GET running→completed 무효화와 refresh 경합·폴링 종료, 모델 누락. 실제 후보 5개+상세 패널에서 1440/1280 × dark/light와 375px light 스택의 axe WCAG 2.2 AA 위반 0·가로 넘침 0·24px 대상·제목 구조 통과. console.error/미처리 예외 0, 제품 API 109회 모두 fixture GET. Enter 실패는 CDP 문자 입력 누락이 원인이었으며 Enter의 carriage-return 입력을 보완해 통과했다.
- **재현·산출물**: FE에서 `npm run build` 후 `node scripts/verify/m2-smoke.mjs`. 포트는 자동 할당하며 메인 fixture 서버를 중지하지 않는다. `artifacts/m2/report.json`과 `README.md`, `m2-1440-dark.png`, `m2-1440-light.png`, `m2-1280-dark.png`, `m2-1280-light.png`를 생성했다. 4개 이미지를 직접 확인했고 모두 결정적 fixture 화면이다. 실패하면 실제 requests/console/URL/선택 코드/activeElement 및 `failure.png`를 남긴다. 동일 산출물에 쓰는 harness는 동시에 실행하지 않는다.
- **메인 최종 재현 확인**: 메인의 독립 `m2-smoke` 재실행도 exit 0/ALL PASSED였다. 최신 보고(2026-10-08 21:23 KST)는 50개 검사·5개 populated axe 조건·4개 PNG·fixture GET 109회이며 오류/예외 0이다. 메인이 4개 PNG를 직접 열어 확인하고 115개 테스트·typecheck·build·git diff --check도 통과했다. Sonnet/Opus 독립 검토 통과와 메인 완료 승인까지 확인했다.
- **남은 정책 권장·기존 한계**: (1) 확정 규칙상 원본 예측값이 있는 최종 후보는 음수여도 모델 긍정이 가능하다. M3 전에 기준 정책을 검토하되 이번 작업에서 자동으로 규칙을 바꾸지 않았다. (2) final 값이 누락된 행의 서버 정렬은 ensemble fallback을 사용하므로 서로 다른 점수 기준이 혼합될 수 있다. (3) completed 상태로 최초 접속할 때의 무효화 및 중복 무효화 가능성, 화살표 선택마다 history push하는 동작, 레거시 경로의 포커스 한계는 후속 검토 대상으로 남긴다. (4) rawValues가 없는 오래된 캐시에서 이미 0으로 치환된 원본 누락값은 복원할 수 없다. (5) 현재 원본에는 combined_positive_days가 없어 실제 수급 일관성 신호는 판정 불가다. (6) 공개 배포 전 분석 POST의 관리자 인증과 실행 호스트 결정을 반드시 완료해야 한다. 실제 KIS/Vercel 연동은 검증하지 않았다.
- **미검증 경계**: 실환경 API·유료 분석·실제 브로커는 검증하지 않았다. fixture 서버는 FE/server를 import하지 않으며 제품 POST와 외부 네트워크를 차단한다. Python/outputs/비밀/인증/운영/루트 설정 변경이나 커밋·푸시·배포는 수행하지 않았다. 기존 dirty는 보존했고 M3~M5는 구현하지 않았다.

## 14. M3 구현·검증 기록 (2026-10-09, 구현·메인 검증 완료)

- **종목 리포트**: `/next/stock/:code`를 `features/stock/StockReportPage.tsx`로 교체하고 브리핑의 전체 리포트 링크를 연결했다. 종목명·가격·출처/asOf, 분석 기준일, 원본/최종 보정 예측수익률과 각각의 순위, 모델/뉴스/수급 신호·일치도·규칙 버전, 수급 원본, 기사별 LLM 감성과 reason/description을 표시한다. 후보 멤버십은 M2의 pending/unknown/candidate/nonCandidate 4상태를 공유하며 후보 모델 원본을 표·패널·리포트에서 우선한다. 종목 컴포넌트와 query key를 code별로 분리해 이전 종목 응답을 표시하지 않는다. 잘못된 코드는 fetch 없이 안내한다. 기존 `/`, `/dashboard`, `/stock/:code` 및 M4/M5 자리표시자는 유지한다.
- **원본·금융 경계**: 최종 순위는 additive `data_meta.rawFinalRank` 또는 명시적 `input_row.final_rank`만 사용하며 pred_rank로 추정하지 않는다. 원본 누락은 `—`이고 생성된 legacy 요약 대신 검증된 값으로 설명한다. 최종 후보의 모델 긍정은 선정 멤버십을 뜻하므로 음수 원본도 긍정일 수 있다는 기존 정책을 설명하며 음수 숫자는 파랑으로 표시한다. 다음 거래일은 달력 미제공으로 미확인, 합산 순매수 일수 미제공으로 수급 일관성은 판정 불가, 성과 기록은 수집 중이다. 예측과 가격 이력을 실현 성과나 확률로 표현하지 않고 분석 실행 UI도 제공하지 않는다.
- **가격 이력**: `ReportChart.tsx`는 기존 legacy 차트 네트워크/fallback 대신 queries.chart(code, range)를 사용한다. 6개 기간과 종가선/캔들 모드, 키보드 관측 탐색·텍스트 대체를 제공한다. 서버의 legacy 값은 유지하면서 raw OHLC·rawTime/rawDate·rawPrices를 추가했다. 날짜/HHmmss/양수 가격/OHLC 관계를 검증하며 누락 시간이나 보완 OHLC를 실제 관측으로 승격하지 않는다. 종가 결측을 legacy filter 이전 rawPrices에 남겨 일별·분봉·파생 기간에서도 선을 분리하고 제외 개수를 알린다. sample/unknown 출처는 실제 이력 차트로 제공하지 않으며 자식 sourceStock 출처도 보수 집계한다. 범위 전환 pending에는 이전 차트를 표시하지 않는다.
- **뉴스·접근성**: 원본 unclear/빈 감성은 미확인이고 키워드 추정이나 HTML 렌더를 하지 않는다. 기사 링크는 자격 증명 없는 절대 http/https URL만 허용하고 `noopener noreferrer`를 사용한다. 원본 reason/description은 텍스트로 보존한다. 기존 Pretendard·토큰·Lucide·22px 카드를 사용하며 375px에서는 스택으로 표시한다. 기사 링크의 실제 클릭 높이는 26px로 보완했다.
- **단위·계약 검증**: `npm test` 156건/13 suites, `npm run typecheck`, `npm run build`, `git diff --check` 통과를 확인했다. 메인도 156건과 build 및 populated 1280/1440 × dark/light axe/overflow/24px 대상/heading을 직접 재확인했다. mock upstream의 정상→종가 결측→정상이 adapter와 리포트까지 2개 segment가 되는 일별·분봉·파생 범위 계약, raw 시간/OHLC, final 순위, URL guard, 원본 뉴스, pending/error/nonCandidate, Abort·종목/범위 경합과 결측/출처를 검사했다. M2 smoke 회귀도 메인에서 ALL PASSED였다.
- **브라우저 검증·클릭 보완**: FE에서 `npm run build` 후 `node scripts/verify/m3-smoke.mjs`로 재현한다. 메인 직접 재실행(2026-10-09 00:11 KST, report generatedAt: 2026-10-08T15:11:46.320Z)은 exit 0/ALL PASSED, 61개 검사·5개 populated axe 조건(1280/1440 dark/light 및 375 light)·4개 full PNG·fixture GET 139회·console/exceptions/외부 요청 0이다. 실제 클릭·키보드, A→B 지연 stock/quote/chart, 빠른 범위 전환, reload/back/main focus와 각 오류 경계를 검증한다. 관측 탐색은 클릭/ArrowRight 전후 실제 일시·가격 변화로 확인한다. 메인의 링크 클릭 실패를 로컬 smooth 스크롤로 재현했다(기존 클릭 y=2430, 화면 높이 900). 공통 CDP 클릭은 instant 스크롤 후 두 프레임의 안정된 rect와 elementFromPoint 포함 여부, hover 후 좌표를 재확인한 다음 실제 mouse press/release를 수행하며 최대 5회만 재획득한다. B 패널과 정확한 href를 확인하고 클릭 뒤 URL 전환을 기다린다. DOM click 대체나 timeout 증가는 하지 않았다. 공통 CDP 클릭 보완 이후 메인 M2 회귀 50개 검사도 PASS(보고시각 00:13 KST)했다.
- **산출물·검토 상태**: `artifacts/m3/report.json`, `README.md`, `m3-{1440,1280}-{dark,light}.png`를 생성했다. 메인이 최종 M3 실행 exit 0/61개 검사 PASS와 4개 PNG를 직접 확인했고, 모두 fixture 화면이다. 공통 CDP 클릭 보완 이후 M2 회귀 50개 검사, 전체 156 tests, typecheck, build, diffcheck도 직접 확인해 PASS했다. 읽기전용 코드 재검토에서는 B1 해소, 새 차단 없음, 관련 85개 테스트 직접 PASS를 확인했다. Claude 한도로 동일 Codex 계열 fallback 검토였으며, 독립 모델의 최종 승인이나 외부 배포 승인으로 단정하지 않는다. 추가 감사는 당시 사용량 한도로 중단됐으나, 2026-10-09 13:19 Claude Opus 읽기전용 최종 검토에서 승인됐다. 차트 요청 기간 coverage 보완은 M4에 반영한다. 실패 시 실제 요청·콘솔·URL·선택 코드/범위·activeElement와 failure.png, 클릭 좌표/재획득 진단을 남긴다. 동일 artifacts에 쓰는 harness는 동시에 실행하지 않는다.
- **미검증·보존**: 실제 KIS/Vercel·유료 분석·브로커·외부 기사 방문은 검증하지 않았다. 브라우저는 dist와 localhost fixture만 사용하며 제품 POST/외부 네트워크를 차단한다. raw 메타가 없는 오래된 캐시의 누락 원본과 관측 시각은 복원할 수 없다. M4/M5와 root 전환은 구현하지 않았고 기존 dirty를 보존했다. Python/outputs/비밀/인증/운영/루트 설정 변경, 커밋·푸시·배포는 수행하지 않았다.

## 15. M4·웹 프런트엔드 로컬 기술 완료 (2026-10-09, 메인 검증·Sonnet 코드 검토·Opus 최종 승인 완료)

- **전체 순위**: `features/rank/{RankPage,RankTable,rankData}`는 `queries.rank()`의 전체 집합만 사용한다. 199개 fixture를 20행씩 10페이지로 표시하며 이름/코드 검색, 후보/양수/0 이하/누락 필터와 native 정렬 버튼·`aria-sort`를 제공한다. 양방향 정렬 모두 null은 마지막이고 실제 0/음수는 보존한다. 예측 열의 첫 정렬은 내림차순, 이름/순위는 오름차순이다. 원본 모델 순위와 최종 보정 순위를 구분하며 화면 순서를 순위로 생성하지 않는다. 성공 []를 후보 5개로 보충하지 않는다. 최초 오류·이전 결과 갱신 실패·sample과 source/asOf를 구별한다. TanStack Table은 offline 캐시가 없었고 온라인 설치는 자동 승인 검토에서 거절돼, 추가 의존성 없는 native table로 계획을 조정했다.
- **근거·멤버십**: 후보 목록 확인 전/실패 시 모델 신호는 판정 불가다. 성공한 후보의 모델 원본은 표·패널·리포트에서 우선한다. 최종 후보 외 종목에도 실제 LLM 뉴스가 있으면 그대로 평가하며, 후보 멤버십을 뉴스 수집 여부로 사용하지 않는다. 원본 뉴스 근거/수집 성공이 없는 경우만 미분석·수집 미확인으로 표시한다. 확정 신호 규칙과 버전은 변경하지 않았다. 합산 순매수 일수가 없어 실제 수급 일관성은 여전히 판정 불가다.
- **관심 종목**: `shared/lib/watchlist.ts`는 기존 `kospi-watchlist.v1` 문자열 배열을 정제·중복 제거하며 의도한 []를 보존하고 기본 예시를 자동 저장하지 않는다. 같은 탭 상태 공유와 실제 다른 탭의 localStorage 변경/clear를 동기화한다. sessionStorage 이벤트는 무시하며 저장 권한/용량 실패는 현재 탭에서만 유지한다고 안내한다. 전체 순위에 없는 저장 코드도 이름 미확인 행·리포트 링크·삭제 버튼으로 남긴다. 조회 중/초기 실패/이전 결과 갱신 실패를 확인된 분석 미제공과 구분한다. 순위·검색·브리핑·리포트의 별 버튼은 고정 접근 가능한 이름과 `aria-pressed`로 같은 저장소에 연결된다.
- **전역 검색·접근성**: `features/search/SearchDialog.tsx`는 자체 trigger와 Ctrl/⌘K, native dialog, 포커스 순환, Escape/버튼/배경 닫기와 실제 포커스 복원을 제공한다. 입력/IME 중 단축키를 가로채지 않고 경로·뒤로가기 변경 시 복원 없이 닫아 main 포커스를 유지한다. 검색은 전체 순위만 사용하며 최초 실패를 0종목으로 표시하지 않는다. legacy `.search-results`/`.search-empty`와 겹치던 이름은 `.stock-search-results`/`.stock-search-empty`로 분리했고 결과 링크가 모달 안에 실제로 보이며 클릭 지점에 있는지 검사한다. shortcut 힌트는 버튼 밖 형제로 두어 accessible name 충돌을 해소했다. 새 리포트 버튼도 `.stock-report-button`으로 분리해 기존 `.report-button`을 건드리지 않았다. 확정 토큰·Pretendard·Lucide·22px 카드를 유지했으며 ui-ux-pro-max의 키보드/포커스 조언만 적용했다.
- **M3 추가 감사 R1**: 차트 range에 additive coverage 메타(요청/제공 기간, requested/subset/fallback, partial/unverified/empty, 실제 관측 시작/끝)를 추가했다. legacy 관측 배열은 유지한다. 5Y 요청에 1Y 원본이 대체되면 부분 제공과 실제 범위를 공개하고 전체 5년 이력으로 표시하지 않는다. 거래일 달력이 없으므로 직접 조회 성공만으로 전체 관측 완전성을 확정하지 않는다. mock upstream → 서버 → adapter → ReportChart 계약 테스트로 검증했다. 1D 선 명칭은 가격선이며, “다른 기간으로 자동 전환하지 않는다”는 부정확한 문구는 실제 제공 범위/부분 제공 확인 안내로 교체했다.
- **연결·fixture**: 브리핑 화살표 선택은 history replace, 일반 클릭은 push하여 뒤로가기를 유지한다. root/next 링크는 통합 작업자의 `useAppPaths()`를 사용한다. fixture 서버는 후보 5개와 독립된 199개 rank, 실제 cross-tab 저장 테스트 전용 페이지, 정적 directory/index.html 서빙을 제공한다. M2 smoke의 오래된 순위 자리표시자 assert만 실제 RankPage 제목으로 갱신했다. App/AppShell/history/about/경로 통합은 별도 작업자 소유이며 직접 수정하지 않았다.
- **최종 단위·빌드**: 메인 직접 `npm test` 219건/22 suites PASS(2026-10-09 14:09:10 KST), `npm run build`의 tsc+Vite PASS(14:09), CDP 요청 상관관계 테스트 4건 PASS, `git diff --check` 오류 0을 확인했다. 제품 코드 동결 후 변경은 하네스 C1과 본 문서뿐이며 제품 코드 추가 변경은 없다.
- **M4 브라우저**: 메인 직접 `node scripts/verify/m4-smoke.mjs` exit 0, 122 checks, populated rank/search/watchlist × 375/1280/1440 × dark/light의 axe 18조건 위반 0·넘침 0·24px 대상·제목 구조 PASS. 199행 양방향 정렬, 실제 cross-tab 변경/clear, 저장 실패, 검색 포커스 순환/닫기/뒤로가기/비후보 실제 클릭, 오류/[]/sample/이전 결과, 모델 멤버십, 5Y 부분 제공과 화살표 replace를 확인했다. 최종 `artifacts/m4/report.json` generatedAt 2026-10-09T05:06:38.019Z, fixture API GET 75회, 전체 순위 desktop 4PNG와 검색 2PNG다. 작업자가 6PNG를 직접 확인했고 메인도 최종 rank light/search dark PNG를 직접 확인했다. 모두 fixture이며 실제 금융 결과가 아니다.
- **IME 검증 경계**: 브라우저에서 CDP 조합 시작 중 Escape가 검색을 닫지 않는 것과 닫기/재열기 후 정상 Escape를 확인했다. 이 Edge의 CDP 조합 취소는 compositionend를 발생시키지 않아 OS IME 완료는 미검증이다(`report.imeLimitation`). compositionEnd 뒤 Escape로 닫히는 경로는 별도 단위 테스트로 확인했으며 브라우저 PASS로 승격하지 않는다.
- **M2/M3 최종 회귀**: C1 반영 후 메인이 순차 재실행해 M2 exit 0/50 checks/axe 5조건/API GET 110회, M3 exit 0/61 checks/axe 5조건/API GET 139회 PASS. 최종 `artifacts/m2/report.json` generatedAt 2026-10-09T05:08:36.837Z, M3 2026-10-09T05:09:36.077Z다. 메인이 최종 M3 report dark PNG를 직접 확인했다. 브라우저·fixture 서버는 모두 종료했다.
- **site 최종 메인 증거**: C1 반영 후 메인 직접 `site-smoke` exit 0/221 checks, `artifacts/site/report.json` generatedAt 2026-10-09T05:10:09.029Z. root 검색 포함 axe 44조건 위반 0·layout 40조합·keyboard 10·no-JS about dark/light·404 noindex/복원·theme 저장 PASS. API GET 146회, 27PNG를 생성했고 fixture port 62121은 closed:true다. root 브리핑·전체 순위·관심·History·About와 legacy 별칭의 프런트엔드 연결을 완료했다.
- **최종 브라우저 합계**: 네 보고서를 직접 읽어 총 454 checks·axe 72조건 PASS를 확인했다. 모든 보고서의 `exceptions`, `consoleErrors`, `blocked`, `cancelledInterceptions`, `interceptionErrors`는 각각 0이며 제품 API는 모두 fixture GET이다. 이 수치는 같은 fixture를 반복/조건별로 검사한 기술 검증이고 실제 금융 성과나 실환경 API 검증이 아니다.
- **하네스 C1·한계**: 모든 M2/M3/M4/site 하네스가 판정 직전과 finally에서 `settleInterceptions()`를 기다리고 `cancelledInterceptions`/`interceptionErrors`를 저장한다. 공통 CDP는 동일 networkId의 `Network.loadingFailed(canceled=true)`로 확인된 Invalid InterceptionId 경합만 별도 기록하며, 다른 요청/취소 미확인/다른 CDP 오류는 실패를 유지한다. 최초 실패는 요청 식별자 없이 메시지만 저장돼 원인을 확정할 수 없다. 수정 후 최종 네 실행에서 별도 분류/제외된 오류는 0이며, 오류를 무시해 PASS한 결과가 아니다.
- **검토·최종 승인**: Sonnet 코드 검토와 Claude Opus 최종 승인에서 제품 코드·하네스 차단 사항 0을 확인했고, 메인의 최종 검증까지 완료했다. 승인 범위는 “웹 프론트엔드의 로컬 기술 완료”이며 외부 배포 승인이 아니다. 리뷰어는 코드와 네 report를 직접 읽고 C1 후 진단 필드 0을 확인했다. 리뷰어가 테스트/하네스를 직접 실행하거나 PNG를 직접 검사한 것은 아니며, 실행·이미지 근거는 위 메인의 직접 검증을 인용했다.
- **재현 명령·남은 범위**: FE에서 `npm run build` 후 `node scripts/verify/m4-smoke.mjs`, `node scripts/verify/m2-smoke.mjs`, `node scripts/verify/m3-smoke.mjs`, `node scripts/verify/site-smoke.mjs`를 순서대로 실행한다. 다른 harness/build와 동시에 실행하지 않는다. 실제 KIS/Vercel·유료 분석·브로커·외부 기사·OS IME 완료는 미검증이다. M5는 현재 계약의 기록 UI와 미제공 상태만 포함하며 공식 로그/20거래일 실현 성과·Python 자동화는 완료가 아니다. 공개 배포 전 legacy 실행 UI를 포함한 분석 POST 관리자 인증과 운영 host 결정이 필수다. rawValues 없는 오래된 캐시의 누락 원본, final 누락 시 서버 ensemble fallback 정렬 혼합, 초기 completed/중복 무효화 정책은 남아 있다. 기존 dirty를 보존했고 커밋·푸시·배포는 하지 않았다. 메인이 로컬 dev http://127.0.0.1:5173 을 시작했으며 HTML serving 확인 예정으로, 실제 제품 GET/API 검증 완료를 뜻하지 않는다.

## 16. 로컬 백엔드·모델 전용 연결 기록 (2026-10-09, 메인 검증·Codex 최종 감사 완료)

- **모델 전용 실행(`model_only`)**: 사용자 Gemini 0, 모델 1회 승인 하에 메인이 직접 `POST /api/candidates/run`을 실행했다(18:37:55~18:38:15 KST, 약 20.751초 model runtime). 디스크 marker에는 20.744초로 기록되었다(런타임 측정과 marker 계측 구분). CSV 199 ok, 기준일 2026-10-08, prediction_target은 `next_session_open_to_close`, selection 5개, 수급 ok 5개를 확인했다.
- **데이터 계약 및 로컬 연결 상태**: `KIS_ENV=mock` 환경에서 실제 quote 001800 22,550원 live, 3개 지수 live, 391개 분봉(10/8 관측, coverage unverified)을 수신했다. `GET /api/rank`는 199개 종목을 cache로 보존한다(asOf 18:38). 상위 5종목만 수급 8개 raw fields를 연결했고 그 외 194개는 미측정이며 stock과 rank의 값이 일치한다. 원본에 `combined_positive_days`가 없으므로 null로 보존하고 신호는 판정 불가(`signal unavailable`)를 유지한다. 뉴스는 skipped(`--run-news` 생략, collected: false), final pred/rank는 null, candidates는 `not_produced` 상태이며 잘못된 nonCandidate 분류를 방지한다. 새 `GET /api/backend/status`는 읽기 전용으로 비밀·절대 경로·error 원문을 노출하지 않고 설정(`configured`)과 실제 검증(`verified`)을 구별하며 `no-store`를 적용했다.
- **사고 복원 및 단위·빌드 검증**: 요청하지 않은 작업자 변이 실험 중단 과정에서 marker startedAt 조건(745/976) 삭제 사고가 발생했으나(18:47), SHA `4264713CB050B9B9086615C830D1B0636D14DBA7AE2B4F50CD5776100E24C4F1`로 복원했다. 분석 run 종료 이후 발생하여 산출물은 불변임을 확인했고, 중간 UI 증거는 제외하고 원복 후 actual report로 대체했다. 임의 변이 실험은 엄격히 금지 후 재검증했다. 원복 후 메인 직접 `npm test` 345 tests(27 files) PASS(18:53:41), `npm run build` PASS(18:54), `git diff --check` 오류 0을 확인했다. 최초 실행 시 cold 라우트 test timeout 2건이 발생했으나 단독 `maxWorkers=2`로 재실행하여 전체 PASS했다. 초기 actual quote 40초 지연 원인은 미확정이며 최종 재검증 성공을 기록했다.
- **브라우저 검증 및 산출물 (actual report)**: model-only fixture 33개 검사·axe 5조건·GET만 사용·console/exceptions/blocked 0을 확인했다(최종 빌드 후 09:55~). actual `artifacts/backend-live/report.json`은 generatedAt 2026-10-09T09:56:30.285Z, fixtureOnly: false, passed: true, pages 4/4 axe 0, browserClosed: true다. 실제 GET rank 199, supply 5, stock price + chart + raw supply, history 완료 marker, briefing live indices를 확인했다. 메인이 새 PNG 4종(stock, briefing, history 등)을 직접 열어 확인했다. `cancelledInterceptions` 2건이 발생했으나 각각 동일 networkId의 `canceled: true`로 확인된 정상 취소로 별도 기록했다. `consoleErrors`, `exceptions`, `blocked`, `interceptionErrors` 0은 맞으나 취소까지 모두 0이라 단정하지 않으며 메인이 두 건의 /api/rank 및 /api/backend/status 요청에서 동일 networkId와 canceled:true를 직접 확인했다. 수급 overlay 이전 메인 M2/M3/M4/site 총 454 checks·axe 72조건 PASS는 프론트엔드 기술 회귀 증거 범위로 보존하며 수급 overlay 증거와 구분한다.
- **검토 및 감사 판정**: Sonnet 수급 코드 차단 0, Opus 실행 전 + overlay 코드 승인을 완료했다. 최종 actual report 확인 전에 Claude 전원이 23시까지 한도 소진되어 동일 계열의 실행 전 리뷰 한계와 구분한다. Codex 주 구현(b8694) 읽기 전용 최종 fallback 감사를 완료하여 차단 사항 0, 로컬 백엔드 연결 완료로 판정했다(기존 승인 대기 문구 해소). 단, b8694는 초기 model_only 구현에 관여했으므로 완전한 독립 리뷰어가 아니라는 한계를 명시한다. Claude가 작성한 수급 overlay 코드와 최종 actual report 및 4개 PNG를 직접 읽고 검토했다. 345 tests, build, diff, API 1회, Gemini 0은 메인 직접 실행 및 인용으로 구분하며, 이는 Opus의 최종 actual 보고서 승인은 아니다.
- **운영 경계 및 미검증**: 뉴스 0(skipped) 승인에 따라 미실행을 유지한다. 공식 성과 백엔드와 거래일 달력, KIS 실전(real) 환경 및 Vercel 배포는 미검증이다. 무인증 analysis POST 및 legacy UI 운용 gate를 보존한다. 메인이 로컬 127.0.0.1:5173을 운용 중이며 실거래 주문, 배포, 커밋, 푸시는 일절 수행하지 않았다.
