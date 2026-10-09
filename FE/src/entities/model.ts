export const MODEL_SUMMARY = "Transformer Ensemble · 동일 구조 Transformer 3개(seed 42·43·44) 예측 평균 · 최근 20거래일 × 11개 특징 · 다음 거래일 시가→종가 수익률 예측";
export const MODEL_SELECTION_DESCRIPTION = "11개 특징은 OHLCV 파생 5개, RSI 1개, MACD 2개, 볼린저 밴드 3개로 구성됩니다. 세 모델의 예측수익률 평균으로 종목 순위를 매기고 상위 5종목을 선정하며, 예측은 실제 성과나 수익 보장이 아닙니다.";
