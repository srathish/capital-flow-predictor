"""STAGE Scanner — Python port of the Pine Script `Stage Scanner (BCS + HFS)`.

The Pine Script lives in `apps/gex/docs/` for reference; every condition here
matches that file exactly. When TV and this module disagree, TV wins — open an
issue and fix the port, don't loosen the assertion.

The module is intentionally framework-free: it takes a chronologically-sorted
list of OHLCV bars (oldest → newest) and returns a dict that mirrors the
TV dashboard cell-for-cell.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence, TypedDict

import numpy as np


Phase = Literal["BASE", "HANDLE", "NEUTRAL", "CAUTION", "DANGER"]


class StageBar(TypedDict):
    """One OHLCV bar. Date is ISO `YYYY-MM-DD`; volume is shares (not dollars)."""

    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class StageParams:
    """All tunables from the Pine Script inputs. Defaults match the TV indicator."""

    # Moving averages
    ema_short: int = 8
    ema_mid: int = 21
    ema_long: int = 50
    ema_trend: int = 200

    # BCS (base compression)
    vol_len: int = 20
    vol_len_long: int = 50
    atr_len: int = 14
    atr_lookback: int = 60
    dry_up_ratio: float = 0.80
    ema_tight_pct: float = 2.0

    # HFS (handle / flag)
    swing_look: int = 30
    handle_min: int = 5
    handle_max: int = 15
    pull_min: float = 3.0
    pull_max: float = 22.0
    vol_dry_handle: float = 0.90
    range_comp_pct: float = 0.70
    breakout_vol: float = 1.5

    # 52-week base zone
    high_52w_lookback: int = 252
    base_zone_min_pct: float = 10.0
    base_zone_max_pct: float = 40.0


# ----------------------------------------------------------------------------
# Indicator helpers — these are Pine Script equivalents, not generic TA. Keep
# them here so the port is self-contained and any drift is obvious.
# ----------------------------------------------------------------------------


def ema(values: np.ndarray, length: int) -> np.ndarray:
    """Pine Script `ta.ema`. Seeded with an SMA over the first `length` bars,
    which matches TradingView's behavior exactly. Returns NaN until seeded."""
    if length <= 0:
        raise ValueError("EMA length must be positive")
    n = len(values)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < length:
        return out
    alpha = 2.0 / (length + 1.0)
    out[length - 1] = np.mean(values[:length])
    for i in range(length, n):
        out[i] = alpha * values[i] + (1.0 - alpha) * out[i - 1]
    return out


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, length: int) -> np.ndarray:
    """Pine Script `ta.atr` — RMA (Wilder's smoothing) of true range."""
    n = len(close)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < 2:
        return out
    prev_close = np.concatenate(([close[0]], close[:-1]))
    tr = np.maximum.reduce(
        [
            high - low,
            np.abs(high - prev_close),
            np.abs(low - prev_close),
        ]
    )
    if n < length:
        return out
    # Wilder's: first ATR is simple mean of first `length` TRs, then RMA.
    out[length - 1] = np.mean(tr[:length])
    for i in range(length, n):
        out[i] = (out[i - 1] * (length - 1) + tr[i]) / length
    return out


def sma(values: np.ndarray, length: int) -> np.ndarray:
    """Pine Script `ta.sma`. NaN until the window is full."""
    n = len(values)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < length:
        return out
    csum = np.cumsum(values, dtype=np.float64)
    out[length - 1] = csum[length - 1] / length
    out[length:] = (csum[length:] - csum[:-length]) / length
    return out


def highest(values: np.ndarray, length: int) -> np.ndarray:
    """Pine Script `ta.highest` — rolling max over `length` bars, inclusive of
    current bar. NaN until the window is full."""
    n = len(values)
    out = np.full(n, np.nan, dtype=np.float64)
    for i in range(length - 1, n):
        out[i] = np.max(values[i - length + 1 : i + 1])
    return out


def lowest(values: np.ndarray, length: int) -> np.ndarray:
    n = len(values)
    out = np.full(n, np.nan, dtype=np.float64)
    for i in range(length - 1, n):
        out[i] = np.min(values[i - length + 1 : i + 1])
    return out


# ----------------------------------------------------------------------------
# Core analyzer
# ----------------------------------------------------------------------------


