"""Talon v2 Phase 3.3 — fundamentals overlay.

Pulls a minimal fundamentals snapshot for sanity-filtering — we don't want
the scanner promoting setups on financially impaired names just because
flow looks good. Uses UW's /info endpoint for the headline numbers; falls
back to None for anything missing.

Output:
  market_cap          : in $
  pe_ratio            : trailing P/E
  rev_growth_yoy      : revenue growth YoY %
  gross_margin        : gross margin %
  debt_to_equity      : D/E ratio
  fund_quality        : 'high' / 'mid' / 'low' / 'unknown'

Quality bucket (rough sanity check, not a comprehensive screen):
  high   : rev_growth_yoy > 20 AND gross_margin > 40 AND debt_to_equity < 1.5
  low    : rev_growth_yoy < 0 OR gross_margin < 15 OR debt_to_equity > 3
  mid    : everything between
  unknown: missing data
"""
from __future__ import annotations

from typing import Any


def _safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return v


def compute_fundamentals_signals(payload: dict | None) -> dict:
    out: dict = {
        "market_cap": None,
        "pe_ratio": None,
        "rev_growth_yoy": None,
        "gross_margin": None,
        "debt_to_equity": None,
        "fund_quality": "unknown",
    }
    if not payload:
        return out
    data = payload.get("data", payload) if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return out

    out["market_cap"] = _safe_float(data.get("market_cap") or data.get("marketcap"))
    out["pe_ratio"] = _safe_float(data.get("pe_ratio") or data.get("pe") or data.get("trailing_pe"))
    out["rev_growth_yoy"] = _safe_float(
        data.get("revenue_growth_yoy")
        or data.get("rev_growth_yoy")
        or data.get("revenue_growth")
    )
    out["gross_margin"] = _safe_float(
        data.get("gross_margin") or data.get("gross_margin_pct")
    )
    out["debt_to_equity"] = _safe_float(
        data.get("debt_to_equity") or data.get("d_e") or data.get("de_ratio")
    )

    rg = out["rev_growth_yoy"]
    gm = out["gross_margin"]
    de = out["debt_to_equity"]
    have_data = sum(x is not None for x in (rg, gm, de))
    if have_data == 0:
        out["fund_quality"] = "unknown"
    elif (rg is not None and rg > 20) and (gm is not None and gm > 40) and (de is None or de < 1.5):
        out["fund_quality"] = "high"
    elif (rg is not None and rg < 0) or (gm is not None and gm < 15) or (de is not None and de > 3):
        out["fund_quality"] = "low"
    else:
        out["fund_quality"] = "mid"
    return out
