# KOSPI200 가격 단독·뉴스 사건 보정 실험 재현

이 가이드는 **이미 저장된 기사 사건 라벨부터 다음날 시가→종가 수익률 예측, Rank IC, Top-5 포트폴리오 재생까지** 같은 숫자로 검증하는 방법입니다. 기사 원문을 다시 크롤링하거나 Gemini의 과거 응답을 새로 생성하는 실험은 아닙니다. 기사 본문과 당시 수정본이 보존·검증된 아카이브가 없어 그 앞단은 완전히 재현할 수 없습니다.

## 1. 공개된 입력과 결과

`published/frozen_replay/`에는 5,992개 종목·일의 고정 Huber 예측, **본문을 제거한 사건 라벨 394개**, 기사 요청·본문 간 연결 ID, 평가 날짜를 넣었습니다. 기사 제목·본문·URL·API 키·주가·종목별 실제 수익률은 없습니다. `published/`에는 모델 점수 4,992행, 전략별 집계 24행, 일별 자산 200행, 그래프 생성에 필요한 값이 있습니다. 각각의 해시는 [입력 manifest](published/frozen_replay/manifest.json)와 [결과 manifest](published/manifest.json)에 기록돼 있습니다.

| 구간 | 선택한 날짜 | 이번 평가에 사용한 날 |
|---|---|---|
| 횡보 | 2026-06-01~06-15, 10거래일 | 첫 5일 준비 후 06-09~15, 5거래일 |
| 하락 | 2026-06-30~07-13, 10거래일 | 10거래일 |
| 상승 | 2026-07-29~08-11, 10거래일 | 10거래일 |

구간은 사후 지수 수익률을 보고 선택한 **탐색용 구간**입니다. 독립적인 최종 테스트라고 설명하면 안 됩니다. 앙상블 체크포인트는 고정했고, 작은 Ridge 모델은 과거 날짜만으로 매일 다시 학습했습니다. Top-5는 남은 종목을 계속 보유하고 이탈 종목만 교체하며, 각 구간에 별도 초기자금 1,000만 원과 매수·매도 편도 0.125% 비용을 적용했습니다.

## 2. 원본 시세 없이 공개 파일 검사

저장소 루트에서 실행합니다. 검증에 사용한 환경은 Python 3.13.3, NumPy 2.4.6, pandas 2.3.3, PyArrow 24.0.0, scikit-learn 1.8.0입니다.

```bash
git clone https://github.com/dan6396/deep-learning-stock-trading.git
cd deep-learning-stock-trading
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r research/regime_benchmark/requirements-replay.txt
python -m research.regime_benchmark.verify_replay
```

`PASS: published checksums, 5992 frozen stock-session rows, 394 extracted event labels`가 나오면 공개 파일이 기록된 해시 및 행 수와 일치합니다. 이것은 **파일 무결성 검사**이며, 투자 수익을 새로 계산한 결과는 아닙니다.

## 3. 본인이 이용 권한을 가진 시세로 수치 실험 재생

별도로 확보한 일봉 CSV 또는 Parquet를 준비합니다. 필요한 열은 `date,ticker,Open,Close,Volume`이고, `ticker`는 6자리 종목코드입니다. 5,992개 대상 종목·일의 값이 모두 있어야 합니다. 시세 파일은 로컬에 두고 Git에 추가하지 않습니다.

저장소에 과거 검증용으로 이미 있는 `docs/validation/daily_bars.parquet`는 이번 실험의 5,992개 필요 행 중 **4,231개만 포함**합니다. 1,761개가 부족하므로 그 파일만으로는 아래 검사가 통과하지 않습니다. 기존 파일의 존재가 추가 원천 시세를 공개 재배포할 권한을 뜻하는 것도 아닙니다.

```bash
python -m research.regime_benchmark.verify_replay --bars /path/to/authorized_daily_bars.parquet
```

스크립트는 먼저 5,992개 필요 가격 행을 날짜·종목코드순으로 정렬해 **값 기준 SHA-256**을 비교합니다. Parquet 파일 자체의 바이트가 달라도 Open·Close·Volume 값이 같으면 통과합니다. 일치하면 저장된 사건 라벨을 읽어 25개 평가일의 작은 Ridge 보정 후보를 다시 학습·예측하고, 동일한 `portfolio_replay.py`로 24개 전략·구간을 재생합니다. 생성한 모델 점수·집계·일별 자산을 공개 파일과 수치 비교합니다. 예상되는 마지막 줄은 다음과 같습니다.

```text
PASS: 4,992 model scores, 24 strategy/regime metrics, 200 daily equity rows, 25 gate decisions
```

결과 파일은 `outputs/regime_benchmark_exact_replay/`에 저장되며 Git에서 제외됩니다. 가격 해시가 다르면 **동일 실험 재현이라고 판정하지 않고 중단**합니다. 데이터 제공처, 수정주가 적용, 날짜·종목코드·거래량을 확인하세요. 다른 시세로 새 실험을 할 수는 있지만 공개 표와 같은 결과가 나와야 한다고 가정하면 안 됩니다.

## 4. 기대 결과와 해석

아래는 비용 차감 후 기본 Top-5 유지·교체 방식의 구간별 최종 자산입니다. `event_fixed`는 뉴스 보정을 **항상 적용해 본 탐색 전략**이고, 실제 화면 경로인 `event_gated`는 과거 검증 조건을 통과할 때만 적용합니다.

| 구간 | 가격 단독 | 뉴스 사건 보정 `event_fixed` | 평가일의 뉴스 게이트 |
|---|---:|---:|---:|
| 횡보 후반 5일 | 10,815,026원 | 10,469,450원 | 꺼짐 |
| 하락 10일 | 10,146,168원 | 9,977,358원 | 꺼짐 |
| 상승 10일 | 11,947,329원 | 11,480,769원 | 꺼짐 |

`event_gated`는 25일 모두 가격 단독과 순위·자산이 같습니다. 세 구간 모두 `event_fixed`의 Rank IC와 기본 Top-5 성과가 가격 단독보다 낮았으므로, 공개 웹 코드에서도 뉴스 보정은 활성화하지 않았습니다. 과거 기사 원문이 실제 매매 당시의 버전과 동일했는지 증명되지 않았고, 원래 30일은 이미 여러 번 살펴본 구간입니다.

## 5. 기사·주가 원본의 공유 범위

원본 시세와 기사 본문을 **GitHub 공개 저장소나 카카오톡 파일로 전달하는 것 모두 배포·전송**에 해당할 수 있습니다. [KRX Data Marketplace 이용약관](https://data.krx.co.kr/contents/MDC/INFO/informationController/MDCINFO003.cmd)은 사전 허락 없는 정보 복사·배포·전송을 제한하고, [네이버 API 이용약관](https://developers.naver.com/products/terms/)은 검색 결과 및 제3자 권리의 무단 복제·저장·배포를 제한합니다. 언론사 기사 본문은 해당 권리자의 조건도 확인해야 합니다. 따라서 이 저장소에는 원본 대신 숫자형 특징·사건 라벨·해시·검증 코드를 올렸습니다. 팀원은 각자 허가된 원천에서 시세를 확보해야 합니다.

원본 기사 사용·재배포 허락을 별도로 받았다면 해당 허락 범위에 맞는 공유 방식을 다시 정할 수 있습니다. 허락이 없어도 공개된 라벨과 권한 있는 시세로 **가격+뉴스 결합 이후의 계산**은 위 절차대로 검사할 수 있습니다.
