"""Talon v2 Phases 2.2 + 2.3 + 3.1 — short / analyst / insider context.

Each phase extracts one piece of context that helps the trader decide
whether the flow signal is worth acting on:

  Phase 2.2 — short interest / squeeze:
    si_pct_float, days_to_cover, si_change_pct, squeeze_flag

  Phase 2.3 — analyst ratings:
    analyst_consensus_pt, analyst_pt_vs_spot_pct, analyst_recent_upgrades,
    analyst_recent_downgrades, analyst_skew (bull/bear/mixed)

  Phase 3.1 — insider transactions:
    insider_recent_buys_count, insider_recent_buys_total_value,
    insider_cluster_flag (≥3 buys within 30d = signal)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any


def _safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _parse_date(s: Any) -> date | None:
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.split("T")[0]).date()
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Phase 2.2 — short
# ---------------------------------------------------------------------------
def compute_short_signals(payload: dict | None) -> dict:
    out: dict = {
        "si_pct_float": None,
        "days_to_cover": None,
        "si_change_pct": None,
        "squeeze_flag": False,
    }
    if not payload:
        return out
    data = payload.get("data", payload) if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        # Sometimes UW wraps in a list with the latest first
        if isinstance(payload, dict) and isinstance(payload.get("data"), list) and payload["data"]:
            data = payload["data"][0]
        else:
            return out

    out["si_pct_float"] = _safe_float(
        data.get("short_interest_percent_of_float")
        or data.get("percent_of_float")
        or data.get("si_float_pct")
    )
    out["days_to_cover"] = _safe_float(
        data.get("days_to_cover") or data.get("dtc")
    )
    out["si_change_pct"] = _safe_float(
        data.get("si_change_percent") or data.get("change_pct")
    )
    # Squeeze profile: >15% of float short AND >3 days to cover
    if (out["si_pct_float"] or 0) >= 15.0 and (out["days_to_cover"] or 0) >= 3.0:
        out["squeeze_flag"] = True
    return out


# ---------------------------------------------------------------------------
# Phase 2.3 — analyst
# ---------------------------------------------------------------------------
def compute_analyst_signals(payload: dict | None, spot: float | None) -> dict:
    out: dict = {
        "analyst_consensus_pt": None,
        "analyst_pt_vs_spot_pct": None,
        "analyst_recent_upgrades": 0,
        "analyst_recent_downgrades": 0,
        "analyst_skew": "unknown",
    }
    if not payload:
        return out
    data = payload.get("data", payload) if isinstance(payload, dict) else None
    if not isinstance(data, (list, dict)):
        return out

    pts: list[float] = []
    upgrades = 0
    downgrades = 0
    cutoff = datetime.utcnow().date() - timedelta(days=30)
    items = data if isinstance(data, list) else [data]
    for item in items:
        if not isinstance(item, dict):
            continue
        pt = _safe_float(item.get("price_target") or item.get("target"))
        if pt is not None and pt > 0:
            pts.append(pt)
        action = (item.get("action") or item.get("type") or "").lower()
        d = _parse_date(item.get("date") or item.get("rating_date"))
        if d and d >= cutoff:
            if "upgrade" in action or "raised" in action:
                upgrades += 1
            elif "downgrade" in action or "lowered" in action or "cut" in action:
                downgrades += 1

    if pts:
        consensus = sum(pts) / len(pts)
        out["analyst_consensus_pt"] = round(consensus, 2)
        if spot and spot > 0:
            out["analyst_pt_vs_spot_pct"] = round((consensus - spot) / spot * 100, 2)
    out["analyst_recent_upgrades"] = upgrades
    out["analyst_recent_downgrades"] = downgrades
    if upgrades > downgrades + 1:
        out["analyst_skew"] = "bull"
    elif downgrades > upgrades + 1:
        out["analyst_skew"] = "bear"
    elif upgrades or downgrades:
        out["analyst_skew"] = "mixed"
    return out


# ---------------------------------------------------------------------------
# Phase 3.1 — insider
# ---------------------------------------------------------------------------
def compute_insider_signals(payload: dict | None) -> dict:
    out: dict = {
        "insider_recent_buys_count": 0,
        "insider_recent_buys_total_value": 0.0,
        "insider_cluster_flag": False,
    }
    if not payload:
        return out
    data = payload.get("data", payload) if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return out

    cutoff = datetime.utcnow().date() - timedelta(days=30)
    buys: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        tx_type = (item.get("transaction_type") or item.get("type") or "").lower()
        if "buy" not in tx_type and "purchase" not in tx_type and "p" != tx_type:
            continue
        d = _parse_date(item.get("transaction_date") or item.get("date"))
        if d is None or d < cutoff:
            continue
        value = _safe_float(item.get("total_value") or item.get("value"))
        buys.append({"date": d, "value": value or 0.0,
                     "insider": item.get("insider_name") or item.get("filer")})

    out["insider_recent_buys_count"] = len(buys)
    out["insider_recent_buys_total_value"] = round(sum(b["value"] for b in buys), 2)
    # Cluster signal: ≥3 distinct insiders buying within 30 days, total ≥ $250K
    unique_insiders = {b["insider"] for b in buys if b["insider"]}
    if len(unique_insiders) >= 3 and out["insider_recent_buys_total_value"] >= 250_000:
        out["insider_cluster_flag"] = True
    return out