# ----------------------------------------------------------------------------
# Target projection + stop loss.
#
# IMPORTANT: these are statistical projections, not forecasts. The breakout
# may fail; the target may be hit faster or slower than expected. They exist
# to size positions and set alerts, not to promise outcomes.
#
# Methodology:
#   T1, T2, T3 are ADR-based — trigger plus N daily-ranges. This matches how
#   discretionary swing traders actually exit (textbook "measured move" /
#   base-depth targets are aspirational and rarely get hit before the trade
#   reverses). N is tuned so:
#
#     T1 = trigger + 2 × ADR_$    ~ 2–3 weeks at 0.20 ADR/day capture
#     T2 = trigger + 4 × ADR_$    ~ 4–6 weeks
#     T3 = trigger + 7 × ADR_$    ~ 8–12 weeks
#
#   For reference we also emit `extension_target` — the textbook measured-
#   move target (trigger + base_depth). Useful upper bound for "if the trend
#   really works" planning, but not a recommended exit.
#
#   Stop loss:
#     BASE   — close below max(base_low * 0.92, ema50)
#              (8% buffer under the base, but never below 50 EMA)
#     HANDLE — close below the handle's recent swing low (lowest of last
#              10 bars * 0.98)
# ----------------------------------------------------------------------------


def _compute_targets(
    *,
    phase: Phase,
    trigger_level: float | None,
    close: float,
    h: np.ndarray,
    l: np.ndarray,
    ema50_now: float,
    i: int,
) -> dict | None:
    """Return targets, stop, and ADR for BASE/HANDLE setups, or None."""
    if trigger_level is None:
        return None
    if phase == "BASE":
        depth_lookback = 60
    elif phase == "HANDLE":
        depth_lookback = 30
    else:
        return None
    if i - depth_lookback + 1 < 0:
        return None

    base_low = float(np.min(l[i - depth_lookback + 1 : i + 1]))
    if base_low <= 0 or trigger_level <= base_low:
        return None
    extension_distance = trigger_level - base_low  # textbook measured move

    # ADR_20 — average daily range as percent of close, over last 20 bars.
    if i - 19 < 0:
        return None
    ranges = (h[i - 19 : i + 1] - l[i - 19 : i + 1]) / np.where(
        l[i - 19 : i + 1] > 0, l[i - 19 : i + 1], 1.0
    )
    adr_pct = float(np.mean(ranges) * 100.0)
    if adr_pct <= 0:
        return None
    adr_dollars = adr_pct / 100.0 * close

    def _days(target_price: float) -> dict:
        gain_pct = (target_price - close) / close * 100.0
        # Directional efficiency band. Headline ("expected") uses 0.20 — that
        # matches how discretionary swing traders frame timeframes ("T1 in
        # 2-3 weeks" for ~2 ADRs above the trigger). Optimistic doubles that;
        # conservative halves it.
        return {
            "optimistic": max(1, round(gain_pct / (adr_pct * 0.40))),
            "expected": max(1, round(gain_pct / (adr_pct * 0.20))),
            "conservative": max(1, round(gain_pct / (adr_pct * 0.10))),
        }

    # ADR multipliers tuned to land T1 in ~2-3 weeks for a stock running at
    # typical 0.20-0.30 ADR/day capture. High-ADR names (IREN, CIFR) will
    # have larger absolute targets and the same relative time frames.
    tiers = [("t1", 2.0), ("t2", 4.0), ("t3", 7.0)]
    targets: dict = {}
    for name, mult in tiers:
        price = trigger_level + adr_dollars * mult
        gain = (price - close) / close * 100.0
        targets[name] = {
            "price": round(price, 2),
            "gain_pct": round(gain, 2),
            "adr_multiple": mult,
            "days": _days(price),
        }

    # Stop loss
    if phase == "BASE":
        stop_price = max(base_low * 0.92, ema50_now if not np.isnan(ema50_now) else 0.0)
        stop_logic = "below base × 0.92 (or 50 EMA, whichever is higher)"
    else:  # HANDLE
        # The handle itself is a tight 5-bar consolidation — stop just below
        # its low, not 10 bars back which catches the deeper pullback into
        # the handle and produces stops 20-30% wide on volatile names.
        recent_swing_low = float(np.min(l[max(0, i - 4) : i + 1]))
        stop_price = recent_swing_low * 0.98
        stop_logic = "below 5-bar handle low × 0.98"

    stop_pct = (close - stop_price) / close * 100.0

    # Risk/reward to T1 — a useful sanity check before sizing.
    risk = close - stop_price
    reward_t1 = targets["t1"]["price"] - close
    rr_t1 = reward_t1 / risk if risk > 0 else None

    return {
        "adr_pct": round(adr_pct, 2),
        "adr_dollars": round(adr_dollars, 2),
        "base_low": round(base_low, 2),
        "base_low_lookback_bars": depth_lookback,
        "extension_target": round(trigger_level + extension_distance, 2),
        "extension_gain_pct": round((trigger_level + extension_distance - close) / close * 100.0, 2),
        "stop_price": round(stop_price, 2),
        "stop_pct": round(stop_pct, 2),
        "stop_logic": stop_logic,
        "rr_to_t1": round(rr_t1, 2) if rr_t1 is not None else None,
        "targets": targets,
    }


