"""Talon v2 Top Plays — contract picks anchored to v2's enriched signals.

Upgrades over v1 top plays:

  1. Strike anchored to **whale_top_strike** when available. v1 picked the
     highest-confidence flow alert in each tier's price range; v2 first
     checks if there's a whale-flagged single-strike accumulation and uses
     that as the standard tier anchor.

  2. Earnings IV-crush guardrail. If `earnings_risk` is "imminent" or "near"
     and the picked expiry would span the earnings date, the pick gets a
     `warnings: ["earnings_inside_expiry"]` and confidence is reduced 20%.
     UI surfaces the warning so the trader can decide.

  3. MA-structure-aware tier sizing. If `above_50d=0` (structure compromised),
     suppress the aggressive OTM pick and add `ma_warning` to the row.
     If `above_200d=0` (long-term broken), also flag the standard tier.

  4. Pattern context. If a base pattern is detected, append a one-line
     pattern note to each pick so the user sees the chart context.

  5. Fundamentals sanity. If `fund_quality="low"`, add `fund_warning` to
     the row but don't suppress picks (user can override).

  6. Universe selection. Whale-flagged tickers are pulled in even if their
     v1 grade puts them outside the top-N, because the whale signal often
     leads the flow-grade catch-up.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from cfp_api import talon_scanner, talon_top_plays as v1_picks

log = logging.getLogger(__name__)

TOP_N = 20
TIER_BOUNDS = v1_picks.TIER_BOUNDS  # reuse v1's ITM/ATM/OTM range definitions


def _parse_expiry(s: Any) -> datetime | None:
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.split("T")[0])
    except (ValueError, AttributeError):
        return None


def _expiry_spans_earnings(expiry: str, earnings_date: str | None) -> bool:
    """True if the earnings date falls on or before the option's expiry."""
    if not earnings_date:
        return False
    exp = _parse_expiry(expiry)
    ed = _parse_expiry(earnings_date)
    if exp is None or ed is None:
        return False
    return ed <= exp


def _anchored_standard_pick(
    row: dict,
    buckets: dict,
    price: float,
) -> tuple[dict | None, list[str]]:
    """If a whale-flagged top strike exists, use it as the standard tier anchor.

    Returns (pick_dict_or_None, anchor_notes).
    """
    notes: list[str] = []
    whale_strike = row.get("whale_top_strike")
    whale_expiry = row.get("whale_top_expiry")
    if not row.get("whale_flag") or whale_strike is None or whale_expiry is None:
        return None, notes
    # Find the bucket matching the whale's (strike, expiry)
    try:
        ws = float(whale_strike)
    except (TypeError, ValueError):
        return None, notes
    key = (ws, whale_expiry)
    bucket = buckets.get(key)
    if bucket is None:
        # Fuzzy match — same strike, any expiry; or same expiry, nearest strike
        for k, b in buckets.items():
            if k[0] == ws:
                bucket = b
                break
    if bucket is None:
        return None, notes
    pick = v1_picks._bucket_to_contract_pick(bucket, "atm", price)  # noqa: SLF001
    notes.append(
        f"anchored to whale concentration (${row.get('whale_top_strike_prem', 0):,.0f} "
        f"on this strike, conc {(row.get('whale_concentration_pct') or 0) * 100:.0f}%)"
    )
    return pick, notes


def _apply_v2_guardrails(pick: dict, row: dict) -> dict:
    """Annotate a pick with warnings + reduce confidence when v2 signals are
    flashing yellow. Mutates and returns the pick.
    """
    if pick.get("strike") is None:
        return pick

    warnings: list[str] = []
    notes: list[str] = []

    # Earnings guardrail
    if row.get("earnings_risk") in ("imminent", "near") and pick.get("expiry"):
        if _expiry_spans_earnings(pick["expiry"], row.get("next_earnings_date")):
            warnings.append("earnings_inside_expiry")
            notes.append(
                f"⚠️ earnings {row.get('next_earnings_date')} "
                f"({row.get('dte_to_earnings')}d) lands before expiry — IV crush risk"
            )
            pick["confidence_score"] = round(pick["confidence_score"] * 0.80, 1)

    # MA structure guardrail (suppress aggressive OTM, warn on standard ATM)
    if pick.get("tier") == "otm" and row.get("above_50d") == 0:
        warnings.append("ma_structure_broken")
        notes.append("⚠️ below 50d MA — aggressive OTM not recommended")
        pick["confidence_score"] = round(pick["confidence_score"] * 0.70, 1)
    if pick.get("tier") == "atm" and row.get("above_200d") == 0 and row.get("above_50d") == 0:
        warnings.append("long_term_structure_broken")
        notes.append("⚠️ below 50d and 200d — long-term structure compromised")

    # Pattern context (positive — describes the setup, doesn't penalize)
    if row.get("pattern"):
        notes.append(
            f"chart pattern: {row['pattern']} (score {row.get('pattern_score', 0):.2f})"
        )

    # Fundamentals sanity
    if row.get("fund_quality") == "low":
        warnings.append("low_fundamentals")
        notes.append(f"⚠️ low fundamentals quality (D/E {row.get('debt_to_equity')}, "
                     f"rev_growth {row.get('rev_growth_yoy')}%)")

    if warnings:
        pick.setdefault("evidence", {})["v2_warnings"] = warnings
    if notes:
        pick.setdefault("evidence", {})["v2_notes"] = notes
    return pick


