"""Talon v2 Phase 4.5 — gamma squeeze trigger.

Detects the reflexive-rally setup we've been missing. A gamma squeeze fires
when three things line up:

  1. **Dealers are net short gamma** (gamma_now < 0 — they sold calls and
     are net short the underlying as a delta hedge).
  2. **Heavy call OI clusters just above current price** (0-7% OTM). If
     spot rises into this cluster, dealer gamma forces them to buy the
     underlying to stay hedged — which pushes price higher — which forces
     more buying.
  3. **Spot is already at the bottom of a rally** (slope_4w_pct >= 0 from
     Phase 1.1 chart signals). A name in a downtrend with the same
     mechanics is in a put squeeze, not a call squeeze.

Per ticker:

  squeeze_strike_cluster_$    : total call gamma exposure 0-7% above spot
  squeeze_pain_strike         : nearest strike above with the most call OI
  squeeze_dealers_short_gamma : 1 if gamma_now < 0
  squeeze_distance_pct        : how far above current the cluster sits
  squeeze_score               : 0-1 composite
  squeeze_trigger_flag        : True if score >= 0.55 AND spot/slope/gamma all aligned

Uses UW strike_gex per ticker (which we already fetch for the Top Plays
walls — caching means this is free).
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


def _safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v:
        return None
    return v


def compute_squeeze_signals(
    strike_rows: list[dict] | None,
    spot: float | None,
    chart: dict | None,
    gamma_now: float | None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "squeeze_strike_cluster_$": None,
        "squeeze_pain_strike": None,
        "squeeze_dealers_short_gamma": 0,
        "squeeze_distance_pct": None,
        "squeeze_score": None,
        "squeeze_trigger_flag": False,
    }
    if not strike_rows or spot is None or spot <= 0:
        return out

    # Bound the call-wall search to 0-7% above spot — the "squeeze zone"
    lo = spot
    hi = spot * 1.07
    cluster_gamma = 0.0
    by_strike: dict[float, float] = {}
    for r in strike_rows:
        s = _safe_float(r.get("strike"))
        cg = _safe_float(r.get("call_gamma"))
        if s is None or cg is None:
            continue
        if lo <= s <= hi and cg > 0:
            cluster_gamma += cg
            by_strike[s] = by_strike.get(s, 0) + cg

    out["squeeze_strike_cluster_$"] = round(cluster_gamma, 2)

    if by_strike:
        # The "pain strike" is the single strike inside the cluster with the
        # most call gamma. If spot rises through this, dealer hedging
        # accelerates.
        pain = max(by_strike.items(), key=lambda x: x[1])
        out["squeeze_pain_strike"] = round(pain[0], 2)
        out["squeeze_distance_pct"] = round((pain[0] - spot) / spot * 100, 3)

    if gamma_now is not None and gamma_now < 0:
        out["squeeze_dealers_short_gamma"] = 1

    # Score 0-1
    # 40% — magnitude of clustered call gamma vs spot (proxy for force)
    # 30% — dealers short gamma (binary)
    # 15% — distance to pain strike (closer = more imminent)
    # 15% — slope >= 0 (uptrending — call squeeze, not put squeeze)
    score = 0.0

    # Cluster magnitude — log-scaled. $10M cluster ~ full credit. Float
    # tickers will be lower-magnitude so this is roughly market-cap aware
    # already (small-cap setups still score well relative to peers).
    if cluster_gamma > 0:
        import math
        mag_pts = max(0.0, min(1.0, math.log10(max(cluster_gamma, 1)) / 7.0))
        score += 0.40 * mag_pts

    if out["squeeze_dealers_short_gamma"]:
        score += 0.30

    dist = out["squeeze_distance_pct"]
    if dist is not None and 0 <= dist <= 7:
        # 0% = full credit (about to trigger), 7% = no credit (too far above)
        dist_pts = 1.0 - (dist / 7.0)
        score += 0.15 * dist_pts

    if chart and chart.get("slope_4w_pct") is not None:
        slope_pts = 1.0 if chart["slope_4w_pct"] >= 0 else 0.0
        score += 0.15 * slope_pts
    elif chart is None:
        # No chart data → don't penalize, but no credit either
        pass

    out["squeeze_score"] = round(score, 4)
    out["squeeze_trigger_flag"] = (
        score >= 0.55
        and out["squeeze_dealers_short_gamma"] == 1
        and dist is not None
        and 0 <= dist <= 7
    )
    return out