def _extract_ohlcv(bars: Sequence[StageBar]) -> tuple[np.ndarray, ...]:
    o = np.array([b["open"] for b in bars], dtype=np.float64)
    h = np.array([b["high"] for b in bars], dtype=np.float64)
    l = np.array([b["low"] for b in bars], dtype=np.float64)
    c = np.array([b["close"] for b in bars], dtype=np.float64)
    v = np.array([b["volume"] for b in bars], dtype=np.float64)
    return o, h, l, c, v


def analyze(bars: Sequence[StageBar], params: StageParams | None = None) -> dict:
    """Run the full STAGE analysis. Returns the same fields the TV dashboard shows.

    Mirrors the Pine Script in lock-step: each named condition here corresponds
    to a named expression in the indicator. Edits should be made on both sides
    or not at all.
    """
    p = params or StageParams()
    if len(bars) < p.high_52w_lookback:
        # Not enough history — anything we compute would be noise. Pine Script
        # would show "—" everywhere in this case.
        return _empty_result(bars)

    o, h, l, c, v = _extract_ohlcv(bars)

    ema8 = ema(c, p.ema_short)
    ema21 = ema(c, p.ema_mid)
    ema50 = ema(c, p.ema_long)
    ema200 = ema(c, p.ema_trend)
    vol_ma = sma(v, p.vol_len)
    vol_ma_50 = sma(v, p.vol_len_long)
    atr_now = atr(h, l, c, p.atr_len)
    high_52w = highest(h, p.high_52w_lookback)
    swing_high = highest(h, p.swing_look)

    # We evaluate on the most recent bar (i = -1) since that's what TV shows
    # on the right edge. For backtesting a specific date, slice `bars` first.
    i = len(c) - 1
    last = bars[i]

    close_i = c[i]
    ema8_i, ema21_i, ema50_i, ema200_i = ema8[i], ema21[i], ema50[i], ema200[i]

    # ---- BCS conditions ----
    stage2 = (
        close_i > ema200_i
        and ema50_i > ema200_i
        and not np.isnan(ema200[i - 20])
        and ema200_i > ema200[i - 20]
    )

    dry_up = (
        not np.isnan(vol_ma[i])
        and not np.isnan(vol_ma_50[i])
        and vol_ma[i] < vol_ma_50[i] * p.dry_up_ratio
    )

    atr_past = atr_now[i - p.atr_lookback] if i - p.atr_lookback >= 0 else np.nan
    atr_contracted = (
        not np.isnan(atr_now[i])
        and not np.isnan(atr_past)
        # The Pine Script hard-codes 0.80 here even though `dry_up_ratio` is
        # also 0.80 by default. Keeping the literal to stay faithful to TV.
        and atr_now[i] < atr_past * 0.80
    )

    ema_spread1 = abs(ema8_i - ema21_i) / close_i * 100
    ema_spread2 = abs(ema21_i - ema50_i) / close_i * 100
    ema_tight = ema_spread1 < p.ema_tight_pct and ema_spread2 < p.ema_tight_pct * 2

    pct_from_high = (high_52w[i] - close_i) / high_52w[i] * 100
    in_base_zone = p.base_zone_min_pct < pct_from_high < p.base_zone_max_pct

    bcs_score = int(stage2) + int(dry_up) + int(atr_contracted) + int(ema_tight) + int(in_base_zone)
    bcs_ready = bcs_score >= 4

    # ---- HFS conditions ----
    emas_stacked = ema8_i > ema21_i > ema50_i > ema200_i
    ema21_rising = not np.isnan(ema21[i - 5]) and ema21_i > ema21[i - 5]
    ema50_rising = not np.isnan(ema50[i - 10]) and ema50_i > ema50[i - 10]
    uptrend = emas_stacked and ema21_rising and ema50_rising

    pullback_pct = (swing_high[i] - close_i) / swing_high[i] * 100
    in_pullback_zone = p.pull_min <= pullback_pct <= p.pull_max

    holding_ema = close_i > ema50_i and l[i] > ema50_i * 0.97

    # Pine: ta.highest(high, handleMin) - ta.lowest(low, handleMin) over the
    # current window vs the prior window (offset by handleMin bars).
    recent_range = np.max(h[i - p.handle_min + 1 : i + 1]) - np.min(
        l[i - p.handle_min + 1 : i + 1]
    )
    prior_range = np.max(
        h[i - 2 * p.handle_min + 1 : i - p.handle_min + 1]
    ) - np.min(l[i - 2 * p.handle_min + 1 : i - p.handle_min + 1])
    range_compressed = recent_range < prior_range * p.range_comp_pct

    handle_vol_ma = float(np.mean(v[i - p.handle_min + 1 : i + 1]))
    vol_dry_in_handle = (
        not np.isnan(vol_ma[i]) and handle_vol_ma < vol_ma[i] * p.vol_dry_handle
    )

    hfs_score = (
        int(uptrend)
        + int(in_pullback_zone)
        + int(holding_ema)
        + int(range_compressed)
        + int(vol_dry_in_handle)
    )
    hfs_ready = hfs_score >= 4

    # ---- Danger / Caution ----
    stage4 = close_i < ema200_i and ema200_i < ema200[i - 20]
    bear_stack = ema8_i < ema21_i < ema50_i < ema200_i
    danger = stage4 or bear_stack

    trend_weak = (
        close_i < ema50_i
        and not np.isnan(ema21[i - 5])
        and ema21_i < ema21[i - 5]
        and not danger
    )
    caution = trend_weak

    # ---- Phase priority (matches Pine `phase = danger ? ...` ladder) ----
    if danger:
        phase: Phase = "DANGER"
    elif caution:
        phase = "CAUTION"
    elif bcs_score > hfs_score:
        phase = "BASE"
    elif hfs_score > bcs_score:
        phase = "HANDLE"
    elif bcs_score >= 3:
        phase = "BASE"
    elif hfs_score >= 3:
        phase = "HANDLE"
    else:
        phase = "NEUTRAL"

    active_score = max(bcs_score, hfs_score)
    active_ready = bcs_ready or hfs_ready

    # ---- Trigger levels (prior bar's highest, per Pine `high[1]`) ----
    prior_high_20 = float(np.max(h[i - 20 : i])) if i >= 20 else np.nan
    handle_high = float(np.max(h[i - p.handle_max : i])) if i >= p.handle_max else np.nan

    if phase == "BASE":
        trigger_level: float | None = prior_high_20 if not np.isnan(prior_high_20) else None
    elif phase == "HANDLE":
        trigger_level = handle_high if not np.isnan(handle_high) else None
    else:
        trigger_level = None

    distance_pct = (
        (trigger_level - close_i) / close_i * 100 if trigger_level is not None else None
    )

    # ---- Triggers (did a breakout actually fire today?) ----
    # Pine uses prior-bar readiness (`bcsReady[1]`), so we look at the score
    # state one bar back. Since `analyze` only knows about the last bar, we
    # need a one-step-back view: re-run the EMA/score arithmetic using i-1.
    bcs_breakout, hfs_breakout, breakdown_warn = _evaluate_triggers(
        i=i,
        p=p,
        c=c,
        h=h,
        o=o,
        v=v,
        ema21=ema21,
        ema50=ema50,
        ema200=ema200,
        ema8=ema8,
        vol_ma=vol_ma,
        vol_ma_50=vol_ma_50,
        atr_now=atr_now,
        high_52w=high_52w,
        swing_high=swing_high,
        l=l,
    )

    targets = _compute_targets(
        phase=phase,
        trigger_level=trigger_level,
        close=close_i,
        h=h,
        l=l,
        ema50_now=ema50_i,
        i=i,
    )

    return {
        "date": last["date"],
        "close": round(close_i, 4),
        "phase": phase,
        "bcs_score": bcs_score,
        "hfs_score": hfs_score,
        "active_score": active_score,
        "active_ready": active_ready,
        "trigger_level": round(trigger_level, 4) if trigger_level is not None else None,
        "distance_pct": round(distance_pct, 4) if distance_pct is not None else None,
        "targets": targets,
        "conditions": {
            "stage2_trend": bool(stage2),
            "volume_dry_up": bool(dry_up),
            "atr_contracted": bool(atr_contracted),
            "ema_tight": bool(ema_tight),
            "in_base_zone": bool(in_base_zone),
            "uptrend_active": bool(uptrend),
            "in_pullback_zone": bool(in_pullback_zone),
            "holding_ema50": bool(holding_ema),
            "range_tight": bool(range_compressed),
            "vol_dry_in_handle": bool(vol_dry_in_handle),
        },
        "pullback_pct": round(float(pullback_pct), 2) if not np.isnan(pullback_pct) else None,
        "pct_from_52w_high": round(float(pct_from_high), 2),
        "fired_today": {
            "bcs_breakout": bool(bcs_breakout),
            "hfs_breakout": bool(hfs_breakout),
            "breakdown_warn": bool(breakdown_warn),
        },
        "danger": {"stage4": bool(stage4), "bear_stack": bool(bear_stack)},
    }


