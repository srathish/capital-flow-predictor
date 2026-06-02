"""Talon v2 — chart-structure signals.

Adds the "is this basket basing on tight volume, ready to expand?" gate stack
that Talon v1 doesn't have. v1 only sees flow that's already happening;
v2 adds the structure check that catches setups *before* the move.

Signals computed per ticker from daily OHLCV candles:

  atr_ratio       ATR_5 / ATR_20      <0.70 = range contracting (coiled)
  vol_ratio       vol_5 / vol_20      <0.85 = volume drying up
  above_20d       close vs SMA(20)    structure intact above short MA
  above_50d       close vs SMA(50)    structure intact above medium MA
  above_200d      close vs SMA(200)   long-term uptrend
  pct_from_high   close vs 20d high   how deep in the base (small = near highs)
  rs_slope_4w     close[-1]/close[-20]-1  short-term price slope (relative)

Composite `coiled_score` (0-1):
  1.0 = textbook coiled (tight range + dry volume + structure intact)
  0.0 = neither basing nor structurally healthy

A theme is "coiled" if ≥3 names in the basket score >= 0.65.
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


def _candles_to_df(rows: list[dict]) -> pd.DataFrame:
    """Normalize UW candle rows into a DataFrame sorted oldest→newest."""
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    # UW returns: market_time, open, high, low, close, volume, total_volume...
    # Field names vary by endpoint; defend against both.
    for col_in, col_out in (
        ("market_time", "date"),
        ("start_time", "date"),
        ("t", "date"),
    ):
        if col_in in df and "date" not in df:
            df["date"] = df[col_in]
    if "date" not in df:
        return pd.DataFrame()
    df["date"] = pd.to_datetime(df["date"])
    for c in ("open", "high", "low", "close", "volume", "total_volume"):
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    if "volume" not in df and "total_volume" in df:
        df["volume"] = df["total_volume"]
    df = df.sort_values("date").reset_index(drop=True)
    return df


def _true_range(df: pd.DataFrame) -> pd.Series:
    """Wilder's true range = max(H-L, |H-prev_C|, |L-prev_C|)."""
    high_low = df["high"] - df["low"]
    high_pc = (df["high"] - df["close"].shift(1)).abs()
    low_pc = (df["low"] - df["close"].shift(1)).abs()
    return pd.concat([high_low, high_pc, low_pc], axis=1).max(axis=1)


def _atr(df: pd.DataFrame, period: int) -> float | None:
    if len(df) < period + 1:
        return None
    tr = _true_range(df)
    val = float(tr.tail(period).mean())
    return val if not np.isnan(val) else None


def _avg_vol(df: pd.DataFrame, period: int) -> float | None:
    if len(df) < period:
        return None
    val = float(df["volume"].tail(period).mean())
    return val if not np.isnan(val) else None


def _sma_above(df: pd.DataFrame, period: int) -> int | None:
    """1 if close > SMA(period), 0 if below, None if not enough data."""
    if len(df) < period:
        return None
    sma = float(df["close"].tail(period).mean())
    last = float(df["close"].iloc[-1])
    if np.isnan(sma) or np.isnan(last):
        return None
    return 1 if last > sma else 0


def compute_chart_signals(candles: list[dict] | None) -> dict[str, Any]:
    """Return the v2 chart-structure signal dict for one ticker.

    Output keys (all optional — None when there isn't enough history):
      atr_5, atr_20, atr_ratio
      vol_5, vol_20, vol_ratio
      above_20d, above_50d, above_200d
      pct_from_high_20
      slope_4w_pct
      coiled_score (0-1, the composite)
      coiled (bool, score >= 0.65)
    """
    out: dict[str, Any] = {
        "atr_5": None, "atr_20": None, "atr_ratio": None,
        "vol_5": None, "vol_20": None, "vol_ratio": None,
        "above_20d": None, "above_50d": None, "above_200d": None,
        "pct_from_high_20": None, "slope_4w_pct": None,
        "coiled_score": None, "coiled": False,
    }
    if not candles:
        return out
    df = _candles_to_df(candles)
    if df.empty or "close" not in df:
        return out

    out["atr_5"] = _atr(df, 5)
    out["atr_20"] = _atr(df, 20)
    if out["atr_5"] is not None and out["atr_20"] and out["atr_20"] > 0:
        out["atr_ratio"] = round(out["atr_5"] / out["atr_20"], 4)

    out["vol_5"] = _avg_vol(df, 5)
    out["vol_20"] = _avg_vol(df, 20)
    if out["vol_5"] is not None and out["vol_20"] and out["vol_20"] > 0:
        out["vol_ratio"] = round(out["vol_5"] / out["vol_20"], 4)

    out["above_20d"] = _sma_above(df, 20)
    out["above_50d"] = _sma_above(df, 50)
    out["above_200d"] = _sma_above(df, 200)

    if len(df) >= 20:
        last = float(df["close"].iloc[-1])
        high_20 = float(df["close"].tail(20).max())
        if high_20 > 0:
            out["pct_from_high_20"] = round((last - high_20) / high_20 * 100, 3)

    if len(df) >= 21:
        last = float(df["close"].iloc[-1])
        ref = float(df["close"].iloc[-21])
        if ref > 0:
            out["slope_4w_pct"] = round((last / ref - 1) * 100, 3)

    out["coiled_score"] = _coiled_score(out)
    if out["coiled_score"] is not None and out["coiled_score"] >= 0.65:
        out["coiled"] = True
    # Round floats for JSON cleanliness
    for k in ("atr_5", "atr_20", "vol_5", "vol_20", "coiled_score"):
        if out.get(k) is not None:
            out[k] = round(float(out[k]), 4)
    return out


