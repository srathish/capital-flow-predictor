"""Talon v2 Phase 1.3 — whale order concentration.

The signal that made our manual workups so powerful (the $2M single-strike
print on CRWV 6/18 $117C) is currently invisible to v1's aggregate
delta-buildup metric. This module aggregates UW flow_alerts per ticker,
finds the most concentrated strike/expiry, and scores how unusual it is.

Per ticker output:

  whale_total_prem_5d      : $ of ask-side call premium over last ~5 sessions
  whale_top_strike         : the single strike accumulating the most $
  whale_top_expiry         : expiry of that top strike
  whale_top_strike_prem    : $ concentrated on that one strike
  whale_concentration_pct  : top_strike_prem / total_prem (0-1)
  whale_n_alerts           : total ask-side alerts in window
  whale_sweep_count        : how many had has_sweep=true
  whale_floor_count        : how many had has_floor=true
  whale_score              : 0-1 composite — higher = more concentrated whale flow
  whale_flag               : True if score >= 0.6 AND total_prem >= 250K
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any


def _safe_float(x: Any) -> float:
    try:
        return float(x) if x is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def compute_whale_signals(alerts: list[dict] | None) -> dict:
    out: dict = {
        "whale_total_prem_5d": 0.0,
        "whale_top_strike": None,
        "whale_top_expiry": None,
        "whale_top_strike_prem": 0.0,
        "whale_concentration_pct": None,
        "whale_n_alerts": 0,
        "whale_sweep_count": 0,
        "whale_floor_count": 0,
        "whale_score": None,
        "whale_flag": False,
    }
    if not alerts:
        return out

    by_strike: dict[tuple[Any, Any], float] = defaultdict(float)
    total_prem = 0.0
    sweep_count = 0
    floor_count = 0
    n = 0
    for a in alerts:
        prem = _safe_float(
            a.get("total_ask_side_prem")
            or a.get("total_premium")
            or a.get("premium")
        )
        if prem <= 0:
            continue
        strike = a.get("strike")
        expiry = a.get("expiry") or a.get("expiration") or a.get("expiry_date")
        by_strike[(strike, expiry)] += prem
        total_prem += prem
        if a.get("has_sweep"):
            sweep_count += 1
        if a.get("has_floor"):
            floor_count += 1
        n += 1

    out["whale_total_prem_5d"] = round(total_prem, 2)
    out["whale_n_alerts"] = n
    out["whale_sweep_count"] = sweep_count
    out["whale_floor_count"] = floor_count

    if not by_strike:
        return out

    top = max(by_strike.items(), key=lambda x: x[1])
    (top_strike, top_expiry), top_prem = top
    out["whale_top_strike"] = top_strike
    out["whale_top_expiry"] = top_expiry
    out["whale_top_strike_prem"] = round(top_prem, 2)
    if total_prem > 0:
        out["whale_concentration_pct"] = round(top_prem / total_prem, 4)

    # Composite score: log-scaled total premium (40%) + concentration (30%)
    # + sweep ratio (15%) + floor ratio (15%)
    # log scale: $100K = 0.40, $500K = 0.62, $2M = 0.85, $10M = 1.0
    prem_pts = max(0.0, min(1.0, math.log10(max(total_prem, 1)) / 7.0))
    conc_pts = out["whale_concentration_pct"] or 0.0
    sweep_pts = (sweep_count / n) if n > 0 else 0.0
    floor_pts = (floor_count / n) if n > 0 else 0.0
    score = (
        0.40 * prem_pts
        + 0.30 * conc_pts
        + 0.15 * sweep_pts
        + 0.15 * floor_pts
    )
    out["whale_score"] = round(score, 4)
    out["whale_flag"] = score >= 0.60 and total_prem >= 250_000
    return out
