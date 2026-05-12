"""Unit tests for the forward-return scorer + hit classifier.

These don't need a DB — they exercise the pure logic that decides whether
a (signal, forward_return) pair counts as a hit, miss, or no-call.
"""

from __future__ import annotations

from cfp_jobs.eval_agents import HIT_THRESHOLD, _hit_for_signal


def test_bullish_hit_above_threshold() -> None:
    assert _hit_for_signal("bullish", HIT_THRESHOLD * 2) is True


def test_bullish_miss_below_threshold() -> None:
    assert _hit_for_signal("bullish", -HIT_THRESHOLD * 2) is False


def test_bullish_noise_returns_none() -> None:
    # Move smaller than threshold — insufficient signal to grade.
    assert _hit_for_signal("bullish", HIT_THRESHOLD / 2) is None


def test_bearish_hit_below_threshold() -> None:
    assert _hit_for_signal("bearish", -HIT_THRESHOLD * 3) is True


def test_neutral_hit_in_noise_band() -> None:
    # Neutral "hits" when the price stayed within +/- threshold.
    assert _hit_for_signal("neutral", HIT_THRESHOLD / 4) is True
    assert _hit_for_signal("neutral", -HIT_THRESHOLD / 4) is True


def test_neutral_miss_on_real_move() -> None:
    assert _hit_for_signal("neutral", HIT_THRESHOLD * 3) is False


def test_unknown_signal_returns_none() -> None:
    assert _hit_for_signal("avoid", 0.05) is None
    assert _hit_for_signal("", 0.05) is None


def test_none_return_propagates() -> None:
    assert _hit_for_signal("bullish", None) is None