def _evaluate_triggers(
    *,
    i: int,
    p: StageParams,
    c: np.ndarray,
    h: np.ndarray,
    o: np.ndarray,
    v: np.ndarray,
    ema8: np.ndarray,
    ema21: np.ndarray,
    ema50: np.ndarray,
    ema200: np.ndarray,
    vol_ma: np.ndarray,
    vol_ma_50: np.ndarray,
    atr_now: np.ndarray,
    high_52w: np.ndarray,
    swing_high: np.ndarray,
    l: np.ndarray,
) -> tuple[bool, bool, bool]:
    """Did BCS/HFS/breakdown actually fire on bar `i`? Mirrors the Pine Script
    trigger expressions exactly.

    Pine uses `bcsReady[1]` (yesterday's readiness) plus today's price/volume
    action. We recompute the readiness flags for bar i-1 to stay faithful.
    """
    if i < 1:
        return False, False, False

    j = i - 1  # "yesterday"

    # ---- Yesterday's BCS readiness ----
    bcs_ready_prev = _bcs_ready_at(
        j, p, c, ema50, ema200, vol_ma, vol_ma_50, atr_now, ema8, ema21, high_52w
    )

    prior_high_20 = float(np.max(h[i - 20 : i])) if i >= 20 else np.inf
    bcs_breakout = bool(
        bcs_ready_prev
        and c[i] > prior_high_20
        and not np.isnan(vol_ma[i])
        and v[i] > vol_ma[i] * p.breakout_vol
        and c[i] > o[i]
    )

    # ---- Yesterday's HFS readiness ----
    hfs_ready_prev = _hfs_ready_at(
        j, p, c, h, l, v, ema8, ema21, ema50, ema200, vol_ma, swing_high
    )

    handle_high = float(np.max(h[i - p.handle_max : i])) if i >= p.handle_max else np.inf
    hfs_breakout = bool(
        hfs_ready_prev
        and c[i] > handle_high
        and not np.isnan(vol_ma[i])
        and v[i] > vol_ma[i] * p.breakout_vol
        and c[i] > o[i]
    )

    # ---- Breakdown WARN (uptrend 5 bars ago, now under 50 EMA on heavy vol) ----
    if i < 5 or i < p.ema_trend:
        breakdown = False
    else:
        k = i - 5
        emas_stacked_5 = ema8[k] > ema21[k] > ema50[k] > ema200[k]
        ema21_rising_5 = (
            not np.isnan(ema21[k - 5]) and ema21[k] > ema21[k - 5] if k >= 5 else False
        )
        ema50_rising_5 = (
            not np.isnan(ema50[k - 10]) and ema50[k] > ema50[k - 10] if k >= 10 else False
        )
        uptrend_5_bars_ago = bool(emas_stacked_5 and ema21_rising_5 and ema50_rising_5)
        breakdown = bool(
            uptrend_5_bars_ago
            and c[i] < ema50[i]
            and not np.isnan(vol_ma[i])
            and v[i] > vol_ma[i] * 1.3
        )

    return bcs_breakout, hfs_breakout, breakdown


