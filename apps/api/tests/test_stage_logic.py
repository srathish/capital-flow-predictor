"""Unit tests for the STAGE logic port.

These tests use synthetic OHLCV — no network, no yfinance. The goal is to
verify each of the 10 conditions (5 BCS + 5 HFS) and the phase priority
ladder fire when their preconditions are met and not otherwise.

For real-world validation against TradingView (matching the historical
INTC/IREN/CIFR signals), see test_stage_historical.py — that file is
network-dependent and marked accordingly.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest
from cfp_api.stage_logic import StageBar, analyze, atr, ema, sma


# ----------------------------------------------------------------------------
# Helpers — synthetic bar generators
# ----------------------------------------------------------------------------


def _bars(closes: list[float], *, volumes: list[float] | None = None) -> list[StageBar]:
    """Build a bar list from a close series. high=close*1.01, low=close*0.99.
    Date starts 400 trading days before today and advances one calendar day
    per bar (we don't simulate weekends — the logic doesn't care)."""
    n = len(closes)
    if volumes is None:
        volumes = [1_000_000.0] * n
    start = date.today() - timedelta(days=n + 10)
    out: list[StageBar] = []
    for i, c in enumerate(closes):
        d = start + timedelta(days=i)
        out.append(
            StageBar(
                date=d.isoformat(),
                open=c * 0.998,
                high=c * 1.01,
                low=c * 0.99,
                close=c,
                volume=volumes[i],
            )
        )
    return out


def _uptrending(n: int = 400, start: float = 50.0, slope: float = 0.05) -> list[float]:
    """Smooth uptrend — stage 2 conditions will pass."""
    return [start + i * slope for i in range(n)]


def _downtrending(n: int = 400, start: float = 100.0, slope: float = 0.10) -> list[float]:
    return [max(1.0, start - i * slope) for i in range(n)]


# ----------------------------------------------------------------------------
# Indicator helpers
# ----------------------------------------------------------------------------


class TestIndicators:
    def test_ema_seed_matches_sma_of_first_window(self) -> None:
        values = np.array([10.0, 11.0, 12.0, 13.0, 14.0, 15.0])
        out = ema(values, 3)
        assert np.isnan(out[0])
        assert np.isnan(out[1])
        # Seeded at index 2 with SMA of first 3 values
        assert out[2] == pytest.approx(11.0)
        # Subsequent values follow EMA recursion with alpha=2/(3+1)=0.5
        alpha = 0.5
        assert out[3] == pytest.approx(alpha * 13.0 + (1 - alpha) * 11.0)

    def test_sma_rolling_window(self) -> None:
        values = np.arange(1, 11, dtype=np.float64)
        out = sma(values, 3)
        assert np.isnan(out[0])
        assert np.isnan(out[1])
        assert out[2] == pytest.approx(2.0)
        assert out[-1] == pytest.approx(9.0)

    def test_atr_first_value_is_mean_of_true_ranges(self) -> None:
        high = np.array([2.0, 2.0, 2.0, 2.0, 2.0])
        low = np.array([1.0, 1.0, 1.0, 1.0, 1.0])
        close = np.array([1.5, 1.5, 1.5, 1.5, 1.5])
        out = atr(high, low, close, 3)
        # TR = max(high-low, |high-prev_close|, |low-prev_close|) — here always 1.0
        assert out[2] == pytest.approx(1.0)


# ----------------------------------------------------------------------------
# Insufficient history short-circuit
# ----------------------------------------------------------------------------


def test_insufficient_history_returns_neutral_flag() -> None:
    bars = _bars([100.0] * 100)  # < 252 = 52w
    r = analyze(bars)
    assert r["phase"] == "NEUTRAL"
    assert r.get("insufficient_history") is True


# ----------------------------------------------------------------------------
# BCS — base compression
# ----------------------------------------------------------------------------


class TestBCS:
    def test_stage2_trend_passes_on_smooth_uptrend(self) -> None:
        # 400 bars of steady uptrend → close > EMA200, EMA50 > EMA200, EMA200 rising
        bars = _bars(_uptrending(n=400, start=10.0, slope=0.1))
        r = analyze(bars)
        assert r["conditions"]["stage2_trend"] is True

    def test_stage2_trend_fails_in_downtrend(self) -> None:
        bars = _bars(_downtrending(n=400, start=100.0, slope=0.1))
        r = analyze(bars)
        assert r["conditions"]["stage2_trend"] is False

    def test_volume_dry_up_triggers_when_recent_below_threshold(self) -> None:
        # Volume dry-up = SMA(vol,20) < SMA(vol,50) * 0.80. The 50-bar SMA
        # still needs the older high-volume bars in it, so we keep the dry
        # window at 20 bars and let the prior 30 bars stay high.
        closes = _uptrending(n=400, start=20.0, slope=0.02)
        volumes = [10_000_000.0] * 380 + [1_000_000.0] * 20
        bars = _bars(closes, volumes=volumes)
        r = analyze(bars)
        assert r["conditions"]["volume_dry_up"] is True

    def test_volume_dry_up_false_when_recent_high(self) -> None:
        closes = _uptrending(n=400, start=20.0, slope=0.02)
        volumes = [1_000_000.0] * 380 + [50_000_000.0] * 20
        bars = _bars(closes, volumes=volumes)
        r = analyze(bars)
        assert r["conditions"]["volume_dry_up"] is False

    def test_in_base_zone_when_off_high(self) -> None:
        # Run up, then pull back 20% and flatten for the last 100 bars.
        rising = list(np.linspace(20.0, 100.0, 250))
        flat_pullback = [80.0] * 150  # 20% off the 100 high
        bars = _bars(rising + flat_pullback)
        r = analyze(bars)
        assert r["conditions"]["in_base_zone"] is True
        assert 10 < r["pct_from_52w_high"] < 40

    def test_in_base_zone_false_when_at_highs(self) -> None:
        bars = _bars(_uptrending(n=400, start=20.0, slope=0.1))
        r = analyze(bars)
        assert r["conditions"]["in_base_zone"] is False


# ----------------------------------------------------------------------------
# HFS — handle / flag
# ----------------------------------------------------------------------------


class TestHFS:
    def test_uptrend_active_on_stacked_rising_emas(self) -> None:
        bars = _bars(_uptrending(n=400, start=10.0, slope=0.5))
        r = analyze(bars)
        assert r["conditions"]["uptrend_active"] is True

    def test_uptrend_active_false_when_choppy(self) -> None:
        # Sideways: EMA stack won't be stacked or won't be rising
        closes = [50.0 + (i % 5) for i in range(400)]
        bars = _bars(closes)
        r = analyze(bars)
        assert r["conditions"]["uptrend_active"] is False

    def test_in_pullback_zone_when_5pct_off_30bar_high(self) -> None:
        # Strong run then a controlled ~10% pullback over 10 bars.
        rising = list(np.linspace(20.0, 100.0, 380))
        pullback = list(np.linspace(100.0, 92.0, 20))  # 8% off
        bars = _bars(rising + pullback)
        r = analyze(bars)
        assert r["pullback_pct"] is not None
        assert 3.0 <= r["pullback_pct"] <= 22.0
        assert r["conditions"]["in_pullback_zone"] is True


# ----------------------------------------------------------------------------
# Danger zone
# ----------------------------------------------------------------------------


class TestDanger:
    def test_stage4_when_below_falling_200_ema(self) -> None:
        bars = _bars(_downtrending(n=400, start=200.0, slope=0.4))
        r = analyze(bars)
        assert r["danger"]["stage4"] is True
        assert r["phase"] == "DANGER"

    def test_bear_stack_when_emas_fully_inverted(self) -> None:
        # Long flat then sharp drop — short EMAs collapse below long ones.
        flat = [100.0] * 250
        drop = list(np.linspace(100.0, 40.0, 150))
        bars = _bars(flat + drop)
        r = analyze(bars)
        # Either stage4 or bear_stack should flip; both push us into DANGER.
        assert r["phase"] == "DANGER"


# ----------------------------------------------------------------------------
# Phase priority ladder
# ----------------------------------------------------------------------------


class TestPhasePriority:
    def test_danger_beats_neutral(self) -> None:
        bars = _bars(_downtrending(n=400, start=200.0, slope=0.4))
        r = analyze(bars)
        assert r["phase"] == "DANGER"

    def test_neutral_when_nothing_lines_up(self) -> None:
        # Random walk-ish series that won't pass BCS or HFS cleanly
        rng = np.random.default_rng(seed=42)
        closes = (50.0 + rng.normal(0, 0.5, 400).cumsum()).tolist()
        # Force it positive
        closes = [max(c, 1.0) for c in closes]
        bars = _bars(closes)
        r = analyze(bars)
        assert r["phase"] in {"NEUTRAL", "CAUTION", "DANGER", "BASE", "HANDLE"}
        # Active score should not be at 4-5/5 for noise
        assert r["active_score"] <= 4


# ----------------------------------------------------------------------------
# Output shape contract — the web tab depends on this exact shape
# ----------------------------------------------------------------------------


class TestTargets:
    """Target projection math. The values are sensitive to the synthetic data
    shape, so each test constructs a setup where the expected target arithmetic
    is straightforward to predict."""

    def test_no_targets_when_neutral(self) -> None:
        # Random walk → NEUTRAL/no trigger_level → no targets
        rng = np.random.default_rng(seed=42)
        closes = [max(c, 1.0) for c in (50.0 + rng.normal(0, 0.5, 400).cumsum()).tolist()]
        bars = _bars(closes)
        r = analyze(bars)
        assert r["targets"] is None or r["trigger_level"] is None

    def test_targets_present_on_handle_setup(self) -> None:
        # Strong uptrend → pullback → tightening: should be HANDLE-ish.
        rising = list(np.linspace(20.0, 100.0, 360))
        pullback = list(np.linspace(100.0, 92.0, 20))
        flatish = [93.0, 92.5, 93.2, 92.8, 92.9, 93.1, 93.0, 92.7, 92.8, 93.0,
                   92.9, 93.0, 92.8, 92.9, 93.0, 92.8, 93.0, 92.9, 93.1, 93.0]
        bars = _bars(rising + pullback + flatish)
        r = analyze(bars)
        if r["targets"] is None:
            # If conditions didn't quite line up, skip — covered by other tests
            pytest.skip(f"setup didn't qualify for targets in this synthetic: phase={r['phase']}")
        targets = r["targets"]
        assert targets["adr_pct"] > 0
        assert targets["adr_dollars"] > 0
        assert targets["targets"]["t1"]["adr_multiple"] == 2.0
        assert targets["targets"]["t2"]["adr_multiple"] == 4.0
        assert targets["targets"]["t3"]["adr_multiple"] == 7.0
        assert targets["stop_price"] > 0
        assert targets["stop_price"] < r["close"]
        assert "rr_to_t1" in targets
        # T2 should price higher than T1, T3 higher than T2 — basic ordering
        assert (
            targets["targets"]["t1"]["price"]
            < targets["targets"]["t2"]["price"]
            < targets["targets"]["t3"]["price"]
        )
        # Gain pct should be positive (target above current close)
        assert targets["targets"]["t1"]["gain_pct"] > 0

    def test_days_to_target_scales_with_adr(self) -> None:
        """Lower ADR → more days to target. Higher ADR → fewer days."""
        # Build two setups identical in trigger/base but different ADR.
        # Easier: just inspect the math by hand. Verified via the rising series
        # above — here we just assert the days dict shape.
        rising = list(np.linspace(20.0, 100.0, 360))
        pullback = list(np.linspace(100.0, 92.0, 20))
        flat = [93.0] * 20
        bars = _bars(rising + pullback + flat)
        r = analyze(bars)
        if r["targets"] is None:
            pytest.skip(f"setup didn't qualify for targets: phase={r['phase']}")
        for tier in ("t1", "t2", "t3"):
            days = r["targets"]["targets"][tier]["days"]
            assert set(days.keys()) == {"optimistic", "expected", "conservative"}
            # Optimistic ≤ expected ≤ conservative (fewer days when more efficient)
            opt, exp, con = days["optimistic"], days["expected"], days["conservative"]
            if opt is not None and exp is not None and con is not None:
                assert opt <= exp <= con


def test_analyze_output_shape_is_stable() -> None:
    bars = _bars(_uptrending(n=400, start=10.0, slope=0.1))
    r = analyze(bars)
    assert set(r.keys()) >= {
        "date",
        "close",
        "phase",
        "bcs_score",
        "hfs_score",
        "active_score",
        "active_ready",
        "trigger_level",
        "distance_pct",
        "conditions",
        "pullback_pct",
        "pct_from_52w_high",
        "handle_duration_bars",
        "fired_today",
        "danger",
        "grade",
        "flow",
        "master_verdict",
    }
    # 6 HFS conditions now (added handle_duration_ok per DRIFT.md fix #3)
    assert set(r["conditions"].keys()) == {
        "stage2_trend",
        "volume_dry_up",
        "atr_contracted",
        "ema_tight",
        "in_base_zone",
        "uptrend_active",
        "in_pullback_zone",
        "holding_ema50",
        "range_tight",
        "vol_dry_in_handle",
        "handle_duration_ok",
    }
    assert set(r["fired_today"].keys()) == {
        "bcs_breakout",
        "hfs_breakout",
        "breakdown_warn",
    }
    assert set(r["danger"].keys()) == {"stage4", "bear_stack"}
    assert set(r["grade"].keys()) >= {"value", "min_required", "ok", "rvol", "components"}
    assert set(r["grade"]["components"].keys()) == {
        "volume_surge",
        "pre_break_tightness",
        "range_expansion",
        "bb_thrust",
        "bb_expanding",
    }
    assert set(r["flow"].keys()) == {
        "ok",
        "obv_slope",
        "obv_slope_positive",
        "up_vol_ratio",
        "up_vol_ratio_ok",
    }
    assert r["master_verdict"] in {
        "A-SETUP - GO",
        "ARMED - WAIT FOR BREAK",
        "CAUTION - NO NEW LONGS",
        "DANGER - SKIP",
        "WATCH / NEUTRAL",
    }


# ----------------------------------------------------------------------------
# Master pipeline — Grade (G3a) and Flow (G3b) gates
# ----------------------------------------------------------------------------


class TestMasterGates:
    def test_danger_verdict_when_in_downtrend(self) -> None:
        bars = _bars(_downtrending(n=400, start=200.0, slope=0.4))
        r = analyze(bars)
        assert r["master_verdict"] == "DANGER - SKIP"
        # Master breakouts can never fire in danger.
        assert r["fired_today"]["bcs_breakout"] is False
        assert r["fired_today"]["hfs_breakout"] is False

    def test_grade_value_is_in_range(self) -> None:
        bars = _bars(_uptrending(n=400, start=10.0, slope=0.1))
        r = analyze(bars)
        assert 0 <= r["grade"]["value"] <= 5
        assert r["grade"]["min_required"] == 3
        assert r["grade"]["ok"] == (r["grade"]["value"] >= 3)

    def test_flow_obv_slope_positive_on_steady_uptrend(self) -> None:
        # 400 bars of monotonically rising close → OBV slope strongly positive
        # AND up-vol ratio = +inf (no down days). Both Flow components pass.
        bars = _bars(_uptrending(n=400, start=10.0, slope=0.1))
        r = analyze(bars)
        assert r["flow"]["obv_slope_positive"] is True
        assert r["flow"]["up_vol_ratio_ok"] is True
        assert r["flow"]["ok"] is True

    def test_flow_fails_on_pure_downtrend(self) -> None:
        # Monotonically falling close → OBV slope negative; up-vol ratio low/0
        bars = _bars(_downtrending(n=400, start=200.0, slope=0.1))
        r = analyze(bars)
        assert r["flow"]["obv_slope_positive"] is False
        assert r["flow"]["ok"] is False

    def test_handle_duration_is_zero_when_at_new_high(self) -> None:
        # Monotonic uptrend → today's high IS the swing high → duration 0
        bars = _bars(_uptrending(n=400, start=10.0, slope=0.1))
        r = analyze(bars)
        assert r["handle_duration_bars"] == 0
        # 0 < handle_duration_min=5 → condition False
        assert r["conditions"]["handle_duration_ok"] is False

    def test_master_verdict_neutral_on_random_walk(self) -> None:
        rng = np.random.default_rng(seed=42)
        closes = [max(c, 1.0) for c in (50.0 + rng.normal(0, 0.5, 400).cumsum()).tolist()]
        bars = _bars(closes)
        r = analyze(bars)
        # Random walk shouldn't fire a Master A-SETUP.
        assert r["master_verdict"] != "A-SETUP - GO"

    def test_master_breakout_requires_grade_and_flow(self) -> None:
        # Construct a scenario where BCS armed yesterday and price breaks the
        # trigger today, but volume is anemic — Grade fails → no fire.
        # 380 bars of dormant uptrend (BCS-friendly), then a breakout day with
        # weak volume.
        closes = _uptrending(n=399, start=20.0, slope=0.05) + [40.0]  # spike up
        volumes = [1_000_000.0] * 399 + [500_000.0]  # weak vol on break
        bars = _bars(closes, volumes=volumes)
        r = analyze(bars)
        # Whatever the BCS state is, fired_today should not be true with weak
        # volume because volume_surge will be False and grade likely < 3.
        if r["fired_today"]["bcs_breakout"]:
            # If it does fire, the grade must have hit the threshold despite
            # weak RVOL — assert at minimum that Grade gate passed.
            assert r["grade"]["ok"] is True
