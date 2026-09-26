# 뉴스 해석과 최종 선정을 분리한 연구 파이프라인

기존 Huber 가중치를 유지하고, 뉴스 분석 결과를 정해진 수식으로 결합하는 별도 연구 경로입니다.
기존 `--run-news`의 자유로운 LLM 종합점수와 구분합니다. 이번 변경은 기존 웹 화면이나 기존
`--run-news`를 자동으로 교체하지 않습니다. 결합 모델이 검증되기 전에 서비스 선정 결과를 바꾸지 않습니다.

## 구현 범위

1. Huber 전체 예측 순위 또는 기존 STEP2 CSV 입력.
2. 기간을 지정한 뉴스 제목 수집, 검색 원문 XML 및 출처·수집 시각 저장.
3. Gemini를 한국어 기사 정보 추출기로 사용. 가격 순위·예측수익률·실제 수익률은 전달하지 않음.
4. 감정, 기업 관련성, 사건 종류, 원문 근거를 스키마로 검증. 근거 문장이 원문에 실제 존재해야 함.
5. 기사 중복 제거·시간 필터·24시간 감쇠를 적용한 종목별 지표 계산.
6. 과거 시점별 가격 예측과 뉴스 지표로 작은 ridge 회귀 결합기를 학습.
7. 가격 상위 20개 안에서 최종 Top-5, 각 변수 기여도와 근거 기사 ID 출력.
8. `portfolio_replay.py`의 기존 1,000만원, 편도비용 0.125%, 보유 종목 유지·이탈 종목 교체 엔진 연결.

Gemini 감정값은 텍스트 분류이며 상승확률이 아닙니다. 이번 버전은 Gemini가 감정과 사건을
함께 추출합니다. KR-FinBERT를 다운로드하거나 검증한 버전은 아닙니다. 사건 분류는 감사 기록에
보존하되 초기 결합기의 입력에는 넣지 않아 작은 특징 집합으로 시작합니다.

최종 결합 입력은 `price_z`, `sentiment`, `negative_share`, `news_volume`, `news_missing`입니다.
뉴스 감정은 긍정 1/중립 0/부정 -1, 기업 관련성이 직접이면 1/간접이면 0.5, 시간 감쇠 가중 평균입니다.
근거 부족·대상 기업 불명은 점수에서 제외합니다. 동일 기업/날짜의 정규화 제목 중복만 제거하므로
다르게 작성된 유사 기사까지 완전히 제거하지 못합니다. 시간 감쇠·관련성 가중치는 초기 설계값이며
검증된 최적값이 아닙니다. API 실패나 미처리 기사를 중립 판정으로 위장하지 않습니다.

## 설치와 키

```bash
pip install -r requirements-news.txt
```

로컬 `.env.news_fusion`에 `GEMINI_API_KEY=...`를 저장하거나 환경변수를 사용합니다.
`.env.*`는 Git에서 제외됩니다. API 키는 Google 인증 헤더에만 전달하며 결과·예외에 출력하지 않습니다.
호출 수는 실행별 `--max-calls`로 제한됩니다. 429/인증 오류/잘못된 응답이 나면 즉시 중단하며
자동 재시도, 다른 모델로 교체, 요금제 전환을 하지 않습니다. 이후 같은 명령을 명시적으로 실행하면
검증된 캐시를 재사용합니다. 이 코드는 계정의 무료 등급 여부를 알아내거나 비용을 보장하지 않습니다.

## 과거 기사 수집

기업 목록 JSON 예시: `{"005930":"삼성전자","000660":"SK하이닉스","005380":"현대차"}`.

```bash
python -m news_fusion collect --companies companies.json --start 2026-05-29 --end 2026-09-15 --out outputs/news_fusion --window-days 7
python -m news_fusion extract --articles outputs/news_fusion/articles.json --out outputs/news_fusion --max-calls 3
```

Google News RSS는 기사 발견용 표본입니다. 전체 뉴스 아카이브가 아니며 본문 전문도 제공하지 않습니다.
날짜 검색 조건을 다시 로컬에서 검사합니다. 100건에 닿은 검색은 잘림 가능성을 표시합니다.
0건도 실제 기사 부재의 증거가 아닙니다. 더 좁은 날짜 구간 또는 별도 과거 뉴스 데이터 공급원이 필요합니다.
기존 검색 산출물은 덮어쓸 수 있으므로 다른 수집 범위는 별도 `--out` 디렉터리를 권장합니다.