def _bcs_ready_at(
    i: int,
    p: StageParams,
    c: np.ndarray,
    ema50: np.ndarray,
    ema200: np.ndarray,
    vol_ma: np.ndarray,
    vol_ma_50: np.ndarray,
    atr_now: np.ndarray,
    ema8: np.ndarray,
    ema21: np.ndarray,
    high_52w: np.ndarray,
) -> bool:
    if i < p.ema_trend or i - 20 < 0 or i - p.atr_lookback < 0:
        return False
    if np.isnan(ema200[i]) or np.isnan(ema200[i - 20]):
        return False
    stage2 = c[i] > ema200[i] and ema50[i] > ema200[i] and ema200[i] > ema200[i - 20]
    dry_up = (
        not np.isnan(vol_ma[i])
        and not np.isnan(vol_ma_50[i])
        and vol_ma[i] < vol_ma_50[i] * p.dry_up_ratio
    )
    atr_contracted = (
        not np.isnan(atr_now[i])
        and not np.isnan(atr_now[i - p.atr_lookback])
        and atr_now[i] < atr_now[i - p.atr_lookback] * 0.80
    )
    spread1 = abs(ema8[i] - ema21[i]) / c[i] * 100
    spread2 = abs(ema21[i] - ema50[i]) / c[i] * 100
    ema_tight = spread1 < p.ema_tight_pct and spread2 < p.ema_tight_pct * 2
    if np.isnan(high_52w[i]):
        return False
    pct_from_high = (high_52w[i] - c[i]) / high_52w[i] * 100
    in_base_zone = p.base_zone_min_pct < pct_from_high < p.base_zone_max_pct
    score = int(stage2) + int(dry_up) + int(atr_contracted) + int(ema_tight) + int(in_base_zone)
    return score >= 4


