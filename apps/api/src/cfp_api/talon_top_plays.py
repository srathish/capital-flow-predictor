"""Talon Top 20 Plays — turn the ranked board into tradeable contracts.

Takes the top 20 actionable setups from a Talon scan and for each ticker:
  1. Reads current price (UW strike-GEX endpoint includes spot; yfinance fallback)
  2. Identifies key levels from the chain structure:
       - soft_inval     = nearest put wall below price
       - st_target      = nearest call wall above price
       - swing_targets  = next 2 call walls above ST target
  3. Pulls recent ask-side call flow alerts (≤35 DTE, ≥$25K premium)
  4. Aggregates the alerts by (strike, expiry) → "buckets" with total $,
     OI growth, sweep/floor flags, recency
  5. Selects three contract tiers per ticker, **each defensible by actual
     UW data** — defensive ITM, standard ATM-OTM, aggressive OTM lottery:
       - For each tier we filter buckets by strike range (ITM/ATM/OTM)
         relative to current price, then pick the bucket with the highest
         composite confidence score.
       - If no bucket exists for a tier, we surface that explicitly
         ("no recent UW backing — grade-only conviction") rather than
         fabricating a recommendation.

Confidence score per pick (0-100):
  50% — total ask-side $ at this (strike, expiry), log-scaled
  20% — number of distinct alerts (more = building, not one-and-done)
  15% — OI growth from first alert to current
  10% — sweep/floor flag bonus (institutional speed / block size)
   5% — recency (recent alerts dominate older ones)

Each ContractPick carries the evidence dict so the UI can defend WHY the
pick was made.
"""
from __future__ import annotations

import logging
import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from cfp_api import talon_scanner, talon_uw_client as uw_client  # noqa: F401

log = logging.getLogger(__name__)

TOP_N = 20
TIER_BOUNDS = {
    # Strike-to-price ratios — defines what counts as ITM/ATM/OTM for each tier
    "itm": (-0.10, -0.02),   # 2-10% in the money
    "atm": (-0.02, +0.05),   # ATM to 5% OTM
    "otm": (+0.05, +0.20),   # 5-20% OTM
}


def _aggregate_alerts(alerts: list[dict]) -> dict[tuple[float, str], dict]:
    """Group alerts by (strike, expiry). Sum premiums, count alerts, track OI growth."""
    buckets: dict[tuple[float, str], dict] = defaultdict(lambda: {
        "strike": None, "expiry": None,
        "total_ask_side_prem": 0.0,
        "total_premium": 0.0,
        "n_alerts": 0,
        "has_sweep": False, "has_floor": False,
        "first_oi": None, "current_oi": None,
        "first_alert_ts": None, "last_alert_ts": None,
        "iv_latest": None,
        "ask_latest": None, "bid_latest": None,
    })
    for a in alerts:
        try:
            strike = float(a["strike"])
        except (TypeError, ValueError, KeyError):
            continue
        expiry = a.get("expiry")
        if not expiry:
            continue
        key = (strike, expiry)
        b = buckets[key]
        b["strike"] = strike
        b["expiry"] = expiry
        b["total_ask_side_prem"] += float(a.get("total_ask_side_prem") or 0)
        b["total_premium"] += float(a.get("total_premium") or 0)
        b["n_alerts"] += 1
        b["has_sweep"] = b["has_sweep"] or bool(a.get("has_sweep"))
        b["has_floor"] = b["has_floor"] or bool(a.get("has_floor"))
        oi = a.get("open_interest")
        if oi is not None:
            oi = int(oi)
            if b["first_oi"] is None or (b["first_alert_ts"] and a.get("created_at", "") < b["first_alert_ts"]):
                b["first_oi"] = oi
            if b["current_oi"] is None or (b["last_alert_ts"] and a.get("created_at", "") > b["last_alert_ts"]):
                b["current_oi"] = oi
        ts = a.get("created_at")
        if ts:
            if b["first_alert_ts"] is None or ts < b["first_alert_ts"]:
                b["first_alert_ts"] = ts
                if oi is not None:
                    b["first_oi"] = int(oi)
            if b["last_alert_ts"] is None or ts > b["last_alert_ts"]:
                b["last_alert_ts"] = ts
                if oi is not None:
                    b["current_oi"] = int(oi)
        # Track most recent quoted prices for cost estimation
        ask = a.get("ask")
        bid = a.get("bid")
        if ask is not None:
            b["ask_latest"] = float(ask)
        if bid is not None:
            b["bid_latest"] = float(bid)
        iv_e = a.get("iv_end") or a.get("iv_start")
        if iv_e is not None:
            try:
                b["iv_latest"] = float(iv_e)
            except (TypeError, ValueError):
                pass
    return buckets