## 시간 정책

- 기본 `strict`: 해당 시점 이전에 실제로 수집한 텍스트만 사용. 현재 발견한 과거 기사는 과거 거래에 사용하지 않음.
- `exploratory`: 과거 게시 시각을 가정한 탐색. 정확한 시각을 확인하지 않은 RSS 기사는 다음 달력 날짜 0시 이후만 사용.
- 양쪽 모두 결정 시각 이후 기사, 결정 시각 이후 수정된 것으로 확인된 기사, 3일 조회 범위를 벗어난 기사를 제외.
- RSS의 수정 여부는 대부분 미상. 보수적인 날짜 지연만으로 원본 버전 누수를 제거하지 못함.
- `original_version_verified`는 수집 출처의 감사 항목일 뿐, 현재 수집한 본문을 과거 스냅샷으로 인정하는 우회 옵션이 아님.
- 기본 결정 시각은 매수일 08:30 KST. 분류 모델이 과거 사건을 사전학습했을 수 있다는 한계는 별도이며 이 필터가 해결하지 못함.

## 원문 수집과 본문 분석 (추가)

제목 수집 다음에 언론사 원문 수집 단계를 실행할 수 있습니다.

```bash
python -m news_fusion bodies --articles outputs/news_fusion/sample_articles.json --out outputs/news_body --limit 12
python -m news_fusion extract --articles outputs/news_body/body_articles.json --out outputs/news_body --max-calls 9
python -m news_fusion features --predictions predictions.parquet --articles outputs/news_body/body_articles.json --extractions outputs/news_body/extractions.json --mode exploratory --out outputs/news_body
```

Google News 주소는 공개 링크 해석 라이브러리로 언론사 주소를 찾습니다. 공개 HTML만 요청하며
로그인·유료벽·접근 차단을 우회하지 않습니다. HTML 원본, 내용 해시, 게시/수정 시각 후보,
RSS 시각과 언론사 시각, 추출 방식 및 실패 사유를 기록합니다. 구조화된 본문, articleBody 영역,
언론사 본문 영역, Trafilatura 순으로 본문을 추출합니다. 광고·연관기사 영역을 제거합니다.
제목 일치, 본문 최소 길이, 한국어 본문, 게시 날짜 충돌을 검사합니다. 자동 검사가 완전한 본문
추출을 보장하지는 않으며 동영상·이미지 속 내용은 포함하지 않습니다.

본문이 없거나 시각이 충돌한 기사를 제목으로 대체하지 않습니다. 지표 생성 시 제목 전용과
본문 자료를 섞으면 오류가 발생하며, 결합 학습·평가의 텍스트 범위도 같아야 합니다.
현재 페이지의 게시 시각은 `publisher_declared`로 기록하며, 과거 당시의 원문이 확인된 것으로
승격하지 않습니다. 수정 시각이 평가 시점 이후인 본문은 그 시점 예측에 사용하지 않습니다.

Gemini 입력은 추출된 제목+본문 전체입니다. 기존 4,000자 자동 잘림을 제거했습니다.
30,000자를 초과하면 자동 축약하지 않고 명시적으로 실패합니다. 입력 길이·해시·잘림 여부를
호출 기록에 남깁니다. 프롬프트 버전이 변경되어 이전 제목 분석 캐시는 재사용하지 않습니다.

근거 인용은 원문 부분 문자열인지 검사합니다. 공백·줄바꿈만 달라진 경우에는 모든 비공백
문자가 일치하는 원문 구간으로 복원하고 원래 모델 인용과 복원 방식도 저장합니다. 단어가
바뀌거나 원문에 없는 인용은 거부합니다. HTTP 성공 후에도 응답 형식·근거 검증에 실패하면
중단하고 원인을 로컬 감사 파일에 남깁니다. 이것은 API 할당량 초과와 구분합니다.

같은 표본의 제목과 본문을 동일 모델·동일 프롬프트로 비교할 수 있습니다.

```bash
python run_news_body_feasibility.py --predictions /path/to/validation_report/predictions.parquet --max-calls 18
python -m unittest discover -s tests -p "test_news*.py" -v
```

`outputs/news_body/report.html`에는 제목/본문 감정 변화와 원문 링크, 시간 제한을 표시합니다.
감정 변화가 더 정확한 분석이나 더 높은 투자 수익을 의미하지는 않습니다. 수익률 검증은 별도입니다.

### 2026-09-24 본문 표본 실행 결과