def _hfs_ready_at(
    i: int,
    p: StageParams,
    c: np.ndarray,
    h: np.ndarray,
    l: np.ndarray,
    v: np.ndarray,
    ema8: np.ndarray,
    ema21: np.ndarray,
    ema50: np.ndarray,
    ema200: np.ndarray,
    vol_ma: np.ndarray,
    swing_high: np.ndarray,
) -> bool:
    if i < p.ema_trend or i - 10 < 0:
        return False
    emas_stacked = ema8[i] > ema21[i] > ema50[i] > ema200[i]
    ema21_rising = not np.isnan(ema21[i - 5]) and ema21[i] > ema21[i - 5]
    ema50_rising = not np.isnan(ema50[i - 10]) and ema50[i] > ema50[i - 10]
    uptrend = emas_stacked and ema21_rising and ema50_rising

    if np.isnan(swing_high[i]):
        return False
    pullback_pct = (swing_high[i] - c[i]) / swing_high[i] * 100
    in_pullback_zone = p.pull_min <= pullback_pct <= p.pull_max
    holding_ema = c[i] > ema50[i] and l[i] > ema50[i] * 0.97

    if i - 2 * p.handle_min + 1 < 0:
        return False
    recent_range = np.max(h[i - p.handle_min + 1 : i + 1]) - np.min(
        l[i - p.handle_min + 1 : i + 1]
    )
    prior_range = np.max(
        h[i - 2 * p.handle_min + 1 : i - p.handle_min + 1]
    ) - np.min(l[i - 2 * p.handle_min + 1 : i - p.handle_min + 1])
    range_compressed = recent_range < prior_range * p.range_comp_pct

    handle_vol_ma = float(np.mean(v[i - p.handle_min + 1 : i + 1]))
    vol_dry_in_handle = (
        not np.isnan(vol_ma[i]) and handle_vol_ma < vol_ma[i] * p.vol_dry_handle
    )

    score = (
        int(uptrend)
        + int(in_pullback_zone)
        + int(holding_ema)
        + int(range_compressed)
        + int(vol_dry_in_handle)
    )
    return score >= 4


def _empty_result(bars: Sequence[StageBar]) -> dict:
    return {
        "date": bars[-1]["date"] if bars else None,
        "close": bars[-1]["close"] if bars else None,
        "phase": "NEUTRAL",
        "bcs_score": 0,
        "hfs_score": 0,
        "active_score": 0,
        "active_ready": False,
        "trigger_level": None,
        "distance_pct": None,
        "conditions": {
            "stage2_trend": False,
            "volume_dry_up": False,
            "atr_contracted": False,
            "ema_tight": False,
            "in_base_zone": False,
            "uptrend_active": False,
            "in_pullback_zone": False,
            "holding_ema50": False,
            "range_tight": False,
            "vol_dry_in_handle": False,
        },
        "pullback_pct": None,
        "pct_from_52w_high": None,
        "fired_today": {
            "bcs_breakout": False,
            "hfs_breakout": False,
            "breakdown_warn": False,
        },
        "danger": {"stage4": False, "bear_stack": False},
        "targets": None,
        "insufficient_history": True,
    }