def _confidence_score(b: dict) -> float:
    """Weighted composite 0-100 — see module docstring."""
    # 50% — ask-side $, log-scaled so $100K caps near full credit
    ask_prem = b["total_ask_side_prem"]
    ask_score = min(50, 50 * math.log10(max(ask_prem, 1)) / math.log10(500_000))

    # 20% — n_alerts (3+ alerts = building, not one-off)
    n_score = min(20, 20 * b["n_alerts"] / 5)

    # 15% — OI growth %
    first_oi, cur_oi = b["first_oi"], b["current_oi"]
    if first_oi and first_oi > 0 and cur_oi is not None:
        growth = (cur_oi - first_oi) / first_oi
        oi_score = min(15, max(0, 15 * growth / 2))  # 200% growth = full credit
    else:
        oi_score = 0

    # 10% — sweep/floor flags
    flag_score = (5 if b["has_sweep"] else 0) + (5 if b["has_floor"] else 0)

    # 5% — recency (last alert within 3 days = full credit)
    last_ts = b["last_alert_ts"]
    if last_ts:
        try:
            ts = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
            now = datetime.now(ts.tzinfo)
            age_days = (now - ts).total_seconds() / 86400
            recency_score = max(0, 5 * (1 - age_days / 7))
        except Exception:
            recency_score = 0
    else:
        recency_score = 0

    return round(ask_score + n_score + oi_score + flag_score + recency_score, 1)


def _identify_walls(strike_rows: list[dict], price: float) -> dict:
    """From per-strike GEX rows, identify the dominant call walls above price
    and put walls below price. Returns soft_inval / st_target / swing_targets.
    """
    if not strike_rows or price <= 0:
        return {"soft_inval": None, "st_target": None, "swing_targets": []}

    parsed = []
    for r in strike_rows:
        try:
            s = float(r.get("strike"))
            cg = float(r.get("call_gamma") or 0)
            pg = float(r.get("put_gamma") or 0)
            parsed.append((s, cg, abs(pg)))
        except (TypeError, ValueError):
            continue
    if not parsed:
        return {"soft_inval": None, "st_target": None, "swing_targets": []}

    # Call walls above price, sorted by strike asc, weighted by call_gamma
    above = [(s, cg) for s, cg, _ in parsed if s > price and cg > 0]
    above.sort(key=lambda x: x[0])
    # Take the top 4 by gamma magnitude, then resort by strike ascending
    above_top = sorted(above, key=lambda x: x[1], reverse=True)[:6]
    above_top.sort(key=lambda x: x[0])
    above_strikes = [round(s, 2) for s, _ in above_top]

    # Put walls below price
    below = [(s, pg) for s, _, pg in parsed if s < price and pg > 0]
    below_top = sorted(below, key=lambda x: x[1], reverse=True)[:3]
    below_top.sort(key=lambda x: x[0], reverse=True)
    below_strikes = [round(s, 2) for s, _ in below_top]

    soft_inval = below_strikes[0] if below_strikes else round(price * 0.97, 2)
    st_target = above_strikes[0] if above_strikes else round(price * 1.05, 2)
    swing_targets = above_strikes[1:4]

    return {
        "soft_inval": soft_inval,
        "st_target": st_target,
        "swing_targets": swing_targets,
        "all_call_walls": above_strikes,
        "all_put_walls": below_strikes,
    }


def _pick_for_tier(
    buckets: dict[tuple[float, str], dict],
    price: float,
    tier: str,
) -> dict | None:
    """Pick the highest-confidence bucket whose strike falls in the tier's range."""
    lo_pct, hi_pct = TIER_BOUNDS[tier]
    lo, hi = price * (1 + lo_pct), price * (1 + hi_pct)
    candidates = [
        (key, b) for key, b in buckets.items()
        if lo <= key[0] <= hi
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda x: _confidence_score(x[1]), reverse=True)
    return candidates[0][1]