2026년 6~9월 세 기업 월별 기사 12건 중 본문 9건을 확보했습니다. 본문 미확보 1건,
게시 날짜 정보 충돌 2건은 제외했습니다. 확보한 9건은 제목 전용 및 제목+본문 조건으로
각각 Gemini 분석을 완료했으며, 추출 본문 길이는 819~3,255자이고 입력 잘림은 없었습니다.
2건의 감정 분류가 달라졌지만 그중 1건은 평가 종료 후 수정되어 과거 지표에서 제외됐습니다.
분류가 달라진 기업 홍보 기사가 투자 예측에 유효한지는 검증하지 않았습니다.

73거래일·14,583개 종목-거래일에 실제 지표를 연결했습니다. 탐색 기준은 기사 8건이
17개 행에 연결됐고, 당시 수집 기록을 요구하는 엄격 기준은 0건입니다. 수정 기사 제외를
실제 지표에서도 검사했습니다. API는 완료했으나 이는 KOSPI200 전체 뉴스 수집이나
뉴스 결합 모델의 투자 수익률 실험 완료를 뜻하지 않습니다. 결합 모델 학습과 평가에는
충분한 과거 뉴스 및 가격 모델의 학습 구간 밖 예측 자료가 추가로 필요합니다.

## 지표 생성과 가격 파이프라인 연결

```bash
python -m news_fusion features --predictions predictions.parquet --articles outputs/news_fusion/articles.json --extractions outputs/news_fusion/extractions.json --mode exploratory --out outputs/news_fusion
```

가격 parquet 필수 열: `date`(마지막 가격 입력 세션), `entry_date`(다음 거래일), `ticker`, `huber_ensemble`.
전체 KOSPI200 예측을 입력한 뒤 상위 20개를 선택합니다. 실제 매매일은 거래일 달력으로 지정해야 합니다.
기존 `integrated_pipeline.py`의 전체 STEP2 파일을 그대로 연결할 수도 있습니다.

```bash
python -m news_fusion features --predictions outputs/step2_all_transformer_rank.csv --entry-date 2026-09-18 --articles articles.json --extractions extractions.json --mode strict --out outputs/news_live
```

당일 시가를 관측하기 전의 예측이어야 합니다. 이 어댑터는 STEP2가 `prediction_status=ok`, 공통 가격 세션,
시가→종가 회귀 목표인지 검사합니다. 미래 시세를 직접 조회하지 않습니다.

## 결합 학습 및 평가

학습용 features에는 `return_1`, `price_training_end`, `prediction_kind=walk_forward`,
`label_available_at`을 추가해야 합니다. 가격 예측이 해당 날짜보다 이전에 학습한 모델에서 나왔는지
확인합니다. 이 메타데이터는 실제 체크포인트 이력과 함께 제공해야 하며 선언만으로 진실성을 증명하지 않습니다.
최소 학습 20거래일, 검증 10거래일을 요구합니다. 날짜 경계에 아직 결과를 알 수 없는 라벨은 제외합니다.
세 가지 ridge 강도 1/10/100 중 validation의 일별 Rank IC로 선택합니다. 검증을 학습에 재사용하지 않습니다.

```bash
python -m news_fusion fit --features historical_oof_features.parquet --train-end 2026-03-31 --validation-end 2026-05-29 --out outputs/fitted_news
python -m news_fusion select --features outputs/news_fusion/features.parquet --model outputs/fitted_news/model.json --out outputs/news_selection
python -m news_fusion replay --selection outputs/news_selection/selection.parquet --bars daily_bars.parquet --out outputs/news_replay
```

위 날짜는 사용 예시이며 해당 뉴스 학습 자료나 학습된 결합 모델이 저장소에 포함된 것은 아닙니다.
검증 기간 이하 날짜에 결합 모델을 적용하면 중단합니다. 학습·평가 뉴스 시간 정책도 같아야 합니다.
`select`에서 `--model`을 생략하면 **가격 순위 그대로의 기준 모델**입니다. 뉴스 가중치를 임의로 넣지 않습니다.
기여도 합계가 최종 점수와 일치하는지 검사합니다. 뉴스가 아예 없거나 분류가 미완료인 결합 포트폴리오
재생은 중단합니다. 검색 누락까지 완전히 감지하지는 못하므로 후보 전체 수집 범위를 별도로 감사해야 합니다.

기존 6~9월은 이미 관찰한 연구 구간입니다. 새 모델 학습에 사용하지 않더라도 독립 미래 test라고 부르지 않습니다.

