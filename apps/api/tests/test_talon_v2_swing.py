"""Unit tests for talon_v2_swing — 1-2 month swing eligibility re-filter."""
from __future__ import annotations

from datetime import date

from cfp_api import talon_v2_swing

SCAN_DATE = date(2026, 6, 18)


def _base_row(**overrides) -> dict:
    """A row that passes every hard gate. Tests flip one field to check
    the gate that field controls."""
    row = {
        "ticker": "TEST",
        "grade": 72.0,
        "whale_top_expiry": "2026-08-12",   # 55 DTE — inside 30-75 swing band
        "whale_top_strike": 50,
        "whale_total_prem_5d": 750_000.0,
        "whale_concentration_pct": 0.45,
        "dte_to_earnings": 30,
        "earnings_risk": "clear",
        "above_20d": 1,
        "above_50d": 1,
        "above_200d": 1,
        "coiled": False,
        "pattern": None,
    }
    row.update(overrides)
    return row


# ---------------------------------------------------------------------------
# Hard gates
# ---------------------------------------------------------------------------

def test_baseline_row_is_eligible() -> None:
    sig = talon_v2_swing.compute_swing_signals(_base_row(), SCAN_DATE)
    assert sig["swing_eligible"] is True
    assert sig["swing_blockers"] == []
    assert sig["swing_score"] > 0.5
    assert sig["swing_dte_strike"] == 55
    # 55 DTE is in the ride window (30-60) -> target = whale's expiry
    assert sig["swing_target_dte"] == 55


def test_short_expiry_blocks_eligibility() -> None:
    # 20-day expiry — way too short for swing
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(whale_top_expiry="2026-07-08"), SCAN_DATE
    )
    assert sig["swing_eligible"] is False
    assert any("too_short" in b for b in sig["swing_blockers"])


def test_long_expiry_blocks_eligibility() -> None:
    # 92-day expiry — past the 1-2 month swing ceiling at 75 DTE
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(whale_top_expiry="2026-09-18"), SCAN_DATE
    )
    assert sig["swing_eligible"] is False
    assert any("too_long" in b for b in sig["swing_blockers"])


def test_leaps_expiry_blocks_eligibility() -> None:
    # 365-day LEAPS — well past the ceiling, different trade entirely
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(whale_top_expiry="2027-06-18"), SCAN_DATE
    )
    assert sig["swing_eligible"] is False
    assert any("too_long" in b for b in sig["swing_blockers"])


def test_missing_whale_expiry_blocks() -> None:
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(whale_top_expiry=None), SCAN_DATE
    )
    assert sig["swing_eligible"] is False
    assert "no_whale_expiry" in sig["swing_blockers"]


def test_low_whale_premium_blocks() -> None:
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(whale_total_prem_5d=50_000.0), SCAN_DATE
    )
    assert sig["swing_eligible"] is False
    assert any("low_whale_prem" in b for b in sig["swing_blockers"])


def test_imminent_earnings_blocks() -> None:
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(earnings_risk="imminent", dte_to_earnings=3), SCAN_DATE
    )
    assert sig["swing_eligible"] is False
    assert any("earnings_imminent" in b for b in sig["swing_blockers"])


def test_broken_structure_blocks() -> None:
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(above_20d=0, above_50d=0, above_200d=0, coiled=False, pattern=None),
        SCAN_DATE,
    )
    assert sig["swing_eligible"] is False
    assert "structure_broken" in sig["swing_blockers"]


def test_coiled_pattern_saves_structure() -> None:
    # Below all MAs but coiled — the base-building case should still pass
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(above_20d=0, above_50d=0, above_200d=0, coiled=True), SCAN_DATE
    )
    assert sig["swing_eligible"] is True


def test_low_grade_blocks() -> None:
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(grade=42.0), SCAN_DATE
    )
    assert sig["swing_eligible"] is False
    assert any("low_grade" in b for b in sig["swing_blockers"])


# ---------------------------------------------------------------------------
# Scoring & target DTE
# ---------------------------------------------------------------------------

