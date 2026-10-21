export const MODEL_SUMMARY = "20일·120일 Transformer 앙상블 · 기간별 3개 seed 평균 후 50:50 결합 · 11개 종목 특징과 10개 시장 특징 · 다음 거래일 상대 순위";
export const MODEL_SELECTION_DESCRIPTION = "종목 특징은 OHLCV 파생 5개, RSI 1개, MACD 2개, 볼린저 밴드 3개입니다. 동일 기준일에 120거래일 입력이 유효한 종목을 함께 비교합니다. 각 모델 출력을 종목 간 순위로 표준화하고 기간별 평균을 동일 비중으로 결합합니다. 점수는 예상수익률이나 상승확률이 아니며, 양수·음수로 상승·하락을 판정하지 않습니다.";
