"""Market regime data — VIX and SPY-relative.

Loaded once per backtest and aligned to the ticker's date index.
"""

from __future__ import annotations

from functools import lru_cache

import pandas as pd

from data import load_ohlcv


@lru_cache(maxsize=4)
def get_macro_series(period: str = "max") -> pd.DataFrame:
    """Pull VIX + SPY, compute regime indicators, return aligned-to-date DataFrame.

    Columns:
      vix          — VIX close
      vix_ma20     — 20-day SMA of VIX
      vix_low      — VIX < 18 (calm)
      vix_high     — VIX > 25 (stressed)
      spy          — SPY close
      spy_sma200   — SPY 200-day SMA
      spy_above_200 — SPY > 200-day SMA
      spy_roc20    — SPY 20-day rate of change
      spy_trend_up — spy_above_200 AND spy_roc20 > -2  (200ma + not in sharp decline)
      macro_risk_on — composite: spy_trend_up AND NOT vix_high
    """
    vix = load_ohlcv("^VIX", period=period)["close"].rename("vix")
    spy = load_ohlcv("SPY", period=period)["close"].rename("spy")

    df = pd.concat([vix, spy], axis=1).dropna()
    df["vix_ma20"] = df["vix"].rolling(20).mean()
    df["vix_low"] = df["vix"] < 18
    df["vix_high"] = df["vix"] > 25

    df["spy_sma200"] = df["spy"].rolling(200).mean()
    df["spy_above_200"] = df["spy"] > df["spy_sma200"]
    df["spy_roc20"] = df["spy"].pct_change(20) * 100
    df["spy_trend_up"] = df["spy_above_200"] & (df["spy_roc20"] > -2)
    df["macro_risk_on"] = df["spy_trend_up"] & (~df["vix_high"])

    return df


def align_to(macro: pd.DataFrame, target_index: pd.DatetimeIndex) -> pd.DataFrame:
    """Align macro series to a target ticker's date index. Forward-fills any gaps."""
    return macro.reindex(target_index, method="ffill")


if __name__ == "__main__":
    m = get_macro_series(period="10y")
    print(m.tail(20))
    print("\nMacro regime distribution (most recent 5y):")
    recent = m.last("5Y") if hasattr(m, "last") else m.iloc[-1260:]
    print(f"  spy_above_200: {recent['spy_above_200'].mean()*100:.1f}%")
    print(f"  vix_high:      {recent['vix_high'].mean()*100:.1f}%")
    print(f"  vix_low:       {recent['vix_low'].mean()*100:.1f}%")
    print(f"  macro_risk_on: {recent['macro_risk_on'].mean()*100:.1f}%")