def _bucket_to_contract_pick(b: dict, tier: str, price: float) -> dict:
    strike = b["strike"]
    expiry = b["expiry"]
    # Cost estimate: prefer latest ask, else last printed alert price
    cost = b["ask_latest"] or (b["total_premium"] / max(1, b["n_alerts"]) / 100)  # rough
    breakeven = strike + cost
    return {
        "tier": tier,
        "strike": strike,
        "expiry": expiry,
        "cost_estimate": round(cost, 2) if cost else None,
        "breakeven": round(breakeven, 2),
        "breakeven_pct_above_price": round((breakeven - price) / price * 100, 1) if price else None,
        "confidence_score": _confidence_score(b),
        # Evidence dict — defensibility
        "evidence": {
            "total_ask_side_prem": round(b["total_ask_side_prem"]),
            "n_alerts": b["n_alerts"],
            "has_sweep": b["has_sweep"],
            "has_floor": b["has_floor"],
            "first_oi": b["first_oi"],
            "current_oi": b["current_oi"],
            "oi_growth_pct": (
                round((b["current_oi"] - b["first_oi"]) / b["first_oi"] * 100, 1)
                if b["first_oi"] and b["current_oi"] is not None
                else None
            ),
            "first_alert_at": b["first_alert_ts"],
            "last_alert_at": b["last_alert_ts"],
            "iv_latest_pct": round(b["iv_latest"] * 100, 0) if b["iv_latest"] else None,
        },
    }


def _empty_tier_pick(tier: str, reason: str) -> dict:
    return {
        "tier": tier,
        "strike": None, "expiry": None,
        "cost_estimate": None, "breakeven": None,
        "confidence_score": 0,
        "evidence": {"unbacked_reason": reason},
    }


def compute_top_plays(setups: list[dict], price_lookup) -> list[dict]:
    """For each of the top N actionable setups, enrich with levels + 3-tier picks.

    Args:
      setups: list of TalonSetup dicts (already sorted by grade desc).
      price_lookup: callable(ticker) -> float | None. Lets the caller pick
        between DB lookup, yfinance batch, or UW spot.

    Returns: list of TopPlay dicts, length ≤ TOP_N.
    """
    client = talon_scanner._get_live_client()  # shared instance + scoped cache
    if client is None:
        log.warning("Top plays: no live UW client; cannot enrich")
        return []

    plays: list[dict] = []
    for s in setups[:TOP_N]:
        ticker = s["ticker"]
        try:
            price = price_lookup(ticker)
        except Exception as e:  # noqa: BLE001
            log.warning("Top plays: price lookup failed for %s: %s", ticker, e)
            price = None
        if price is None:
            log.warning("Top plays: no price for %s, skipping", ticker)
            continue

        # Pull walls + flow alerts
        strike_rows = client.strike_gex(ticker) or []
        alerts = client.flow_alerts_for_ticker(ticker) or []
        walls = _identify_walls(strike_rows, price)
        buckets = _aggregate_alerts(alerts)

        # Pick three tiers
        picks: list[dict] = []
        for tier in ("itm", "atm", "otm"):
            bucket = _pick_for_tier(buckets, price, tier)
            if bucket is not None:
                picks.append(_bucket_to_contract_pick(bucket, tier, price))
            else:
                picks.append(_empty_tier_pick(
                    tier,
                    "no recent UW backing in this strike range — grade-only conviction",
                ))

        plays.append({
            "ticker": ticker,
            "grade": s["grade"],
            "direction": s["direction"],
            "theme": s["theme"],
            "call_dom_now": s.get("call_dom_now"),
            "dp_skew_pct": s.get("dp_skew_pct"),
            "dp_share_pct": s.get("dp_share_pct"),
            "current_price": round(price, 2),
            "soft_inval": walls["soft_inval"],
            "st_target": walls["st_target"],
            "swing_targets": walls["swing_targets"],
            "all_call_walls": walls.get("all_call_walls", []),
            "all_put_walls": walls.get("all_put_walls", []),
            "picks": picks,
            "n_picks_backed": sum(
                1 for p in picks if p["confidence_score"] > 0
            ),
        })
    return plays
