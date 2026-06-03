"""Talon v2 Phase 3.2 — base pattern detection.

Simplified pattern recognition over daily candles. Full Wyckoff / Minervini
pattern logic is multi-week work; this module ships pragmatic heuristic
detectors that catch the most common bullish setups:

  flat_base            — 4-7 weeks of close range <= 15%, volume drying up
  high_tight_flag      — recent 25%+ run in 4-8 weeks, then 1-3 week
                         consolidation with shallow pullback
  cup_with_handle      — V/U-shaped retracement followed by short handle
                         that doesn't retrace more than 1/3 of the cup
  pullback_to_ma       — uptrend touching 50d MA without breaking 20d, on
                         declining volume

Output is a single `pattern` string label (the best match, or None) and a
`pattern_score` 0-1 confidence. Cheap to compute on candles already pulled
in Phase 1.1.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _candles_to_df(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    for col_in in ("market_time", "start_time", "t"):
        if col_in in df and "date" not in df:
            df["date"] = df[col_in]
            break
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


def _detect_flat_base(df: pd.DataFrame) -> tuple[float, dict]:
    """Last 20-35 days: high-low range <=15%, volume contracting, not crashing."""
    if len(df) < 35:
        return 0.0, {}
    window = df.tail(30)
    high = window["close"].max()
    low = window["close"].min()
    if low <= 0:
        return 0.0, {}
    rng_pct = (high - low) / low * 100
    if rng_pct > 15:
        return 0.0, {"range_pct": float(rng_pct)}
    # Volume contraction relative to prior 30
    prior = df.iloc[-60:-30] if len(df) >= 60 else df.iloc[:-30]
    if prior.empty or window["volume"].mean() <= 0:
        return 0.0, {}
    vol_drop = 1.0 - (window["volume"].mean() / max(prior["volume"].mean(), 1))
    score_range = max(0.0, 1.0 - rng_pct / 15.0)
    score_vol = max(0.0, min(1.0, vol_drop * 2.0))  # 50% drop → full credit
    score = 0.6 * score_range + 0.4 * score_vol
    return round(score, 4), {
        "range_pct": round(float(rng_pct), 2),
        "vol_drop_pct": round(float(vol_drop) * 100, 2),
    }


def _detect_high_tight_flag(df: pd.DataFrame) -> tuple[float, dict]:
    """Big run (4-8 weeks ago to ~3 weeks ago) of 25%+, then tight 1-3 week pause."""
    if len(df) < 50:
        return 0.0, {}
    # Run: lowest close 40-60 days back to highest close 15-30 days back
    earlier = df.iloc[-50:-15]
    if earlier.empty:
        return 0.0, {}
    base_low = earlier["close"].min()
    peak = earlier["close"].max()
    if base_low <= 0:
        return 0.0, {}
    run_pct = (peak - base_low) / base_low * 100
    if run_pct < 25:
        return 0.0, {"run_pct": float(run_pct)}
    # Consolidation: last 15 days, range should be < 1/3 of run
    recent = df.tail(15)
    rec_high = recent["close"].max()
    rec_low = recent["close"].min()
    if rec_low <= 0:
        return 0.0, {}
    cons_pct = (rec_high - rec_low) / rec_low * 100
    if cons_pct > run_pct / 3:
        return 0.0, {"run_pct": float(run_pct), "consolidation_pct": float(cons_pct)}
    score_run = min(1.0, run_pct / 50)
    score_tight = max(0.0, 1.0 - cons_pct / (run_pct / 3))
    score = 0.5 * score_run + 0.5 * score_tight
    return round(score, 4), {
        "run_pct": round(float(run_pct), 2),
        "consolidation_pct": round(float(cons_pct), 2),
    }


def _detect_cup_with_handle(df: pd.DataFrame) -> tuple[float, dict]:
    """U-shape retracement over ~8 weeks, then a small handle in last 1-2 weeks."""
    if len(df) < 50:
        return 0.0, {}
    cup = df.iloc[-50:-7]
    handle = df.tail(7)
    if cup.empty or handle.empty:
        return 0.0, {}
    left_peak = cup["close"].iloc[:10].max() if len(cup) >= 10 else cup["close"].max()
    cup_low = cup["close"].min()
    right_peak = cup["close"].iloc[-10:].max()
    if left_peak <= 0 or cup_low <= 0:
        return 0.0, {}
    cup_depth_pct = (left_peak - cup_low) / left_peak * 100
    if cup_depth_pct < 12 or cup_depth_pct > 33:
        return 0.0, {"cup_depth_pct": float(cup_depth_pct)}
    if right_peak < left_peak * 0.92:
        return 0.0, {"right_peak_pct_of_left": float(right_peak / left_peak * 100)}
    handle_low = handle["close"].min()
    handle_pullback_pct = (right_peak - handle_low) / right_peak * 100
    if handle_pullback_pct > cup_depth_pct / 3:
        return 0.0, {"handle_pullback_pct": float(handle_pullback_pct)}
    score = 0.6 * (1 - abs(cup_depth_pct - 22) / 22) + 0.4 * (
        1 - handle_pullback_pct / max(cup_depth_pct / 3, 0.01)
    )
    score = max(0.0, min(1.0, score))
    return round(score, 4), {
        "cup_depth_pct": round(float(cup_depth_pct), 2),
        "handle_pullback_pct": round(float(handle_pullback_pct), 2),
    }


def _detect_pullback_to_ma(df: pd.DataFrame) -> tuple[float, dict]:
    """Uptrend close pulling back to 50d but holding 20d, declining volume."""
    if len(df) < 50:
        return 0.0, {}
    close = float(df["close"].iloc[-1])
    sma20 = float(df["close"].tail(20).mean())
    sma50 = float(df["close"].tail(50).mean())
    if sma20 <= 0 or sma50 <= 0:
        return 0.0, {}
    # 50d must be in an uptrend (last 20 days of 50d MA rising)
    sma50_series = df["close"].rolling(50).mean().dropna()
    if len(sma50_series) < 20:
        return 0.0, {}
    if sma50_series.iloc[-1] <= sma50_series.iloc[-20]:
        return 0.0, {}
    # Close should be between sma50 and sma20
    if close < sma50 * 0.98 or close > sma20 * 1.02:
        return 0.0, {}
    # Volume in last 5 days should be lower than prior 20
    vol_5 = df["volume"].tail(5).mean()
    vol_20 = df["volume"].iloc[-25:-5].mean() if len(df) >= 25 else None
    vol_ok = bool(vol_20 and vol_5 < vol_20)
    score = 0.7 + (0.3 if vol_ok else 0.0)
    return round(score * 0.85, 4), {  # cap at 0.85 since this is the weakest pattern
        "close_vs_sma20_pct": round((close / sma20 - 1) * 100, 2),
        "close_vs_sma50_pct": round((close / sma50 - 1) * 100, 2),
        "vol_contracted": vol_ok,
    }


PATTERN_DETECTORS = [
    ("flat_base", _detect_flat_base),
    ("high_tight_flag", _detect_high_tight_flag),
    ("cup_with_handle", _detect_cup_with_handle),
    ("pullback_to_ma", _detect_pullback_to_ma),
]


def compute_pattern_signals(candles: list[dict] | None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "pattern": None,
        "pattern_score": None,
        "pattern_detail": None,
    }
    if not candles:
        return out
    df = _candles_to_df(candles)
    if df.empty or "close" not in df:
        return out
    best_name, best_score, best_detail = None, 0.0, None
    for name, detector in PATTERN_DETECTORS:
        score, detail = detector(df)
        if score > best_score:
            best_name, best_score, best_detail = name, score, detail
    if best_score >= 0.55:
        out["pattern"] = best_name
        out["pattern_score"] = round(float(best_score), 4)
        out["pattern_detail"] = best_detail
    return out