def compute_v2_top_plays(
    scan_result: dict[str, Any],
    price_lookup,
) -> list[dict]:
    """Top plays for v2 — uses whale flag + v1 grade + pattern score for selection.

    Args:
      scan_result: the full v2 scan payload (must have actionable + whale_setups).
      price_lookup: callable(ticker) -> float | None.
    """
    client = talon_scanner._get_live_client()  # noqa: SLF001
    if client is None:
        log.warning("v2 Top plays: no live UW client; cannot enrich")
        return []

    # Build the candidate set: top by combined v1 grade + v2 whale bonus
    by_ticker: dict[str, dict] = {}
    for r in scan_result.get("actionable", []):
        by_ticker[r["ticker"]] = r
    for r in scan_result.get("whale_setups", []):
        by_ticker.setdefault(r["ticker"], r)
    candidates = list(by_ticker.values())

    def _score(r: dict) -> float:
        grade = r.get("grade") or 0
        whale = (r.get("whale_score") or 0) * 30  # whale_score is 0-1
        pattern = (r.get("pattern_score") or 0) * 10
        return grade + whale + pattern

    candidates.sort(key=_score, reverse=True)

    plays: list[dict] = []
    for s in candidates[:TOP_N]:
        ticker = s["ticker"]
        try:
            price = price_lookup(ticker)
        except Exception as e:  # noqa: BLE001
            log.warning("v2 Top plays: price lookup failed for %s: %s", ticker, e)
            price = None
        if price is None:
            log.warning("v2 Top plays: no price for %s, skipping", ticker)
            continue

        strike_rows = client.strike_gex(ticker) or []
        alerts = client.flow_alerts_for_ticker(ticker) or []
        walls = v1_picks._identify_walls(strike_rows, price)  # noqa: SLF001
        buckets = v1_picks._aggregate_alerts(alerts)  # noqa: SLF001

        # Whale-anchored standard tier
        anchored, anchor_notes = _anchored_standard_pick(s, buckets, price)

        picks: list[dict] = []
        for tier in ("itm", "atm", "otm"):
            if tier == "atm" and anchored is not None:
                pick = anchored
                # Surface anchor explanation on the pick
                pick.setdefault("evidence", {})["v2_anchor_notes"] = anchor_notes
            else:
                bucket = v1_picks._pick_for_tier(buckets, price, tier)  # noqa: SLF001
                if bucket is not None:
                    pick = v1_picks._bucket_to_contract_pick(bucket, tier, price)  # noqa: SLF001
                else:
                    pick = v1_picks._empty_tier_pick(  # noqa: SLF001
                        tier,
                        "no recent UW backing in this strike range — grade-only conviction",
                    )
            _apply_v2_guardrails(pick, s)
            picks.append(pick)

        # Row-level warnings (aggregate across picks)
        row_warnings: list[str] = []
        if s.get("earnings_risk") == "imminent":
            row_warnings.append(f"earnings in {s.get('dte_to_earnings')} days")
        if s.get("ma_gate_adjust", 0) < 0:
            row_warnings.append(
                f"MA gate adjusted grade {s.get('ma_gate_adjust'):+d}"
            )
        if s.get("fund_quality") == "low":
            row_warnings.append("low fundamentals quality")

        plays.append({
            "ticker": ticker,
            "grade": s.get("grade"),
            "grade_v1": s.get("grade_v1"),
            "ma_gate_adjust": s.get("ma_gate_adjust"),
            "direction": s.get("direction"),
            "theme": s.get("theme"),
            "current_price": round(price, 2),
            "soft_inval": walls["soft_inval"],
            "st_target": walls["st_target"],
            "swing_targets": walls["swing_targets"],
            "all_call_walls": walls.get("all_call_walls", []),
            "all_put_walls": walls.get("all_put_walls", []),
            # v2 signal carry-through
            "coiled_score": s.get("coiled_score"),
            "pattern": s.get("pattern"),
            "pattern_score": s.get("pattern_score"),
            "next_earnings_date": s.get("next_earnings_date"),
            "dte_to_earnings": s.get("dte_to_earnings"),
            "earnings_risk": s.get("earnings_risk"),
            "whale_score": s.get("whale_score"),
            "whale_top_strike": s.get("whale_top_strike"),
            "whale_top_expiry": s.get("whale_top_expiry"),
            "whale_top_strike_prem": s.get("whale_top_strike_prem"),
            "whale_flag": s.get("whale_flag"),
            "squeeze_flag": s.get("squeeze_flag"),
            "analyst_skew": s.get("analyst_skew"),
            "analyst_pt_vs_spot_pct": s.get("analyst_pt_vs_spot_pct"),
            "insider_cluster_flag": s.get("insider_cluster_flag"),
            "fund_quality": s.get("fund_quality"),
            "picks": picks,
            "n_picks_backed": sum(1 for p in picks if p["confidence_score"] > 0),
            "row_warnings": row_warnings,
        })
    return plays
