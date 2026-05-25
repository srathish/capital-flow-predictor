"""Market regime data — VIX and SPY-relative.

Loaded once per backtest and aligned to the ticker's date index.
"""

from __future__ import annotations

from functools import lru_cache

import pandas as pd

from data import load_ohlcv


@lru_cache(maxsize=4)
def get_macro_series(period: str = "max") -> pd.DataFrame:
    """Pull VIX + SPY, compute regime indicators.

    Columns added:
      vix, vix_ma20, vix_low, vix_high, vix_panic
      spy, spy_sma50, spy_sma200, spy_above_50, spy_above_200, spy_roc20
      spy_trend_up      — SPY > 200ma AND ROC20 > -2 (normal up regime)
      macro_risk_on     — SPY trend up AND NOT vix_high (default tight filter)
      macro_not_panic   — NOT (SPY collapsed AND vix_panic) — LOOSE filter (used by v3)
    """
    vix = load_ohlcv("^VIX", period=period)["close"].rename("vix")
    spy = load_ohlcv("SPY", period=period)["close"].rename("spy")
    df = pd.concat([vix, spy], axis=1).dropna()

    df["vix_ma20"] = df["vix"].rolling(20).mean()
    df["vix_low"] = df["vix"] < 18
    df["vix_high"] = df["vix"] > 25
    df["vix_panic"] = df["vix"] > 35  # truly panic — much rarer

    df["spy_sma50"] = df["spy"].rolling(50).mean()
    df["spy_sma200"] = df["spy"].rolling(200).mean()
    df["spy_above_50"] = df["spy"] > df["spy_sma50"]
    df["spy_above_200"] = df["spy"] > df["spy_sma200"]
    df["spy_roc20"] = df["spy"].pct_change(20) * 100

    df["spy_trend_up"] = df["spy_above_200"] & (df["spy_roc20"] > -2)
    df["macro_risk_on"] = df["spy_trend_up"] & (~df["vix_high"])

    # LOOSE filter — only block when both SPY collapsed AND VIX in panic
    df["macro_not_panic"] = ~((df["spy"] < df["spy_sma200"] * 0.95) & df["vix_panic"])

    return df


def align_to(macro: pd.DataFrame, target_index: pd.DatetimeIndex) -> pd.DataFrame:
    return macro.reindex(target_index, method="ffill")


if __name__ == "__main__":
    m = get_macro_series(period="10y")
    recent = m.iloc[-1260:] if len(m) > 1260 else m
    print(f"  spy_above_200:  {recent['spy_above_200'].mean()*100:.1f}%")
    print(f"  vix_high (>25): {recent['vix_high'].mean()*100:.1f}%")
    print(f"  vix_panic (>35):{recent['vix_panic'].mean()*100:.1f}%")
    print(f"  macro_risk_on:  {recent['macro_risk_on'].mean()*100:.1f}%  (tight)")
    print(f"  macro_not_panic:{recent['macro_not_panic'].mean()*100:.1f}%  (loose)")