## 이번 가능성 시험 재실행

```bash
python run_news_feasibility.py --predictions /path/to/validation_report/predictions.parquet --bars /path/to/validation_report/inputs/daily_bars.parquet --max-calls 12
python -m unittest discover -s tests -p test_news_fusion.py -v
```

세 기업×4개월의 첫 기사 표본을 분류합니다. `outputs/news_fusion/report.html`에 실제 API 결과와 수집 제한을 기록합니다.
기존 Huber 순위를 그대로 투자 엔진에 넣어 연동을 확인하지만, 이것을 뉴스 결합 수익률로 보고하지 않습니다.
결합 모델 학습·전체 KOSPI200 뉴스 비교·사람의 감정분류 정확도 검증은 이번 소규모 시험에 포함되지 않습니다.

## 1,000만 원 가격 단독 / 뉴스 악재 필터 탐색 비교

`run_news_ab.py`는 학습된 ridge 결합기와 별개의 **사전 고정 규칙** 시험입니다.
현재 평가 파일의 첫 10거래일(2026-06-01~06-15)을 사용하며, 최종 결과를 보기 전에
기간·후보·규칙·비용을 `protocol.json`에 고정합니다. 단계별 실행 순서는 다음과 같습니다.

```bash
python run_news_ab.py prepare
python run_news_ab.py collect
python run_news_ab.py bodies
python run_news_ab.py analyze
python run_news_ab.py replay
```

API가 멈춘 경우 `python run_news_ab.py status`로 진행 보고서와 독립적인 가격 단독 기준선을
생성할 수 있습니다. 미완료 뉴스 전략 수익률은 생성하지 않습니다. 한도 회복 후 `analyze`를
명시적으로 재실행하면 검증된 배치 캐시를 재사용하고, 완료 후 `replay`를 실행합니다.

2026-09-24 실행은 기사 173건 중 본문 151건을 확보했고 시간 조건 통과 142건을 분석 대상으로
정했습니다. 26건 검증 통과, 1건 근거 불일치 거절 후 API가 일일 무료 호출 한도 20회 초과를
반환했습니다. 나머지 115건은 미처리이며 뉴스 전략 수익률은 아직 없습니다. 가격 단독의
동일 10거래일 결과는 최종 10,241,974원, 순수익 2.42%, MDD -6.18%, 거래비용 90,147원입니다.
이 기준선 결과를 확인한 이후 투자 규칙과 기간을 조정하지 않습니다.

기본 자료 경로는 기존 로컬 validation_report이며 `--predictions`, `--bars`, `--out`으로
지정할 수 있습니다. 실행 위치는 저장소 루트입니다. 매수 당일 08:30, 가격 상위 20종목,
최근 3일의 발견 기사 중 종목당 최신 1건을 선택합니다. 본문 확보에 실패해도 임의로 다른
기사로 대체하지 않습니다. Gemini는 같은 최초 사용 가능 거래일끼리 한 호출에 최대 20건,
60,000자, 총 20회까지 처리하며 각각의
본문과 근거를 별도로 검증합니다. 결과 개수나 기사 ID가 다르거나 API가 중단되면 투자
재생도 중단합니다. 개별 근거 불일치는 분석 거절로 기록하고 가격 순위를 유지합니다.
여러 기사를 묶은 프롬프트는 앞선 단일 기사 파일과 버전·캐시를 분리합니다.

직접 관련·충분한 문맥·부정 분류이면서 실적, 계약, 증자, 법률, 자사주, 배당, 제품 사건인
후보를 뒤로 보냅니다. 그 외 후보끼리 및 제외 우선 후보끼리는 가격 순위를 유지합니다.
긍정 기사 가점은 없습니다. 뉴스 미확보는 중립 감정이 아니며 가격 순위 유지라는 명시적
운영 규칙입니다. 이 규칙의 우월성은 사전에 검증된 것이 아니며 결과 후 가중치를 바꾸지 않습니다.

둘 다 처음에 5종목에 동일 금액을 배분하고 이후 유지 종목 수량은 그대로, 새 종목에는
가용 현금을 균등 배분합니다. 매일 정확한 동일비중으로 재조정하는 전략은 아닙니다.
편도 비용 0.125%, 소수점 수량, 종료일 종가 청산을 동일 엔진에 적용합니다.
보고서·자산 및 낙폭 그림·후보별 근거·주문 장부는 `outputs/news_ab_20260601_0615/`에
저장됩니다. API 비용은 투자 거래비용에 포함하지 않습니다.