def test_score_increases_with_bonus_signals() -> None:
    base = talon_v2_swing.compute_swing_signals(_base_row(), SCAN_DATE)
    bonus_row = _base_row(
        dp_block_flag=True, news_flag=True, insider_cluster_buy=True
    )
    bonus = talon_v2_swing.compute_swing_signals(bonus_row, SCAN_DATE)
    assert bonus["swing_score"] > base["swing_score"]


def test_score_increases_with_concentration() -> None:
    spread = talon_v2_swing.compute_swing_signals(
        _base_row(whale_concentration_pct=0.10), SCAN_DATE
    )
    concentrated = talon_v2_swing.compute_swing_signals(
        _base_row(whale_concentration_pct=0.85), SCAN_DATE
    )
    assert concentrated["swing_score"] > spread["swing_score"]


def test_target_dte_rides_whale_strike_in_window() -> None:
    """Whale at 45 DTE — in the 30-60 ride window. Target = exact whale DTE."""
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(whale_top_expiry="2026-08-02"),  # 45 DTE
        SCAN_DATE,
    )
    assert sig["swing_target_dte"] == 45


def test_target_dte_defaults_when_whale_too_far() -> None:
    """Whale at 70 DTE — still eligible (under 75 ceiling) but past the
    60-DTE ride window, so we default to SWING_TARGET_DTE."""
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(whale_top_expiry="2026-08-27"),  # 70 DTE
        SCAN_DATE,
    )
    assert sig["swing_eligible"] is True
    assert sig["swing_target_dte"] == talon_v2_swing.SWING_TARGET_DTE


def test_catalyst_window_peaks_around_30d() -> None:
    """The triangular catalyst-window function should peak around 30 DTE."""
    sig_at_peak = talon_v2_swing.compute_swing_signals(
        _base_row(dte_to_earnings=30), SCAN_DATE
    )
    sig_far = talon_v2_swing.compute_swing_signals(
        _base_row(dte_to_earnings=55), SCAN_DATE
    )
    sig_close = talon_v2_swing.compute_swing_signals(
        _base_row(dte_to_earnings=15), SCAN_DATE
    )
    # 30-DTE catalyst should score >= near-the-edges cases
    assert sig_at_peak["swing_score"] >= sig_far["swing_score"]
    assert sig_at_peak["swing_score"] >= sig_close["swing_score"]


def test_no_catalyst_data_gives_partial_credit() -> None:
    """No earnings info should not zero-out the score — partial credit."""
    sig = talon_v2_swing.compute_swing_signals(
        _base_row(dte_to_earnings=None, earnings_risk="unknown"), SCAN_DATE
    )
    # Still eligible (no hard gate on catalyst presence), just lower score
    assert sig["swing_eligible"] is True


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------

def test_rank_orders_by_score_desc_and_filters_ineligible() -> None:
    rows = [
        {**_base_row(ticker="A"), **talon_v2_swing.compute_swing_signals(_base_row(), SCAN_DATE)},
        {
            **_base_row(ticker="B", grade=42.0),
            **talon_v2_swing.compute_swing_signals(_base_row(grade=42.0), SCAN_DATE),
        },
        {
            **_base_row(ticker="C", whale_total_prem_5d=2_500_000.0,
                        dp_block_flag=True, news_flag=True),
            **talon_v2_swing.compute_swing_signals(
                _base_row(whale_total_prem_5d=2_500_000.0,
                          dp_block_flag=True, news_flag=True),
                SCAN_DATE,
            ),
        },
    ]
    ranked = talon_v2_swing.rank_swing_setups(rows)
    tickers = [r["ticker"] for r in ranked]
    # B excluded (low grade), C ranks above A (more $$ + bonuses)
    assert "B" not in tickers
    assert tickers[0] == "C"
    assert tickers[1] == "A"


def test_rank_respects_min_score_threshold() -> None:
    rows = [
        {**_base_row(), **talon_v2_swing.compute_swing_signals(_base_row(), SCAN_DATE)},
    ]
    # Set min score absurdly high — nothing should pass
    ranked = talon_v2_swing.rank_swing_setups(rows, min_score=0.99)
    assert ranked == []
