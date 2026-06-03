"""Talon v2 Phase 4.3 — macro regime overlay.

One DB query per scan reads `macro_regime` table → composite_regime string
(e.g. "uptrend_normal_neutral", "downtrend_high_vol_bearish"). We map each
regime to a per-direction grade multiplier so bullish setups get a boost
when the macro tape supports them and a penalty when it doesn't.

Per scan we attach:

  scan.market_regime              : dict with composite + sub regimes + key indicators
  scan.regime_multipliers         : {bull: float, bear: float} applied to each row's grade

Per ticker:

  market_regime_at_scan           : copy of composite_regime for the row
  regime_grade_multiplier         : the multiplier applied (1.0 = neutral)

The actual grade adjustment is small (±10%) because the macro signal is one
input among many. The effect: in "downtrend_high_vol_bearish", a bullish
flow setup that was 75 grade becomes 67.5 — drops it out of "actionable"
unless the underlying signal is really strong.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from cfp_api.db import get_pool

log = logging.getLogger(__name__)

# Regime multipliers — separate for bull / bear setups
#
# Trend regime drives bull side primarily; vol regime gates aggressive setups;
# macro regime sub-component nudges both.
REGIME_RULES: dict[str, dict[str, float]] = {
    "uptrend":   {"bull": 1.10, "bear": 0.85},
    "neutral":   {"bull": 1.00, "bear": 1.00},
    "downtrend": {"bull": 0.85, "bear": 1.10},
}

VOL_RULES: dict[str, dict[str, float]] = {
    "low":    {"bull": 1.05, "bear": 0.95},
    "normal": {"bull": 1.00, "bear": 1.00},
    "high":   {"bull": 0.90, "bear": 1.10},
}

MACRO_RULES: dict[str, dict[str, float]] = {
    "bullish": {"bull": 1.05, "bear": 0.95},
    "neutral": {"bull": 1.00, "bear": 1.00},
    "bearish": {"bull": 0.95, "bear": 1.05},
}


def _compose_multiplier(
    trend: str | None, vol: str | None, macro: str | None
) -> dict[str, float]:
    """Multiply the per-component rules and clamp the result so a 'perfect storm'
    regime can't bump grades by more than ±20%."""
    bull = 1.0
    bear = 1.0
    for rules, key in ((REGIME_RULES, trend), (VOL_RULES, vol), (MACRO_RULES, macro)):
        if key and key in rules:
            bull *= rules[key]["bull"]
            bear *= rules[key]["bear"]
    return {
        "bull": round(max(0.80, min(1.20, bull)), 4),
        "bear": round(max(0.80, min(1.20, bear)), 4),
    }


async def _load_regime_async() -> dict[str, Any] | None:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT asof_date, composite_regime, vol_regime, trend_regime,
                   macro_regime, vix_close, yield_curve_2_10, dxy_close,
                   fed_funds_rate, spy_close
            FROM macro_regime
            ORDER BY asof_date DESC LIMIT 1
            """
        )
    if not row:
        return None
    return {k: row[k] for k in row.keys()}


def load_regime() -> dict[str, Any] | None:
    try:
        regime = asyncio.run(_load_regime_async())
    except Exception as e:  # noqa: BLE001
        log.warning("v2 macro regime fetch failed: %s", e)
        return None
    if regime is None:
        return None
    multipliers = _compose_multiplier(
        regime.get("trend_regime"),
        regime.get("vol_regime"),
        regime.get("macro_regime"),
    )
    # Serialize the asof_date for JSON safety
    if regime.get("asof_date"):
        regime["asof_date"] = (
            regime["asof_date"].isoformat()
            if hasattr(regime["asof_date"], "isoformat")
            else str(regime["asof_date"])
        )
    regime["multipliers"] = multipliers
    return regime


def apply_regime_to_row(row: dict, regime: dict | None) -> None:
    """Mutate row in place: scale grade by regime multiplier matching direction.

    Records both pre- and post-adjustment grade so the UI can show what changed.
    """
    if not regime or "multipliers" not in regime:
        return
    grade = row.get("grade")
    if grade is None:
        return
    direction = row.get("direction") or "neutral"
    mult = 1.0
    if direction == "bull":
        mult = regime["multipliers"]["bull"]
    elif direction == "bear":
        mult = regime["multipliers"]["bear"]
    if mult == 1.0:
        return
    if "grade_v1" not in row:
        row["grade_v1"] = grade
    row["regime_grade_multiplier"] = mult
    row["market_regime_at_scan"] = regime.get("composite_regime")
    new_grade = max(0.0, min(100.0, round(grade * mult, 1)))
    row["grade"] = new_grade