당시 기사 원본, 완전한 뉴스 이력, 독립 미래 평가가 확보된 실험은 아닙니다. 검색 결과가
많으면 날짜 구간을 나누되 1일 검색 상한과 실패도 기록합니다. 단 10일의 비교이므로
수익 우열·연환산 Sharpe를 일반적인 모델 우월성으로 해석하지 않습니다.

## OpenAI 유료 키로 동일 실험 재개

Gemini 한도 중단 후 사용자가 OpenAI 키 사용을 요청하여 공급자를 전환했습니다.
`.env.news_fusion`의 `OPENAI_API_KEY`를 읽고, `gpt-4.1-mini-2025-04-14` 스냅샷 하나로
시간 조건을 통과한 142건 전체를 다시 분석합니다. 기존 Gemini 라벨과 섞지 않습니다.
가격 기준선 결과는 이미 확인된 상태이며, 기간·악재 필터·후보·매매 규칙은 변경하지 않습니다.

```bash
python run_news_ab_openai.py --stage analyze
python run_news_ab_openai.py --stage replay
```

기본 출력은 `outputs/news_ab_openai_20260601_0615_v2/`입니다. 첫 OpenAI 시험에서 14개
요청 중 11개 분석만 돌아와 검증 실패했습니다. 이를 정상 결과로 채택하지 않았습니다.
v2는 응답 스키마에 모든 기사 ID를 필수 키로 지정하고, 전체를 같은 형식으로 재분석합니다.
이전 실패 응답과 프로토콜은 별도 원래 디렉터리에 보존하며, 해당 호출 비용도 예산에 포함합니다.

공식 모델 문서의 입력 $0.40 / 캐시 입력 $0.10 / 출력 $1.60 (각 100만 토큰당) 단가를
기록하고, UTF-8 바이트 수와 최대 출력 토큰을 이용한 보수적 예약 비용을 호출 전에 계산합니다.
실험의 로컬 비용 한도는 $1입니다. 응답 사용량이 확인되면 실제 사용 토큰 기반 추정액으로
예약 비용을 정산하며, 응답이 불확실한 호출은 보수적인 예약액을 유지합니다. 추정액은
청구서 확정 금액이 아니며 API 비용은 원화 투자 수익률에 포함하지 않습니다.

OpenAI Responses API에 도구 없이 기사 텍스트만 전달하고 `store=false`를 지정합니다.
개수·ID·근거 문장 검사는 기존 규칙과 같습니다. 동작 테스트는 `test_news_openai.py`에 있습니다.

### OpenAI 실행 결과 (2026-09-24)

142건 전부 분류 응답을 받았고 111건은 원문 근거 검사를 통과했으며 31건은 근거 불일치로
거절했습니다. 이것은 감정 분류 정확도를 측정한 결과가 아닙니다. 검증 통과 기사로 뉴스
지표가 연결된 후보는 200개 종목-거래일 중 115개이고, 가격 Top-5 기준은 50개 중 28개입니다.
악재 필터에 걸린 5개 종목-거래일의 가격 순위는 8·10·16·16·17위여서 매수 종목은 바뀌지 않았습니다.

두 전략 모두 최종 자산 10,241,974원, 수익률 +2.42%, MDD -6.18%, 거래비용 90,147원입니다.
원래 가격 단독 기준선과 재현 오차는 0원입니다. 이 구간에서 뉴스 추가의 수익 개선 효과를
확인하지 못했습니다. 결과를 보고 더 유리한 기간이나 뉴스 가중치를 다시 선택하지 않았습니다.

10회 본 분석 사용량은 입력 179,235 / 출력 19,047 토큰입니다. 단가 기준 추정 비용은
$0.1021692, 앞선 응답 개수 오류 시험까지 포함하면 $0.1098468입니다. 실제 청구서 금액은
별도이며 원화 투자 성과에는 API 비용을 포함하지 않았습니다. 보고서와 그래프는 위 v2 출력
디렉터리의 `report.html`, `equity_comparison.png`에 있습니다.

## 외부 참고 자료

- Gemini 구조화 출력: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini 호출 한도: https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini generateContent: https://ai.google.dev/api/generate-content
- KR-FinBERT 공개 후보: https://huggingface.co/snunlp/KR-FinBert-SC
- LSEG 뉴스 지표 구조: https://developers.lseg.com/en/product/news/news_analytics
