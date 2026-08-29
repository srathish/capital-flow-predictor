"""Conviction engine: decay, accumulation, and the convergence gate (the anti-noise core)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from nest.engine import conviction as engine
from nest.events.schema import Signal


def _sig(source, direction="bull", strength=0.9, ttl=48, age_h=0.0, **meta):
    ts = (datetime.now(UTC) - timedelta(hours=age_h)).isoformat(timespec="seconds")
    return Signal(source=source, ticker="T", direction=direction, strength=strength,
                  ttl_hours=ttl, ts=ts, meta=meta)


def test_time_decay_halves_at_half_ttl():
    assert engine.time_decay(0, 48) == 1.0
    assert abs(engine.time_decay(24, 48) - 0.5) < 1e-9  # half-life at ttl/2
    assert engine.time_decay(48, 48) == 0.0  # dead at TTL
    assert engine.time_decay(100, 48) == 0.0


def test_confirmation_only_has_no_direction_and_is_blocked():
    # flow + darkpool + gex are all CONFIRMATION sources — loud, but they don't pick a name.
    # No direction signal -> no conviction -> gate blocks (the core evidence-based rule).
    weights = {"uw_flow": 1.0, "uw_darkpool": 1.0, "uw_gex": 1.0}
    sigs = [_sig("uw_flow"), _sig("uw_darkpool"), _sig("uw_gex", spot=40.0)]
    ts = engine.score_ticker("T", sigs, weights)
    assert not ts.passed_gate
    assert "direction" in ts.gate_reason


def test_direction_source_drives_direction_over_loud_confirmation():
    # bearish flow is loud, but the only DIRECTION source (momentum, bull) sets the call.
    weights = {"uw_flow": 1.0, "uw_darkpool": 1.0, "uw_chart": 1.0}
    sigs = [_sig("uw_flow", direction="bear", strength=0.9),
            _sig("uw_darkpool", direction="bear", strength=0.9),
            _sig("uw_chart", direction="bull", strength=0.8)]
    ts = engine.score_ticker("T", sigs, weights)
    assert ts.direction == "bull"  # momentum drives, not the coin-flip flow


def test_opposing_confirmation_vetoes_conviction():
    # momentum + quality bull; adding opposing (bear) flow should LOWER conviction (veto).
    weights = {"uw_chart": 1.0, "uw_fundamentals": 1.0, "uw_flow": 1.0}
    base = [_sig("uw_chart", strength=0.8), _sig("uw_fundamentals", strength=0.7)]
    clean = engine.score_ticker("T", base, weights)
    vetoed = engine.score_ticker("T", base + [_sig("uw_flow", direction="bear", strength=0.9)], weights)
    assert vetoed.conviction < clean.conviction


def test_strong_direction_stack_gates():
    # momentum + quality + catalyst all agreeing -> real direction, high conviction, passes.
    weights = {"uw_chart": 1.0, "uw_fundamentals": 1.0, "uw_fda": 1.0}
    sigs = [_sig("uw_chart", strength=0.9), _sig("uw_fundamentals", strength=0.8),
            _sig("uw_fda", strength=0.9)]
    ts = engine.score_ticker("T", sigs, weights)
    assert ts.passed_gate, ts.gate_reason
    assert ts.direction == "bull" and ts.conviction >= 70


def test_repolling_same_source_does_not_stack():
    # the same source re-emitting each cycle (drifting meta) must NOT inflate conviction
    weights = {"uw_gex": 1.0, "uw_chart": 1.0, "uw_fundamentals": 1.0}
    base = [_sig("uw_gex", spot=40.0), _sig("uw_chart"), _sig("uw_fundamentals")]
    once = engine.score_ticker("T", base, weights)
    # simulate 10 cycles of re-polling: same 3 sources, slightly newer timestamps
    many = []
    for k in range(10):
        many += [_sig("uw_gex", age_h=0.01 * k, spot=40.0 + k),
                 _sig("uw_chart", age_h=0.01 * k),
                 _sig("uw_fundamentals", age_h=0.01 * k)]
    stacked = engine.score_ticker("T", many, weights)
    # conviction from 30 stacked signals must match ~the 3 distinct sources, not balloon
    assert abs(stacked.conviction - once.conviction) < 2.0
    assert len(stacked.contributors) == 3  # still just 3 distinct sources


def test_expired_signal_contributes_nothing():
    weights = {"uw_flow": 1.0, "uw_darkpool": 1.0, "uw_gex": 1.0}
    sigs = [_sig("uw_flow"), _sig("uw_darkpool"), _sig("uw_gex", age_h=100, ttl=48, spot=40.0)]
    ts = engine.score_ticker("T", sigs, weights)
    # the expired gex signal drops -> only 2 live signals -> gate blocks
    assert not ts.passed_gate
