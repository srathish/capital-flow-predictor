"""Talon v2 Phase 5 — 1-2 month swing eligibility.

Talon v1/v2 surfaces *current* flow setups. This phase re-filters those
setups for the tighter holding window we want: 30-75 day options,
15-30% OTM strikes, with a catalyst inside the holding window.

This window is deliberately shorter than the IREN-style LEAPS trade —
it leans on the whale-flow data that already maxes at 75 DTE and the
near-term earnings catalysts that move stocks on the 30-day horizon.

It does NOT mutate the v1 grade. It surfaces three new fields per row:

  swing_eligible   : bool — passes all hard gates
  swing_score      : 0..1 composite — higher = better swing candidate
  swing_dte_strike : int  — DTE of the whale's dominant strike expiry
  swing_target_dte : int  — recommended option DTE for a fresh entry
  swing_reasons    : list[str] — why it qualified
  swing_blockers   : list[str] — why it didn't

Gate logic mirrors the framework we settled on:

  1. OI build in window: whale's dominant strike expiry is 30-75 DTE
     (no weeklies, no LEAPS — fits the 1-2 month swing)
  2. Institutional premium: whale_total_prem_5d >= $100K (any
     real flow at all, not retail noise)
  3. Earnings risk: not "imminent" (<=7d). Earnings 14-60 days out
     is ideal — has to fire INSIDE the holding window.
  4. Structure intact: stock is above 20d MA, or v2 patterns flagged
     a coiled / base setup (trend or accumulation phase, not capitulation)
  5. v1 quality: grade >= 50 (passed basic flow gates already)

Soft signals (boost score but don't gate):
  - dp_block_flag       (dark pool accumulation)
  - whale_concentration (top strike concentration ratio)
  - news_flag           (catalyst already firing)
  - insider buy cluster

Scoring weights (sum to 1.00):
  whale_premium       0.25   log-scaled $ in institutional calls
  whale_concentration 0.15   single-strike conviction
  catalyst_window     0.15   dte_to_earnings sweet spot ~30d
  structure           0.15   MA + pattern alignment
  v1_grade            0.15   normalized 50-100 -> 0-1
  bonus_signals       0.15   dp block, news, insider extras

Strike selection target: 15-30% OTM, ~60 DTE at entry. Caller
picks the actual contract; this module just computes the eligibility
and recommended DTE — strike picking lives in talon_v2_top_plays.
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any

# ---------------------------------------------------------------------------
# Hard gates — must all pass for `swing_eligible = True`
# ---------------------------------------------------------------------------
SWING_DTE_MIN = 30     # below 30 = monthly OpEx week noise / theta cliff
SWING_DTE_MAX = 75     # matches Talon's whale-flow fetch window
SWING_PREM_FLOOR = 100_000.0    # min whale_total_prem_5d to count
SWING_GRADE_FLOOR = 50.0        # min v1 grade
SWING_CATALYST_DTE_MIN = 14     # earnings too close = IV crush risk
SWING_CATALYST_DTE_MAX = 60     # earnings must fire inside the 1-2 month hold

# Recommended option DTE at entry — keeps you outside the gamma/theta cliff
# while staying inside the catalyst window
SWING_TARGET_DTE = 60
SWING_TARGET_PEAK_CATALYST = 30  # peak of the catalyst-window triangle

# Scoring weights — sum should equal 1.00
W_PREM = 0.25
W_CONC = 0.15
W_CATALYST = 0.15
W_STRUCTURE = 0.15
W_GRADE = 0.15
W_BONUS = 0.15


def _parse_iso(s: Any) -> date | None:
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.split("T")[0]).date()
    except (ValueError, AttributeError):
        return None


def _dte_from(expiry: Any, scan_date: date) -> int | None:
    d = _parse_iso(expiry)
    if d is None:
        return None
    return (d - scan_date).days


def _premium_score(total_prem: float) -> float:
    """Log-scaled: $100K = 0.30, $500K = 0.55, $2M = 0.75, $10M = 1.0."""
    if total_prem <= 0:
        return 0.0
    return max(0.0, min(1.0, math.log10(max(total_prem, 1)) / 7.0))


def _catalyst_score(dte_to_earnings: int | None) -> float:
    """Triangle peaks at SWING_TARGET_PEAK_CATALYST (30 DTE) — far enough
    out to avoid IV crush, close enough that the catalyst will fire
    inside the hold window."""
    if dte_to_earnings is None:
        # No catalyst data — partial credit. Don't punish hard.
        return 0.40
    if dte_to_earnings < SWING_CATALYST_DTE_MIN or dte_to_earnings > SWING_CATALYST_DTE_MAX:
        return 0.0
    peak = SWING_TARGET_PEAK_CATALYST
    if dte_to_earnings <= peak:
        return (dte_to_earnings - SWING_CATALYST_DTE_MIN) / (peak - SWING_CATALYST_DTE_MIN)
    return 1.0 - (dte_to_earnings - peak) / (SWING_CATALYST_DTE_MAX - peak)


def _structure_score(row: dict) -> float:
    """Reward stocks above their key MAs or with a base pattern."""
    above_20 = row.get("above_20d")
    above_50 = row.get("above_50d")
    above_200 = row.get("above_200d")
    coiled = bool(row.get("coiled"))
    pattern = row.get("pattern")  # flat_base / cup_handle / pullback / htf

    pts = 0.0
    if above_200 == 1:
        pts += 0.30
    if above_50 == 1:
        pts += 0.30
    if above_20 == 1:
        pts += 0.20
    if coiled:
        pts += 0.10
    if pattern in {"flat_base", "cup_handle", "htf", "pullback"}:
        pts += 0.10
    return min(1.0, pts)


def _grade_score(grade: float | None) -> float:
    if grade is None:
        return 0.0
    return max(0.0, min(1.0, (grade - 50.0) / 50.0))


def _bonus_score(row: dict) -> float:
    """Extras that add conviction but aren't required."""
    pts = 0.0
    if row.get("dp_block_flag"):
        pts += 0.35
    if row.get("news_flag"):
        pts += 0.25
    if row.get("insider_cluster_buy"):
        pts += 0.20
    if row.get("squeeze_trigger_flag"):
        pts += 0.20
    return min(1.0, pts)


