"""Score each Talon setup against May 18-28 price action.

Scoring rubric per ticker (bullish unless noted):
  triggered          — did price tag the entry zone? (always True for actionable; for OTE
                       watch with explicit OTE, requires low <= OTE [bullish] / high >= OTE [bearish])
  entry_price        — current (actionable) or OTE (watch). For bearish: current or OTE rally zone.
  st_window          — May 18 through May 22 (5 trading days). Window for short-term GEX target.
  st_target_hit      — bullish: max(High) in ST window >= st_target.  bearish: min(Low) <= st_target.
  st_target_hit_full — same check extended through May 28 (full data window).
  inval_breached     — bullish: any daily close < soft_inval through May 28. bearish: close > soft_inval.
  direction_correct_1d/5d — sign(forward return from May 18 close) matches direction.
  mfe / mae          — max favorable / adverse excursion from entry, in %.
  planned_R          — (st_target - entry) / (entry - soft_inval).  Both flipped sign for bearish.
  realized_R         — mfe / |entry - soft_inval|.  Negative if mae > mfe and inval breached first.
  failure_first      — did intraday low/high hit invalidation BEFORE st_target? (timing check)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import yaml

from .ohlc import fetch_all

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "reference" / "2026-05-18.yaml"

SCAN_DATE = pd.Timestamp("2026-05-18")
ST_WINDOW_END = pd.Timestamp("2026-05-22")  # short-term GEX window: May 18-22 inclusive


@dataclass
class Score:
    ticker: str
    category: str
    grade: int | None
    direction: str
    current: float
    entry_price: float
    soft_inval: float
    st_target: float | None
    swing_targets: list                # all swing/VEX rungs from scan
    triggered: bool
    st_target_hit: bool | None         # within May 18-22; None if no st_target
    st_target_hit_full: bool | None    # extended through full window
    swing_hits: list                   # list of swing levels actually tagged (bool per rung)
    highest_swing_idx: int             # -1 if none tagged; else 0-based index of highest rung tagged
    inval_breached: bool               # any close past inval through full window
    inval_breached_date: str | None
    ret_1d: float
    ret_2d: float
    ret_5d: float
    ret_full: float                    # close-to-close, full window (May 18 → last bar)
    n_days_full: int                   # trading days in full window (for context: 10 = 2 weeks)
    mfe_pct: float                     # signed in trade-direction terms (positive = favorable)
    mae_pct: float                     # signed in trade-direction terms (positive = adverse magnitude)
    planned_R: float | None
    realized_R: float | None           # honors soft_inval rule (-1 if closed past inval first)
    max_R_if_held: float | None        # ignores inval — pure mfe/risk
    direction_correct_1d: bool
    direction_correct_5d: bool
    direction_correct_full: bool       # signed return positive over full window
    failure_first: bool | None         # None if neither target nor inval hit
    notes: str = ""


def _max_favorable(entry: float, highs: pd.Series, lows: pd.Series, direction: str) -> float:
    """Max favorable excursion in % from entry."""
    if direction == "bullish":
        return float((highs.max() - entry) / entry)
    return float((entry - lows.min()) / entry)


def _max_adverse(entry: float, highs: pd.Series, lows: pd.Series, direction: str) -> float:
    """Max adverse excursion in % from entry (returned as positive magnitude)."""
    if direction == "bullish":
        return float((entry - lows.min()) / entry)
    return float((highs.max() - entry) / entry)


def _first_hit_index(series: pd.Series, level: float, comparator: str) -> int | None:
    """Return the row index (0-based) of the first bar where comparator vs level is True."""
    if comparator == ">=":
        mask = series >= level
    elif comparator == "<=":
        mask = series <= level
    else:
        raise ValueError(comparator)
    if not mask.any():
        return None
    return int(mask.argmax())


def score_one(setup: dict, bars: pd.DataFrame) -> Score:
    direction = setup["direction"]
    grade = setup.get("grade")
    category = setup["category"]
    current_raw = setup.get("current")
    current = float(current_raw) if current_raw is not None else float("nan")
    soft_inval_raw = setup.get("soft_inval")
    soft_inval = float(soft_inval_raw) if soft_inval_raw is not None else float("nan")
    st_target_raw = setup.get("st_target")
    st_target = float(st_target_raw) if st_target_raw is not None else None
    swing_targets = [float(s) for s in (setup.get("swing") or [])]
    ote = setup.get("ote")
    trigger = setup.get("trigger")

    # Thematic-only mentions: no published levels, score on returns only
    if category == "thematic_bullish" or pd.isna(soft_inval):
        c0 = float(bars["Close"].iloc[0])
        c_last = float(bars["Close"].iloc[-1])
        c1 = float(bars["Close"].iloc[1]) if len(bars) > 1 else float("nan")
        c2 = float(bars["Close"].iloc[2]) if len(bars) > 2 else float("nan")
        c5 = float(bars["Close"].iloc[5]) if len(bars) > 5 else c_last
        sign = 1 if direction == "bullish" else -1
        ret_1d = sign * (c1 - c0) / c0 if not math.isnan(c1) else float("nan")
        ret_2d = sign * (c2 - c0) / c0 if not math.isnan(c2) else float("nan")
        ret_5d = sign * (c5 - c0) / c0
        ret_full = sign * (c_last - c0) / c0
        # MFE/MAE from May 18 open (closest thing to "what you'd see at scan time")
        entry = float(bars["Open"].iloc[0])
        mfe = _max_favorable(entry, bars["High"], bars["Low"], direction)
        mae = _max_adverse(entry, bars["High"], bars["Low"], direction)
        return Score(
            ticker=setup["ticker"], category=category, grade=grade, direction=direction,
            current=current, entry_price=entry, soft_inval=soft_inval, st_target=None,
            swing_targets=swing_targets,
            triggered=True, st_target_hit=None, st_target_hit_full=None,
            swing_hits=[], highest_swing_idx=-1,
            inval_breached=False, inval_breached_date=None,
            ret_1d=ret_1d, ret_2d=ret_2d, ret_5d=ret_5d,
            ret_full=ret_full, n_days_full=len(bars),
            mfe_pct=mfe, mae_pct=mae,
            planned_R=None, realized_R=None, max_R_if_held=None,
            direction_correct_1d=ret_1d > 0,
            direction_correct_5d=ret_5d > 0,
            direction_correct_full=ret_full > 0,
            failure_first=None, notes="thematic mention — no published levels",
        )

    # Entry price logic, in priority order:
    #   1) `ote` set (pullback / rally rejection) — wait for OTE tag
    #        bullish: low <= ote   |   bearish: high >= ote
    #   2) `trigger` set (bullish breakout) — wait for high >= trigger
    #   3) else: enter at published `current` price
    if ote is not None:
        ote_f = float(ote)
        if direction == "bullish":
            triggered = bool((bars["Low"] <= ote_f).any())
        else:
            triggered = bool((bars["High"] >= ote_f).any())
        entry_price = ote_f
    elif trigger is not None and direction == "bullish":
        trig_f = float(trigger)
        triggered = bool((bars["High"] >= trig_f).any())
        entry_price = trig_f
    else:
        triggered = True
        entry_price = current

    # If not triggered, skip target/R math
    if not triggered:
        return Score(
            ticker=setup["ticker"], category=category, grade=grade, direction=direction,
            current=current, entry_price=entry_price, soft_inval=soft_inval, st_target=st_target,
            swing_targets=swing_targets,
            triggered=False, st_target_hit=None, st_target_hit_full=None,
            swing_hits=[False] * len(swing_targets), highest_swing_idx=-1,
            inval_breached=False, inval_breached_date=None,
            ret_1d=float("nan"), ret_2d=float("nan"), ret_5d=float("nan"),
            ret_full=float("nan"), n_days_full=len(bars),
            mfe_pct=float("nan"), mae_pct=float("nan"),
            planned_R=None, realized_R=None, max_R_if_held=None,
            direction_correct_1d=False, direction_correct_5d=False, direction_correct_full=False,
            failure_first=None, notes="OTE not triggered in window",
        )

    # ST target hit check (May 18-22)
    st_bars = bars.loc[bars.index <= ST_WINDOW_END]
    if st_target is None:
        st_target_hit = None
        st_target_hit_full = None
    elif direction == "bullish":
        st_target_hit = bool((st_bars["High"] >= st_target).any())
        st_target_hit_full = bool((bars["High"] >= st_target).any())
    else:
        st_target_hit = bool((st_bars["Low"] <= st_target).any())
        st_target_hit_full = bool((bars["Low"] <= st_target).any())

    # Swing-target hits across full window. Bullish: High >= rung. Bearish: Low <= rung.
    swing_hits: list[bool] = []
    for rung in swing_targets:
        if direction == "bullish":
            swing_hits.append(bool((bars["High"] >= rung).any()))
        else:
            swing_hits.append(bool((bars["Low"] <= rung).any()))
    highest_swing_idx = max((i for i, h in enumerate(swing_hits) if h), default=-1)

    # Invalidation breach (close past inval)
    if direction == "bullish":
        breach_mask = bars["Close"] < soft_inval
    else:
        breach_mask = bars["Close"] > soft_inval
    inval_breached = bool(breach_mask.any())
    inval_breached_date = (
        bars.index[breach_mask.argmax()].strftime("%Y-%m-%d") if inval_breached else None
    )

    # Forward returns from May 18 close (proxy for "trade entered on scan day")
    closes = bars["Close"]
    c0 = float(closes.iloc[0])
    c1 = float(closes.iloc[1]) if len(closes) > 1 else float("nan")
    c2 = float(closes.iloc[2]) if len(closes) > 2 else float("nan")
    c5 = float(closes.iloc[5]) if len(closes) > 5 else float(closes.iloc[-1])
    ret_1d_raw = (c1 - c0) / c0 if not math.isnan(c1) else float("nan")
    ret_2d_raw = (c2 - c0) / c0 if not math.isnan(c2) else float("nan")
    ret_5d_raw = (c5 - c0) / c0

    sign = 1 if direction == "bullish" else -1
    ret_1d = sign * ret_1d_raw
    ret_2d = sign * ret_2d_raw
    ret_5d = sign * ret_5d_raw

    # Full-window return: May 18 close → last available close (May 28 = ~10 trading days, ~2 wks)
    c_last = float(closes.iloc[-1])
    ret_full_raw = (c_last - c0) / c0
    ret_full = sign * ret_full_raw
    n_days_full = len(closes)
    direction_correct_full = ret_full > 0

    # MFE / MAE from entry across full window
    mfe = _max_favorable(entry_price, bars["High"], bars["Low"], direction)
    mae = _max_adverse(entry_price, bars["High"], bars["Low"], direction)

    # Planned R (using entry + inval + st_target)
    risk_per_share = abs(entry_price - soft_inval)
    if st_target is not None and risk_per_share > 0:
        reward = abs(st_target - entry_price)
        planned_R = reward / risk_per_share
    else:
        planned_R = None

    # Realized R: by Talon's rules a CLOSE past soft_inval = exit at inval. Wicks are OK.
    # Compare timing of target-touch (High wick OK) vs inval-close (Close required).
    if risk_per_share > 0:
        if direction == "bullish":
            target_hit_idx = _first_hit_index(bars["High"], st_target, ">=") if st_target else None
            inval_close_idx = _first_hit_index(bars["Close"], soft_inval, "<=")
        else:
            target_hit_idx = _first_hit_index(bars["Low"], st_target, "<=") if st_target else None
            inval_close_idx = _first_hit_index(bars["Close"], soft_inval, ">=")

        max_R_if_held = (mfe * entry_price) / risk_per_share

        if target_hit_idx is not None and (
            inval_close_idx is None or target_hit_idx <= inval_close_idx
        ):
            # Target touched on/before any inval-close → +1R (capture st_target reward)
            realized_R = abs(st_target - entry_price) / risk_per_share
            failure_first = False
        elif inval_close_idx is not None:
            # Closed past inval first → exit at inval = -1R
            realized_R = -1.0
            failure_first = True
        else:
            # Neither hit cleanly — use end-of-window close
            realized_R = (ret_5d * entry_price) / risk_per_share
            failure_first = None
    else:
        realized_R = None
        max_R_if_held = None
        failure_first = None

    direction_correct_1d = ret_1d > 0 if not math.isnan(ret_1d) else False
    direction_correct_5d = ret_5d > 0 if not math.isnan(ret_5d) else False

    return Score(
        ticker=setup["ticker"], category=category, grade=grade, direction=direction,
        current=current, entry_price=entry_price, soft_inval=soft_inval, st_target=st_target,
        swing_targets=swing_targets,
        triggered=True, st_target_hit=st_target_hit, st_target_hit_full=st_target_hit_full,
        swing_hits=swing_hits, highest_swing_idx=highest_swing_idx,
        inval_breached=inval_breached, inval_breached_date=inval_breached_date,
        ret_1d=ret_1d, ret_2d=ret_2d, ret_5d=ret_5d,
        ret_full=ret_full, n_days_full=n_days_full,
        mfe_pct=mfe, mae_pct=mae,
        planned_R=planned_R, realized_R=realized_R, max_R_if_held=max_R_if_held,
        direction_correct_1d=direction_correct_1d, direction_correct_5d=direction_correct_5d,
        direction_correct_full=direction_correct_full,
        failure_first=failure_first,
    )


def score_all() -> pd.DataFrame:
    with REF.open() as f:
        scan = yaml.safe_load(f)
    bars_all = fetch_all(use_cache=True)
    rows = []
    for setup in scan["tickers"]:
        t = setup["ticker"]
        bars = bars_all.get(t)
        if bars is None or bars.empty:
            print(f"  SKIP {t}: no bars")
            continue
        s = score_one(setup, bars)
        rows.append(s.__dict__)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    df = score_all()
    print(f"\nScored {len(df)} setups.")
    out_path = ROOT / "output" / "phase1_per_ticker.csv"
    out_path.parent.mkdir(exist_ok=True)
    df.to_csv(out_path, index=False)
    print(f"Wrote {out_path}")
    print()
    summary = df[["ticker", "grade", "direction", "triggered", "st_target_hit",
                  "inval_breached", "ret_5d", "realized_R", "failure_first"]]
    print(summary.to_string(index=False))