def _coiled_score(sig: dict[str, Any]) -> float | None:
    """Composite 0-1: how textbook-coiled is this setup?

    Reward: tight ATR ratio, dry volume, above 20d/50d MAs, near highs,
    slope near flat (basing — not crashing, not extended).
    Penalize: extended range, volume blowing out, below structure, deep
    in a downtrend, parabolic.
    """
    weights_total = 0.0
    score = 0.0

    # ATR contraction — 30% (the headline signal)
    if sig.get("atr_ratio") is not None:
        r = sig["atr_ratio"]
        # 0.50 = max coiled (1.0), 0.70 = neutral (0.5), 1.0 = no coil (0)
        atr_pts = max(0.0, min(1.0, (1.0 - r) / 0.5))
        score += 0.30 * atr_pts
        weights_total += 0.30

    # Volume dry-up — 20%
    if sig.get("vol_ratio") is not None:
        v = sig["vol_ratio"]
        # 0.60 = max dry-up (1.0), 0.85 = neutral (0.5), 1.2+ = expansion (0)
        vol_pts = max(0.0, min(1.0, (1.2 - v) / 0.6))
        score += 0.20 * vol_pts
        weights_total += 0.20

    # Structure intact — 25% (split across 3 MAs)
    structure_pts = 0.0
    structure_weight = 0.0
    for mkey, w in (("above_20d", 0.10), ("above_50d", 0.10), ("above_200d", 0.05)):
        if sig.get(mkey) is not None:
            structure_pts += w * float(sig[mkey])
            structure_weight += w
    if structure_weight > 0:
        score += structure_pts
        weights_total += structure_weight

    # Near 20d high (in a base, not crashed) — 15%
    if sig.get("pct_from_high_20") is not None:
        # 0% = at high (1.0), -7% = neutral (0.5), -15% = penalty (0)
        p = sig["pct_from_high_20"]
        near_high = max(0.0, min(1.0, 1.0 - (-p) / 15.0))
        score += 0.15 * near_high
        weights_total += 0.15

    # Slope near flat (basing) — 10%, penalize parabolic/crashing
    if sig.get("slope_4w_pct") is not None:
        s = sig["slope_4w_pct"]
        # Sweet spot: -5% to +5% (basing). >20% = parabolic, <-15% = crashing.
        if -5 <= s <= 5:
            slope_pts = 1.0
        elif 5 < s <= 20 or -15 <= s < -5:
            slope_pts = 0.5
        else:
            slope_pts = 0.0
        score += 0.10 * slope_pts
        weights_total += 0.10

    if weights_total == 0:
        return None
    return round(score / weights_total, 4)


def aggregate_themes(rows: list[dict], themes: dict[str, list[str]]) -> dict[str, dict]:
    """For each theme, count coiled names and compute mean coiled_score.

    A theme is `coiled_basket` if it has ≥3 names with coiled_score ≥ 0.65.
    """
    by_ticker = {r["ticker"]: r for r in rows}
    out: dict[str, dict] = {}
    for theme, tickers in themes.items():
        members = [by_ticker[t] for t in tickers if t in by_ticker]
        if not members:
            continue
        scores = [m.get("coiled_score") for m in members if m.get("coiled_score") is not None]
        coiled = [m for m in members if m.get("coiled")]
        out[theme] = {
            "n_members_with_data": len(scores),
            "n_coiled": len(coiled),
            "mean_coiled_score": round(float(np.mean(scores)), 4) if scores else None,
            "coiled_tickers": [c["ticker"] for c in coiled],
            "coiled_basket": len(coiled) >= 3,
        }
    return out