def compute_swing_signals(row: dict, scan_date: date) -> dict:
    """Compute swing-eligibility signals for a single Talon v2 row.

    The row is read-only here — caller merges the result back into the row.
    """
    out: dict[str, Any] = {
        "swing_eligible": False,
        "swing_score": 0.0,
        "swing_dte_strike": None,
        "swing_target_dte": None,
        "swing_reasons": [],
        "swing_blockers": [],
    }

    reasons: list[str] = []
    blockers: list[str] = []

    # ---- Hard gate 1: whale's dominant strike expiry inside swing window
    whale_top_expiry = row.get("whale_top_expiry")
    dte_strike = _dte_from(whale_top_expiry, scan_date) if whale_top_expiry else None
    out["swing_dte_strike"] = dte_strike
    if dte_strike is None:
        blockers.append("no_whale_expiry")
    elif dte_strike < SWING_DTE_MIN:
        blockers.append(f"whale_expiry_too_short_{dte_strike}d")
    elif dte_strike > SWING_DTE_MAX:
        blockers.append(f"whale_expiry_too_long_{dte_strike}d")
    else:
        reasons.append(f"whale_dte_{dte_strike}d")

    # ---- Hard gate 2: institutional premium floor
    total_prem = float(row.get("whale_total_prem_5d") or 0)
    if total_prem < SWING_PREM_FLOOR:
        blockers.append(f"low_whale_prem_{int(total_prem):,}")
    else:
        reasons.append(f"whale_prem_{int(total_prem):,}")

    # ---- Hard gate 3: not imminent earnings
    earnings_risk = row.get("earnings_risk")
    dte_to_earnings = row.get("dte_to_earnings")
    if earnings_risk == "imminent":
        blockers.append(f"earnings_imminent_{dte_to_earnings}d")
    elif (
        dte_to_earnings is not None
        and isinstance(dte_to_earnings, int)
        and 0 <= dte_to_earnings <= SWING_CATALYST_DTE_MAX
    ):
        reasons.append(f"earnings_{dte_to_earnings}d")

    # ---- Hard gate 4: structure not broken
    above_20 = row.get("above_20d")
    above_50 = row.get("above_50d")
    coiled = bool(row.get("coiled"))
    pattern = row.get("pattern")
    structure_ok = (
        above_20 == 1
        or above_50 == 1
        or coiled
        or pattern in {"flat_base", "cup_handle", "htf", "pullback"}
    )
    if not structure_ok:
        blockers.append("structure_broken")
    else:
        if above_50 == 1:
            reasons.append("above_50d")
        if coiled:
            reasons.append("coiled")
        if pattern:
            reasons.append(f"pattern_{pattern}")

    # ---- Hard gate 5: v1 grade floor
    grade = row.get("grade")
    if grade is None or grade < SWING_GRADE_FLOOR:
        blockers.append(f"low_grade_{grade}")
    else:
        reasons.append(f"grade_{grade:.0f}")

    out["swing_reasons"] = reasons
    out["swing_blockers"] = blockers
    out["swing_eligible"] = len(blockers) == 0

    # ---- Composite score (always computed — even ineligible rows get a number
    # so we can rank near-misses for the watchlist tier)
    prem_pts = _premium_score(total_prem)
    conc_pts = float(row.get("whale_concentration_pct") or 0)
    cat_pts = _catalyst_score(dte_to_earnings if isinstance(dte_to_earnings, int) else None)
    struct_pts = _structure_score(row)
    grade_pts = _grade_score(grade)
    bonus_pts = _bonus_score(row)

    score = (
        W_PREM * prem_pts
        + W_CONC * conc_pts
        + W_CATALYST * cat_pts
        + W_STRUCTURE * struct_pts
        + W_GRADE * grade_pts
        + W_BONUS * bonus_pts
    )
    out["swing_score"] = round(score, 4)

    # ---- Recommended option DTE at entry
    # If the whale's strike sits in the 30-60 DTE sweet spot, ride that
    # exact contract. Otherwise default to SWING_TARGET_DTE (60).
    if dte_strike is not None and SWING_DTE_MIN <= dte_strike <= SWING_TARGET_DTE:
        out["swing_target_dte"] = dte_strike
    else:
        out["swing_target_dte"] = SWING_TARGET_DTE

    return out


def rank_swing_setups(rows: list[dict], min_score: float = 0.50) -> list[dict]:
    """Filter and sort rows for the swing_setups tier in the scan output."""
    candidates = [
        r for r in rows
        if r.get("swing_eligible") and (r.get("swing_score") or 0) >= min_score
    ]
    candidates.sort(key=lambda r: r.get("swing_score") or 0, reverse=True)
    return candidates
