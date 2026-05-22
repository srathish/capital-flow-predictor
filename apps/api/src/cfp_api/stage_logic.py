"""STAGE Scanner — Python port of the `Stage + Confluence Master` Pine indicator.

This module mirrors the TV indicator (BCS + HFS + Grade + Flow gates) with
four deliberate strengthening divergences. The reference Pine lives in
`apps/gex/docs/`. See `STAGE_DRIFT.md` (next to this file) for the four
deltas vs. the TV indicator — drift is intentional, not a bug. When TV and
this module disagree on a condition NOT listed in DRIFT.md, TV wins and the
port is broken — open an issue.

The module is intentionally framework-free: it takes a chronologically-sorted
list of OHLCV bars (oldest → newest) and returns a dict that mirrors the
TV dashboard plus the four strengthened gates.

Master pipeline (a confirmed A-setup needs ALL gates):
  G1  REGIME           phase != DANGER
  G2  ARMED + TRIGGER  bcs_ready or hfs_ready at bar i-1, close > trigger at i
  G3a GRADE            grade >= min_grade (0-5 score, 5 components)
  G3b FLOW             pre-breakout accumulation (OBV slope + up-vol ratio)
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

    # --- G3a Grade (breakout quality, 0-5) ---
    bb_len: int = 20
    bb_mult: float = 2.0
    range_exp_mult: float = 1.2  # range > ATR * mult to count as expansion
    bb_thrust_pctb: float = 0.80  # %B threshold for thrust component
    pre_break_tight_short: int = 5   # short ATR window (current squeeze)
    pre_break_tight_long: int = 25   # long ATR window (prior baseline) — uses [i-25..i-6]
    pre_break_tight_ratio: float = 0.70  # short ATR < long ATR * ratio
    min_grade: int = 3

    # --- G3b Flow (pre-breakout accumulation) ---
    # Backward-looking gate, evaluated on the 20 bars BEFORE the breakout bar.
    # This is the deliberate divergence from the TV indicator (which uses
    # MFI/CMF on the breakout bar itself, correlated with the breakout).
    flow_len: int = 20
    up_vol_ratio_min: float = 1.2

    # --- HFS handle duration (6th condition, not in TV indicator) ---
    handle_duration_min: int = 5
    handle_duration_max: int = 15


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


def stdev(values: np.ndarray, length: int) -> np.ndarray:
    """Pine `ta.stdev` — population standard deviation over a rolling window.

    Pine uses the BIASED estimator (divide by N, not N-1). We match it for
    parity with the TV indicator's BB width.
    """
    n = len(values)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < length:
        return out
    for i in range(length - 1, n):
        window = values[i - length + 1 : i + 1]
        out[i] = float(np.std(window))  # ddof=0 by default
    return out


def obv(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """On-Balance Volume — cumulative volume signed by close direction.

    OBV[i] = OBV[i-1] + volume[i] if close[i] > close[i-1]
                       - volume[i] if close[i] < close[i-1]
                       + 0         if equal
    OBV[0] = 0.
    """
    n = len(close)
    out = np.zeros(n, dtype=np.float64)
    for i in range(1, n):
        if close[i] > close[i - 1]:
            out[i] = out[i - 1] + volume[i]
        elif close[i] < close[i - 1]:
            out[i] = out[i - 1] - volume[i]
        else:
            out[i] = out[i - 1]
    return out


def linreg_slope(values: np.ndarray) -> float:
    """Least-squares slope of `values` against bar index. Returns 0.0 if the
    window is too short or contains NaN.

    Used to measure OBV trend over a pre-breakout window. We only care about
    the sign of the slope, but return the value for diagnostics.
    """
    n = len(values)
    if n < 2 or np.any(np.isnan(values)):
        return 0.0
    x = np.arange(n, dtype=np.float64)
    xm, ym = x.mean(), values.mean()
    denom = float(np.sum((x - xm) ** 2))
    if denom == 0.0:
        return 0.0
    return float(np.sum((x - xm) * (values - ym)) / denom)


def up_volume_ratio(
    close: np.ndarray, volume: np.ndarray, *, start: int, end: int
) -> float:
    """Sum of volume on up-close days divided by sum on down-close days, over
    bar indices [start, end) (half-open). Returns +inf if there are no down
    days, 0.0 if there are no up days. NaN if the window is empty.

    Up-day = close[k] > close[k-1]. Equal closes are excluded.
    """
    if end <= start or start < 1:
        return float("nan")
    up_vol = 0.0
    dn_vol = 0.0
    for k in range(start, end):
        if close[k] > close[k - 1]:
            up_vol += volume[k]
        elif close[k] < close[k - 1]:
            dn_vol += volume[k]
    if up_vol == 0 and dn_vol == 0:
        return float("nan")
    if dn_vol == 0:
        return float("inf")
    return up_vol / dn_vol


# ----------------------------------------------------------------------------
# Gate helpers — Master pipeline (G3a Grade, G3b Flow, HFS handle duration).
# Each returns a small dict so the dashboard can show components.
#
# Drift vs. TV indicator is concentrated here. See STAGE_DRIFT.md.
# ----------------------------------------------------------------------------


def _grade_at(
    *,
    i: int,
    p: StageParams,
    h: np.ndarray,
    l: np.ndarray,
    v: np.ndarray,
    vol_ma: np.ndarray,
    atr_now: np.ndarray,
    bb_width: np.ndarray,
    bb_pctb: np.ndarray,
) -> tuple[int, dict, float]:
    """Compute the 0-5 breakout-quality grade at bar i.

    Five components:
      1. volume_surge        RVOL = volume[i] / vol_ma[i-1] >= breakout_vol
                             (uses i-1 to avoid the breakout bar self-inflating
                             its own benchmark — Pine fix.)
      2. pre_break_tightness ATR[i-5..i-1] < ATR[i-25..i-6] * 0.70
                             (DIVERGENCE from TV `strongBar`. Pre-breakout
                             squeeze signature, decoupled from the break bar.
                             See DRIFT.md fix #2.)
      3. range_expansion     hlRange[i] > atr_now[i] * range_exp_mult
      4. bb_thrust           bb_pctb[i] > bb_thrust_pctb (default 0.80)
      5. bb_expanding        bb_width[i] > bb_width[i-1]

    Returns (grade, components, rvol).
    """
    if i < max(p.bb_len, p.pre_break_tight_long, p.atr_len) or i - 1 < 0:
        return 0, {
            "volume_surge": False,
            "pre_break_tightness": False,
            "range_expansion": False,
            "bb_thrust": False,
            "bb_expanding": False,
        }, 0.0

    # 1. RVOL with repaint fix (vol_ma[i-1])
    vol_ma_prev = vol_ma[i - 1]
    if np.isnan(vol_ma_prev) or vol_ma_prev <= 0:
        rvol = 0.0
    else:
        rvol = float(v[i] / vol_ma_prev)
    volume_surge = rvol >= p.breakout_vol

    # 2. Pre-breakout tightness — compare a short trailing ATR (excluding bar i)
    #    to a longer prior ATR. Replaces TV's `strongBar` because that one is
    #    nearly tautological with `close > priorHigh`.
    short_start = i - p.pre_break_tight_short
    short_end = i  # exclusive — uses [i-5..i-1]
    long_start = i - p.pre_break_tight_long
    long_end = i - p.pre_break_tight_short  # uses [i-25..i-6]
    if long_start < 0:
        pre_break_tightness = False
    else:
        tr_short = h[short_start:short_end] - l[short_start:short_end]
        tr_long = h[long_start:long_end] - l[long_start:long_end]
        if len(tr_short) == 0 or len(tr_long) == 0:
            pre_break_tightness = False
        else:
            atr_short = float(np.mean(tr_short))
            atr_long = float(np.mean(tr_long))
            pre_break_tightness = atr_short < atr_long * p.pre_break_tight_ratio

    # 3. Range expansion
    hl_range = h[i] - l[i]
    atr_i = atr_now[i]
    range_expansion = (
        not np.isnan(atr_i) and atr_i > 0 and hl_range > atr_i * p.range_exp_mult
    )

    # 4. BB %B thrust
    bb_thrust = not np.isnan(bb_pctb[i]) and bb_pctb[i] > p.bb_thrust_pctb

    # 5. BB width expanding
    if i - 1 < 0 or np.isnan(bb_width[i]) or np.isnan(bb_width[i - 1]):
        bb_expanding = False
    else:
        bb_expanding = bool(bb_width[i] > bb_width[i - 1])

    grade = (
        int(volume_surge)
        + int(pre_break_tightness)
        + int(range_expansion)
        + int(bb_thrust)
        + int(bb_expanding)
    )

    return grade, {
        "volume_surge": bool(volume_surge),
        "pre_break_tightness": bool(pre_break_tightness),
        "range_expansion": bool(range_expansion),
        "bb_thrust": bool(bb_thrust),
        "bb_expanding": bool(bb_expanding),
    }, rvol


def _flow_at(
    *,
    i: int,
    p: StageParams,
    c: np.ndarray,
    v: np.ndarray,
    obv_series: np.ndarray,
) -> tuple[bool, dict]:
    """Pre-breakout accumulation gate. Both components look at the `flow_len`
    bars BEFORE bar i (i.e., the base/handle, NOT the breakout bar).

      A. obv_slope_positive  OBV trend over [i-flow_len .. i-1] has slope > 0
      B. up_vol_ratio_ok     sum(vol up days) / sum(vol dn days) over the same
                             window >= up_vol_ratio_min (default 1.2)

    Pass = A and B. DIVERGENCE from TV (which uses MFI/CMF on the breakout
    bar). See DRIFT.md fix #1.
    """
    window_start = i - p.flow_len
    if window_start < 1:
        return False, {
            "ok": False,
            "obv_slope": 0.0,
            "obv_slope_positive": False,
            "up_vol_ratio": None,
            "up_vol_ratio_ok": False,
        }

    obv_window = obv_series[window_start:i]
    slope = linreg_slope(obv_window)
    obv_ok = slope > 0.0

    ratio = up_volume_ratio(c, v, start=window_start, end=i)
    if np.isnan(ratio):
        ratio_ok = False
        ratio_out: float | None = None
    else:
        ratio_ok = ratio >= p.up_vol_ratio_min
        # Cap +inf for JSON-cleanliness.
        ratio_out = 999.0 if ratio == float("inf") else round(ratio, 3)

    ok = obv_ok and ratio_ok
    return ok, {
        "ok": bool(ok),
        "obv_slope": round(slope, 4),
        "obv_slope_positive": bool(obv_ok),
        "up_vol_ratio": ratio_out,
        "up_vol_ratio_ok": bool(ratio_ok),
    }


def _handle_duration_at(
    *, i: int, h: np.ndarray, swing_look: int, max_lookback: int
) -> int | None:
    """Count bars since the most recent swing-high touch within the last
    `swing_look` bars. A handle that started today returns 0; a 7-bar-old
    pullback returns 7.

    Returns None if i is too early to compute, or if no swing high exists
    in the window.

    DIVERGENCE from TV (which doesn't measure duration at all — only
    `handleMax` bounds the lookback for the trigger level). See DRIFT.md
    fix #3.
    """
    if i < swing_look:
        return None
    swing_window = h[i - swing_look + 1 : i + 1]
    if len(swing_window) == 0:
        return None
    swing_high_val = float(np.max(swing_window))
    # Walk backward from i to find the most recent bar where high == swing_high.
    # Bounded by max_lookback to keep this bounded per ticker.
    lower = max(0, i - max_lookback)
    for k in range(i, lower - 1, -1):
        if h[k] >= swing_high_val * 0.9999:  # float-safe equality
            return i - k
    return None


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


# ----------------------------------------------------------------------------
# Recommended option contracts — picks strike + expiry based on the setup's
# T1/T2/T3 time horizons, not based on where current volume is concentrated.
# This is "what to trade", not "what is trading" (the flow tape answers the
# latter). The two get cross-referenced in the UI.
#
# Three contracts per setup:
#   1. Aggressive: single OTM call, expiry just past T2 (4-6 weeks out)
#      Captures the T1→T2 leg without near-term theta drag.
#   2. Spread:     debit call spread, long at trigger / short at T2 target,
#      same expiry as aggressive. Caps upside but cuts cost meaningfully.
#   3. LEAP:       Jan of the following year, strike near T2 price.
#      Long enough runway that the trade can chop without being killed.
# ----------------------------------------------------------------------------


from datetime import date, timedelta


def _next_third_friday(from_date: date, min_dte: int) -> date:
    """Return the next monthly options expiration — 3rd Friday of a month — at
    least `min_dte` days from `from_date`. Walks month by month."""
    target = from_date + timedelta(days=min_dte)
    month, year = target.month, target.year
    for _ in range(18):  # up to 18 months out (covers LEAPs)
        # Find 3rd Friday of (month, year)
        first = date(year, month, 1)
        # Friday = 4 in Python weekday()
        offset = (4 - first.weekday()) % 7
        third_friday = first + timedelta(days=offset + 14)
        if third_friday >= target:
            return third_friday
        month += 1
        if month > 12:
            month = 1
            year += 1
    # Fallback — shouldn't happen for any realistic min_dte.
    return target


def _round_strike(price: float) -> float:
    """Round to standard strike increment based on underlying price band.
    Liquid mega-caps (AMZN, NVDA, MSFT) have $5 strikes well into the
    hundreds, so we don't switch to $10 increments until $500."""
    if price < 5:
        return round(price * 2) / 2  # $0.50 steps
    if price < 25:
        return float(round(price))   # $1 steps
    if price < 500:
        return float(round(price / 5) * 5)  # $5 steps
    return float(round(price / 10) * 10)    # $10 steps


def _compute_recommended_plays(
    *,
    phase: Phase,
    trigger_level: float | None,
    targets: dict | None,
    today: date | None = None,
) -> list[dict]:
    """Return 3 contract suggestions calibrated to the scanner's targets and
    time horizons. Empty list if not a long-side setup."""
    if phase not in ("BASE", "HANDLE") or trigger_level is None or targets is None:
        return []
    today = today or date.today()
    t2 = targets["targets"]["t2"]["price"]
    t3 = targets["targets"]["t3"]["price"]

    # Aggressive: monthly expiry ~60 days out (lands past T2's 4-6 week window),
    # strike just above the trigger so it costs less but still tracks.
    agg_expiry = _next_third_friday(today, 56)
    agg_strike = _round_strike(trigger_level * 1.02)

    # Debit spread: same expiry, long near trigger / short near T2. Cheaper
    # than the naked call; T2 cap is fine because that's where the scanner's
    # mid-tier target lives anyway.
    spr_long = _round_strike(trigger_level * 1.01)
    spr_short = _round_strike(t2)
    if spr_short <= spr_long:
        spr_short = _round_strike(spr_long + (agg_strike - spr_long) + 5)

    # LEAP: ~8-12 months out, strike near T2. Min DTE 230 nudges past the
    # December monthly into January (the canonical LEAP cycle). Gives the
    # trade time to chop and re-base if T1 fails the first time.
    leap_expiry = _next_third_friday(today, 230)
    leap_strike = _round_strike(t2 if phase == "HANDLE" else (t2 + t3) / 2)

    def _fmt_expiry(d: date) -> str:
        # "Jul 17 2026" — short and unambiguous.
        return d.strftime("%b %d %Y").replace(" 0", " ")

    def _fmt_strike(s: float) -> str:
        return f"${s:g}"

    return [
        {
            "kind": "aggressive_call",
            "label": f"{_fmt_expiry(agg_expiry)} {_fmt_strike(agg_strike)}C",
            "option_type": "call",
            "strike": agg_strike,
            "long_strike": None,
            "short_strike": None,
            "expiry": agg_expiry.isoformat(),
            "days_to_expiry": (agg_expiry - today).days,
            "rationale": (
                f"Single OTM call expiring past T2. Captures the T1→T2 leg "
                f"({(agg_expiry - today).days}d to expiry) without short-dated "
                f"theta drag. Higher cost, no upside cap."
            ),
        },
        {
            "kind": "call_debit_spread",
            "label": (
                f"{_fmt_expiry(agg_expiry)} "
                f"{_fmt_strike(spr_long)}/{_fmt_strike(spr_short)} call debit spread"
            ),
            "option_type": "call",
            "strike": None,
            "long_strike": spr_long,
            "short_strike": spr_short,
            "expiry": agg_expiry.isoformat(),
            "days_to_expiry": (agg_expiry - today).days,
            "rationale": (
                f"Long {_fmt_strike(spr_long)} / short {_fmt_strike(spr_short)} "
                f"caps upside at T2 (~{_fmt_strike(spr_short)}) but cuts the cost "
                f"and the IV exposure significantly. Best when IV is elevated or "
                f"the move size is uncertain."
            ),
        },
        {
            "kind": "leap_conviction",
            "label": f"{_fmt_expiry(leap_expiry)} {_fmt_strike(leap_strike)}C",
            "option_type": "call",
            "strike": leap_strike,
            "long_strike": None,
            "short_strike": None,
            "expiry": leap_expiry.isoformat(),
            "days_to_expiry": (leap_expiry - today).days,
            "rationale": (
                f"LEAP-style {_fmt_strike(leap_strike)} call with "
                f"{(leap_expiry - today).days}d runway. For when you believe the "
                f"thesis but want time for the trade to chop and re-base before "
                f"committing. Lower theta, lower gamma — slower payoff."
            ),
        },
    ]


# ----------------------------------------------------------------------------
# Plain-English read — one-glance "what is this and how do I trade it" output.
# Generated deterministically from phase + score + targets, no LLM. Keeps the
# guidance honest and reproducible.
# ----------------------------------------------------------------------------


SizingHint = Literal["skip", "small", "standard", "size_up"]


def _compose_read(
    *,
    phase: Phase,
    bcs_score: int,
    hfs_score: int,
    active_ready: bool,
    ticker_hint: str | None,
    trigger_level: float | None,
    pullback_pct: float | None,
    pct_from_high: float,
    targets: dict | None,
    a_setup: bool = False,
    grade: int = 0,
    flow_ok: bool = False,
) -> dict:
    """Return {setup_type, rarity, sizing_hint, read} as plain English.

    Mental model encoded:
      A-SETUP (all gates) is the strongest read — explicit "GO" framing.
      BASE setups are rare but produce larger, longer moves (Stage 1→2 launches).
      HANDLE setups are common, faster, with tighter expected upside.
      CAUTION / DANGER kill the long thesis regardless of other factors.
    """
    del ticker_hint  # accepted for back-compat, not currently used
    t1_gain = targets["targets"]["t1"]["gain_pct"] if targets else None
    t3_gain = targets["targets"]["t3"]["gain_pct"] if targets else None
    trig_str = f"${trigger_level:.2f}" if trigger_level is not None else "the trigger"

    if phase == "DANGER":
        return {
            "setup_type": "Stage 4 / inverted stack",
            "rarity": "n/a",
            "sizing_hint": "skip",
            "read": (
                "Confirmed downtrend — avoid from the long side regardless of news "
                "or valuation. Wait for the green tint to reappear before scanning "
                "for an entry."
            ),
        }

    if phase == "CAUTION":
        return {
            "setup_type": "Trend weakening",
            "rarity": "n/a",
            "sizing_hint": "skip",
            "read": (
                "Stock has lost the 50 EMA with the 21 EMA rolling. Not yet Stage 4 "
                "but no setup either. Don't initiate longs; existing positions "
                "should watch for a breakdown WARN."
            ),
        }

    if phase == "NEUTRAL":
        return {
            "setup_type": "No setup",
            "rarity": "n/a",
            "sizing_hint": "skip",
            "read": "No actionable setup right now. Low priority — keep moving.",
        }

    # Confluence string used in armed/A-setup narratives
    flow_phrase = "pre-breakout accumulation confirmed" if flow_ok else "pre-breakout accumulation NOT confirmed"
    grade_phrase = f"breakout grade {grade}/5"

    if phase == "BASE":
        if a_setup:
            move_phrase = (
                f"Targets project +{t1_gain:.0f}% to T1 in 2-3wk and +{t3_gain:.0f}% to T3 over 8-12wk."
                if t1_gain is not None and t3_gain is not None
                else "Targets project a multi-month move."
            )
            return {
                "setup_type": "Base launch — A-SETUP GO",
                "rarity": "rare",
                "sizing_hint": "size_up",
                "read": (
                    f"All gates passed on a Stage 1→2 launch — rare and high-conviction. "
                    f"Triggered {trig_str} with {grade_phrase}, {flow_phrase}. "
                    f"{move_phrase} Justifies above-average sizing; defend the trade on a close below the stop."
                ),
            }
        if active_ready:
            move_phrase = (
                f"Targets project +{t1_gain:.0f}% to T1 in 2-3wk and +{t3_gain:.0f}% to T3 over 8-12wk."
                if t1_gain is not None and t3_gain is not None
                else "Targets project a multi-month move."
            )
            return {
                "setup_type": "Base launch (BCS armed)",
                "rarity": "rare",
                "sizing_hint": "size_up",
                "read": (
                    f"Rare setup — Stage 1→2 launch candidate. Stock has gone dormant "
                    f"({pct_from_high:.0f}% off 52w high, ATR contracted, EMAs tight). "
                    f"Armed but not yet fired — needs {trig_str} to break with grade ≥3 AND "
                    f"pre-breakout accumulation. {move_phrase} Set the alert and wait."
                ),
            }
        return {
            "setup_type": "Base forming (BCS)",
            "rarity": "rare",
            "sizing_hint": "small",
            "read": (
                f"Not yet armed — {bcs_score}/5 base conditions met. Worth a price "
                f"alert at {trig_str}; if score climbs to 4/5 and all gates fire on a "
                f"break, this becomes a high-conviction long. Don't pre-position."
            ),
        }

    # HANDLE
    if a_setup:
        move_phrase = (
            f"Targets +{t1_gain:.0f}% to T1 in 2-3wk."
            if t1_gain is not None
            else "Targets in the 2-3 week window."
        )
        return {
            "setup_type": "Handle continuation — A-SETUP GO",
            "rarity": "common",
            "sizing_hint": "standard",
            "read": (
                f"All gates passed on a mid-trend continuation break of {trig_str}. "
                f"{grade_phrase.capitalize()}; {flow_phrase}. {move_phrase} "
                f"Standard sizing — these resolve fast with tighter upside than a base."
            ),
        }
    if active_ready:
        move_phrase = (
            f"Targets +{t1_gain:.0f}% to T1 in 2-3wk."
            if t1_gain is not None
            else "Targets in the 2-3 week window."
        )
        pull_phrase = (
            f" {pullback_pct:.0f}% pullback from the 30-bar swing, holding 50 EMA."
            if pullback_pct is not None
            else ""
        )
        return {
            "setup_type": "Handle continuation (HFS armed)",
            "rarity": "common",
            "sizing_hint": "standard",
            "read": (
                f"Continuation setup, not a base launch — stock is mid-trend taking a breather.{pull_phrase} "
                f"Armed but not yet fired — needs {trig_str} to break with grade ≥3 AND "
                f"pre-breakout accumulation. {move_phrase} Wait for the break."
            ),
        }
    return {
        "setup_type": "Handle forming (HFS)",
        "rarity": "common",
        "sizing_hint": "small",
        "read": (
            f"Forming — {hfs_score}/6. Needs the handle to tighten further before "
            f"it qualifies. Watch the trigger at {trig_str}; don't size up until 4/6."
        ),
    }


def _extract_ohlcv(bars: Sequence[StageBar]) -> tuple[np.ndarray, ...]:
    o = np.array([b["open"] for b in bars], dtype=np.float64)
    h = np.array([b["high"] for b in bars], dtype=np.float64)
    l = np.array([b["low"] for b in bars], dtype=np.float64)
    c = np.array([b["close"] for b in bars], dtype=np.float64)
    v = np.array([b["volume"] for b in bars], dtype=np.float64)
    return o, h, l, c, v


def analyze(bars: Sequence[StageBar], params: StageParams | None = None) -> dict:
    """Run the full Master STAGE analysis.

    Returns the same fields as before plus:
      - grade            (G3a, 0-5 with components)
      - flow             (G3b, OBV slope + up-vol ratio, both pre-breakout)
      - master_verdict   one-line dashboard verdict
      - handle_duration_bars

    `active_ready` continues to mean "G1+G2 satisfied today" (armed and not
    in danger). `fired_today.{bcs,hfs}_breakout` is now Master-gated — it
    only fires when ALL gates pass, which is the indicator's GO marker.
    """
    p = params or StageParams()
    if len(bars) < p.high_52w_lookback:
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

    # G3a Grade needs Bollinger Band series
    bb_basis = sma(c, p.bb_len)
    bb_dev = stdev(c, p.bb_len) * p.bb_mult
    bb_upper = bb_basis + bb_dev
    bb_lower = bb_basis - bb_dev
    # `np.where` evaluates BOTH branches before masking, so divide-by-zero
    # warnings fire even though we throw the result away. Silence them since
    # we already mask on the same condition.
    with np.errstate(divide="ignore", invalid="ignore"):
        bb_width = np.where(
            (~np.isnan(bb_basis)) & (bb_basis != 0),
            (bb_upper - bb_lower) / bb_basis,
            np.nan,
        )
        denom = bb_upper - bb_lower
        bb_pctb = np.where(
            (~np.isnan(denom)) & (denom != 0), (c - bb_lower) / denom, np.nan
        )

    # G3b Flow needs OBV series
    obv_series = obv(c, v)

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
        and atr_now[i] < atr_past * 0.80
    )
    ema_spread1 = abs(ema8_i - ema21_i) / close_i * 100
    ema_spread2 = abs(ema21_i - ema50_i) / close_i * 100
    ema_tight = ema_spread1 < p.ema_tight_pct and ema_spread2 < p.ema_tight_pct * 2
    pct_from_high = (high_52w[i] - close_i) / high_52w[i] * 100
    in_base_zone = p.base_zone_min_pct < pct_from_high < p.base_zone_max_pct

    bcs_score = int(stage2) + int(dry_up) + int(atr_contracted) + int(ema_tight) + int(in_base_zone)
    bcs_ready = bcs_score >= 4

    # ---- HFS conditions (5 original + 1 new duration check; threshold still 4) ----
    emas_stacked = ema8_i > ema21_i > ema50_i > ema200_i
    ema21_rising = not np.isnan(ema21[i - 5]) and ema21_i > ema21[i - 5]
    ema50_rising = not np.isnan(ema50[i - 10]) and ema50_i > ema50[i - 10]
    uptrend = emas_stacked and ema21_rising and ema50_rising

    pullback_pct = (swing_high[i] - close_i) / swing_high[i] * 100
    in_pullback_zone = p.pull_min <= pullback_pct <= p.pull_max
    holding_ema = close_i > ema50_i and l[i] > ema50_i * 0.97

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

    # 6th HFS condition: handle duration in [5, 15] bars (DRIFT.md fix #3)
    handle_duration = _handle_duration_at(
        i=i, h=h, swing_look=p.swing_look, max_lookback=p.swing_look
    )
    handle_duration_ok = (
        handle_duration is not None
        and p.handle_duration_min <= handle_duration <= p.handle_duration_max
    )

    hfs_score = (
        int(uptrend)
        + int(in_pullback_zone)
        + int(holding_ema)
        + int(range_compressed)
        + int(vol_dry_in_handle)
        + int(handle_duration_ok)
    )
    # Threshold still 4/N for parity with prior behavior. With 6 conditions
    # this is stricter than the TV indicator (4/5).
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

    # ---- Phase: deterministic tie-break ladder (DRIFT.md fix #4) ----
    #
    # No hysteresis. When bcs == hfs, the rarer/bigger setup (BASE) wins when
    # both scores are strong (>= 4) — those are the high-conviction setups
    # where the bigger thesis deserves the label. On weaker ties (score 3),
    # HANDLE wins because continuation setups are more common at that level.
    if danger:
        phase: Phase = "DANGER"
    elif caution:
        phase = "CAUTION"
    elif bcs_score > hfs_score:
        phase = "BASE"
    elif hfs_score > bcs_score:
        phase = "HANDLE"
    elif bcs_score >= 4:  # tie at 4+ → bigger thesis wins
        phase = "BASE"
    elif bcs_score >= 3:  # tie at 3 → continuation default
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

    # ---- G3a Grade (today's breakout quality) ----
    grade_value, grade_components, rvol_today = _grade_at(
        i=i,
        p=p,
        h=h,
        l=l,
        v=v,
        vol_ma=vol_ma,
        atr_now=atr_now,
        bb_width=bb_width,
        bb_pctb=bb_pctb,
    )
    grade_ok = grade_value >= p.min_grade

    # ---- G3b Flow (pre-breakout accumulation) ----
    flow_ok, flow_components = _flow_at(i=i, p=p, c=c, v=v, obv_series=obv_series)

    # ---- Master-gated breakout flags ----
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
        bb_width=bb_width,
        bb_pctb=bb_pctb,
        obv_series=obv_series,
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

    recommended_plays = _compute_recommended_plays(
        phase=phase,
        trigger_level=trigger_level,
        targets=targets,
    )

    # ---- Master verdict (mirrors TV dashboard's "VERDICT" cell) ----
    a_setup = bool(bcs_breakout or hfs_breakout)
    if danger:
        master_verdict = "DANGER - SKIP"
    elif a_setup:
        master_verdict = "A-SETUP - GO"
    elif active_ready:
        master_verdict = "ARMED - WAIT FOR BREAK"
    elif caution:
        master_verdict = "CAUTION - NO NEW LONGS"
    else:
        master_verdict = "WATCH / NEUTRAL"

    read = _compose_read(
        phase=phase,
        bcs_score=bcs_score,
        hfs_score=hfs_score,
        active_ready=active_ready,
        ticker_hint=None,
        trigger_level=trigger_level,
        pullback_pct=float(pullback_pct) if not np.isnan(pullback_pct) else None,
        pct_from_high=float(pct_from_high),
        targets=targets,
        a_setup=a_setup,
        grade=grade_value,
        flow_ok=flow_ok,
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
        "recommended_plays": recommended_plays,
        "read": read,
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
            "handle_duration_ok": bool(handle_duration_ok),
        },
        "pullback_pct": round(float(pullback_pct), 2) if not np.isnan(pullback_pct) else None,
        "pct_from_52w_high": round(float(pct_from_high), 2),
        "handle_duration_bars": handle_duration,
        "fired_today": {
            "bcs_breakout": bool(bcs_breakout),
            "hfs_breakout": bool(hfs_breakout),
            "breakdown_warn": bool(breakdown_warn),
        },
        "danger": {"stage4": bool(stage4), "bear_stack": bool(bear_stack)},
        "grade": {
            "value": int(grade_value),
            "min_required": p.min_grade,
            "ok": bool(grade_ok),
            "rvol": round(float(rvol_today), 3),
            "components": grade_components,
        },
        "flow": flow_components,
        "master_verdict": master_verdict,
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
    bb_width: np.ndarray,
    bb_pctb: np.ndarray,
    obv_series: np.ndarray,
) -> tuple[bool, bool, bool]:
    """Did a Master A-setup fire on bar `i`? Returns
    (bcs_master, hfs_master, breakdown_warn).

    A master fire requires ALL gates:
      G1  not in danger (handled upstream; analyze() only labels DANGER when
          danger=True, which gates phase out of BASE/HANDLE and trigger_level
          to None — so the price test below short-circuits)
      G2  bcs_ready_prev or hfs_ready_prev (armed yesterday) AND
          close > trigger AND
          volume > vol_ma[i-1] * breakout_vol (REPAINT FIX vs TV).
      G3a grade >= min_grade
      G3b flow_ok (pre-breakout accumulation)

    Breakdown WARN is unchanged in concept but uses vol_ma[i-1] for parity
    with the same repaint fix.
    """
    if i < 1:
        return False, False, False

    j = i - 1  # "yesterday"

    # Repaint-fixed volume benchmark
    vol_ma_prev = vol_ma[i - 1] if i - 1 >= 0 else np.nan
    vol_ok_today = (
        not np.isnan(vol_ma_prev)
        and vol_ma_prev > 0
        and v[i] > vol_ma_prev * p.breakout_vol
    )

    # G3a/G3b — same evaluation as analyze() but recomputed here so this
    # function stays self-contained for tests.
    grade_value, _grade_components, _rvol = _grade_at(
        i=i,
        p=p,
        h=h,
        l=l,
        v=v,
        vol_ma=vol_ma,
        atr_now=atr_now,
        bb_width=bb_width,
        bb_pctb=bb_pctb,
    )
    grade_ok = grade_value >= p.min_grade
    flow_ok, _flow_components = _flow_at(i=i, p=p, c=c, v=v, obv_series=obv_series)

    # ---- BCS Master breakout ----
    bcs_ready_prev = _bcs_ready_at(
        j, p, c, ema50, ema200, vol_ma, vol_ma_50, atr_now, ema8, ema21, high_52w
    )
    prior_high_20 = float(np.max(h[i - 20 : i])) if i >= 20 else np.inf
    bcs_breakout = bool(
        bcs_ready_prev
        and c[i] > prior_high_20
        and vol_ok_today
        and c[i] > o[i]
        and grade_ok
        and flow_ok
    )

    # ---- HFS Master breakout ----
    hfs_ready_prev = _hfs_ready_at(
        j, p, c, h, l, v, ema8, ema21, ema50, ema200, vol_ma, swing_high
    )
    handle_high = float(np.max(h[i - p.handle_max : i])) if i >= p.handle_max else np.inf
    hfs_breakout = bool(
        hfs_ready_prev
        and c[i] > handle_high
        and vol_ok_today
        and c[i] > o[i]
        and grade_ok
        and flow_ok
    )

    # ---- Breakdown WARN — uptrend 5 bars ago, now under 50 EMA on heavy vol ----
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
        # Same vol_ma[i-1] repaint fix here.
        heavy_vol = (
            not np.isnan(vol_ma_prev)
            and vol_ma_prev > 0
            and v[i] > vol_ma_prev * 1.3
        )
        breakdown = bool(uptrend_5_bars_ago and c[i] < ema50[i] and heavy_vol)

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

    # 6th condition — handle duration (DRIFT.md fix #3). Mirrors analyze().
    handle_duration = _handle_duration_at(
        i=i, h=h, swing_look=p.swing_look, max_lookback=p.swing_look
    )
    handle_duration_ok = (
        handle_duration is not None
        and p.handle_duration_min <= handle_duration <= p.handle_duration_max
    )

    score = (
        int(uptrend)
        + int(in_pullback_zone)
        + int(holding_ema)
        + int(range_compressed)
        + int(vol_dry_in_handle)
        + int(handle_duration_ok)
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
            "handle_duration_ok": False,
        },
        "pullback_pct": None,
        "pct_from_52w_high": None,
        "handle_duration_bars": None,
        "fired_today": {
            "bcs_breakout": False,
            "hfs_breakout": False,
            "breakdown_warn": False,
        },
        "danger": {"stage4": False, "bear_stack": False},
        "targets": None,
        "recommended_plays": [],
        "read": {
            "setup_type": "Insufficient history",
            "rarity": "n/a",
            "sizing_hint": "skip",
            "read": "Not enough bars yet to compute the indicator. Wait for more history.",
        },
        "grade": {
            "value": 0,
            "min_required": 3,
            "ok": False,
            "rvol": 0.0,
            "components": {
                "volume_surge": False,
                "pre_break_tightness": False,
                "range_expansion": False,
                "bb_thrust": False,
                "bb_expanding": False,
            },
        },
        "flow": {
            "ok": False,
            "obv_slope": 0.0,
            "obv_slope_positive": False,
            "up_vol_ratio": None,
            "up_vol_ratio_ok": False,
        },
        "master_verdict": "WATCH / NEUTRAL",
        "insufficient_history": True,
    }
