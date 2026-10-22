"""Causal stock indicators used by the frozen final model; no training helpers."""
import numpy as np
import pandas as pd

FEATURE_COLS = [
    "f_open", "f_high", "f_low", "f_close",
    "f_volume",
    "f_rsi",
    "f_macd", "f_macd_signal",
    "f_pct_b", "f_norm_bw", "f_rel_bw",
]

def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """[FIX-6] pure-gain->100; no-change->50."""
    delta    = close.diff()
    gain     = delta.clip(lower=0)
    loss     = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    has_data  = avg_gain.notna() & avg_loss.notna()
    pure_gain = has_data & (avg_loss == 0) & (avg_gain > 0)
    both_zero = has_data & (avg_gain == 0) & (avg_loss == 0)
    rs  = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)
    rsi[pure_gain] = 100.0
    rsi[both_zero] = 50.0
    return rsi

def _ema(s: pd.Series, span: int) -> pd.Series:
    return s.ewm(span=span, adjust=False).mean()

def _compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """[FIX-1] 0-price -> NaN. [LEAK-GUARD-1] full period before any slicing."""
    df = df.sort_index()
    open_  = df["Open"].astype(float).replace(0, np.nan)
    high   = df["High"].astype(float).replace(0, np.nan)
    low    = df["Low"].astype(float).replace(0, np.nan)
    close  = df["Close"].astype(float).replace(0, np.nan)
    vol    = df["Volume"].astype(float)

    prev_close = close.shift(1)
    df["f_open"]  = np.log(open_  / prev_close)
    df["f_high"]  = np.log(high   / prev_close)
    df["f_low"]   = np.log(low    / prev_close)
    df["f_close"] = np.log(close  / prev_close)

    # [LEAK-GUARD-2] causal rolling z-score
    log_vol   = np.log1p(vol)
    roll_mean = log_vol.rolling(60, min_periods=1).mean()
    roll_std  = log_vol.rolling(60, min_periods=1).std()
    df["f_volume"] = (log_vol - roll_mean) / roll_std.replace(0, np.nan)

    df["f_rsi"] = _rsi(close) / 100.0

    macd_line   = _ema(close, 12) - _ema(close, 26)
    macd_signal = _ema(macd_line, 9)
    df["f_macd"]        = macd_line   / close
    df["f_macd_signal"] = macd_signal / close

    sma20    = close.rolling(20).mean()
    std20    = close.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    bb_width = bb_upper - bb_lower
    bw_range = (bb_upper - bb_lower).replace(0, np.nan)
    df["f_pct_b"]   = (close - bb_lower) / bw_range
    df["f_norm_bw"] = bw_range / sma20.replace(0, np.nan)
    df["f_rel_bw"]  = bb_width / close
    return df
