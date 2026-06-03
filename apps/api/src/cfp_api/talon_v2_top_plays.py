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
from datetime import date, datetime
from typing import Any

from cfp_api import talon_scanner, talon_top_plays as v1_picks

log = logging.getLogger(__name__)

TOP_N = 20
TIER_BOUNDS = v1_picks.TIER_BOUNDS  # reuse v1's ITM/ATM/OTM range definitions

# Swing window — the picker prefers expiries in this DTE range. v1 had no
# preference and just picked highest-confidence regardless, which biased to
# the soonest expiries because near-term whales pay the most premium per
# strike. v2 explicitly targets the 1-2 month swing setup.
SWING_DTE_MIN = 25
SWING_DTE_MAX = 75
# Maximum DTE we'll even consider — anything past this is too far out for
# the gates to mean anything.
MAX_DTE = 90


def _parse_expiry(s: Any) -> datetime | None:
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.split("T")[0])
    except (ValueError, AttributeError):
        return None


def _dte_for(expiry: str | None, today: date | None = None) -> int | None:
    if not expiry:
        return None
    exp = _parse_expiry(expiry)
    if exp is None:
        return None
    base = today or date.today()
    return (exp.date() - base).days


def _swing_dte_bonus(dte: int | None) -> float:
    """Confidence bonus 0-25 for expiries in the swing sweet spot.

    Out-of-window (<25 or >75 DTE) → 0 bonus, slight penalty at extremes.
    In-window with peak at 45 DTE → up to +25 score points.
    """
    if dte is None:
        return 0.0
    if dte < SWING_DTE_MIN:
        # Penalize near-term: -10 at 0 DTE, ramping to 0 at SWING_DTE_MIN
        return -10.0 * max(0, (SWING_DTE_MIN - dte) / SWING_DTE_MIN)
    if dte > SWING_DTE_MAX:
        return -5.0 * min(1.0, (dte - SWING_DTE_MAX) / SWING_DTE_MAX)
    # Triangular peak at 45 DTE inside the window
    peak = (SWING_DTE_MIN + SWING_DTE_MAX) / 2
    if dte <= peak:
        return 25.0 * (dte - SWING_DTE_MIN) / (peak - SWING_DTE_MIN)
    return 25.0 * (SWING_DTE_MAX - dte) / (SWING_DTE_MAX - peak)


def _expiry_spans_earnings(expiry: str, earnings_date: str | None) -> bool:
    """True if the earnings date falls on or before the option's expiry."""
    if not earnings_date:
        return False
    exp = _parse_expiry(expiry)
    ed = _parse_expiry(earnings_date)
    if exp is None or ed is None:
        return False
    return ed <= exp


def _swing_adjusted_score(bucket: dict) -> float:
    """v1 confidence score + swing-DTE bonus + max-DTE filter.

    Returns -inf for buckets outside the MAX_DTE cutoff so they get dropped
    rather than picked. In-window buckets get up to +25 score points for
    being in the 25-75 DTE swing sweet spot.
    """
    dte = _dte_for(bucket.get("expiry"))
    if dte is None:
        return v1_picks._confidence_score(bucket)  # noqa: SLF001
    # Drop expired contracts and anything past the swing horizon
    if dte < 0 or dte > MAX_DTE:
        return float("-inf")
    base = v1_picks._confidence_score(bucket)  # noqa: SLF001
    return base + _swing_dte_bonus(dte)


def _pick_for_tier_swing(
    buckets: dict[tuple[float, str], dict],
    price: float,
    tier: str,
) -> dict | None:
    """v2 version of v1's _pick_for_tier — same strike filter, but ranks by
    swing-adjusted score (prefers 25-75 DTE) and drops buckets > MAX_DTE.
    """
    lo_pct, hi_pct = TIER_BOUNDS[tier]
    lo, hi = price * (1 + lo_pct), price * (1 + hi_pct)
    candidates: list[dict] = []
    for key, b in buckets.items():
        if lo <= key[0] <= hi:
            score = _swing_adjusted_score(b)
            if score == float("-inf"):
                continue
            candidates.append((score, b))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def _anchored_standard_pick(
    row: dict,
    buckets: dict,
    price: float,
) -> tuple[dict | None, list[str]]:
    """If a whale-flagged top strike exists, use it as the standard tier anchor.

    Prefers a same-strike bucket in the swing-DTE window over the absolute
    whale_top_expiry — the v2 scanner's "top expiry" is whichever single
    bucket had the most $, which can be a 0-7 DTE weekly. For the swing
    picker we'd rather take the same strike on a 30-75 DTE expiry if one
    exists with meaningful flow.

    Returns (pick_dict_or_None, anchor_notes).
    """
    notes: list[str] = []
    whale_strike = row.get("whale_top_strike")
    whale_expiry = row.get("whale_top_expiry")
    if not row.get("whale_flag") or whale_strike is None or whale_expiry is None:
        return None, notes
    try:
        ws = float(whale_strike)
    except (TypeError, ValueError):
        return None, notes

    # 1. Look for same-strike buckets and rank by swing-adjusted score
    same_strike = [(k, b) for k, b in buckets.items() if k[0] == ws]
    if same_strike:
        ranked = []
        for k, b in same_strike:
            score = _swing_adjusted_score(b)
            if score != float("-inf"):
                ranked.append((score, k, b))
        if ranked:
            ranked.sort(key=lambda x: x[0], reverse=True)
            _, key, bucket = ranked[0]
            pick = v1_picks._bucket_to_contract_pick(bucket, "atm", price)  # noqa: SLF001
            dte = _dte_for(bucket.get("expiry"))
            chosen_expiry = key[1]
            if chosen_expiry != whale_expiry:
                notes.append(
                    f"anchored to whale strike ${ws}; preferred swing expiry "
                    f"{chosen_expiry} ({dte}d) over whale's near-term {whale_expiry}"
                )
            else:
                notes.append(
                    f"anchored to whale concentration (${row.get('whale_top_strike_prem', 0):,.0f} "
                    f"on this strike, conc {(row.get('whale_concentration_pct') or 0) * 100:.0f}%, "
                    f"{dte}d to expiry)"
                )
            return pick, notes
    return None, notes


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
        # max_dte=75 — pull the swing window (1-2 month expiries) so the
        # picker has real swing candidates. UW default is 35 (too short).
        alerts = client.flow_alerts_for_ticker(ticker, max_dte=75) or []
        walls = v1_picks._identify_walls(strike_rows, price)  # noqa: SLF001
        buckets = v1_picks._aggregate_alerts(alerts)  # noqa: SLF001

        # Whale-anchored standard tier (already swing-aware)
        anchored, anchor_notes = _anchored_standard_pick(s, buckets, price)

        picks: list[dict] = []
        for tier in ("itm", "atm", "otm"):
            if tier == "atm" and anchored is not None:
                pick = anchored
                # Surface anchor explanation on the pick
                pick.setdefault("evidence", {})["v2_anchor_notes"] = anchor_notes
            else:
                # Use the swing-DTE-preferring picker (drops >90 DTE, bonuses 25-75)
                bucket = _pick_for_tier_swing(buckets, price, tier)
                if bucket is not None:
                    pick = v1_picks._bucket_to_contract_pick(bucket, tier, price)  # noqa: SLF001
                else:
                    pick = v1_picks._empty_tier_pick(  # noqa: SLF001
                        tier,
                        "no swing-window UW backing in this strike range — grade-only conviction",
                    )
            # Annotate DTE on every pick so the UI can show it + sanity-check
            pick["dte"] = _dte_for(pick.get("expiry"))
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
