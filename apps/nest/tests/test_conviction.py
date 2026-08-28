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


def test_gate_blocks_single_family_even_when_loud():
    # three signals but all from the flow family -> not independent -> gate blocks
    weights = {"uw_flow": 1.0, "uw_darkpool": 1.0, "uw_lit_flow": 1.0}
    sigs = [_sig("uw_flow"), _sig("uw_darkpool"), _sig("uw_lit_flow")]
    ts = engine.score_ticker("T", sigs, weights)
    assert not ts.passed_gate
    assert "family" in ts.gate_reason


def test_gate_blocks_too_few_signals():
    weights = {"uw_flow": 1.0, "uw_gex": 1.0}
    ts = engine.score_ticker("T", [_sig("uw_flow"), _sig("uw_gex")], weights)
    assert not ts.passed_gate
    assert "agreeing signals" in ts.gate_reason


def test_gate_passes_on_three_signals_two_families():
    weights = {"uw_flow": 1.0, "uw_darkpool": 1.0, "uw_gex": 1.0}
    sigs = [_sig("uw_flow"), _sig("uw_darkpool"), _sig("uw_gex", spot=40.0)]
    ts = engine.score_ticker("T", sigs, weights)
    assert ts.passed_gate, ts.gate_reason
    assert ts.conviction >= 70
    assert ts.direction == "bull"
    assert set(ts.families) == {"flow", "levels"}


def test_opposing_signals_net_out_direction():
    weights = {"uw_flow": 1.0, "uw_darkpool": 1.0, "uw_gex": 1.0, "uw_insider": 1.0}
    sigs = [
        _sig("uw_flow", direction="bear", strength=0.9),
        _sig("uw_darkpool", direction="bear", strength=0.9),
        _sig("uw_gex", direction="bull", strength=0.2),
        _sig("uw_insider", direction="bull", strength=0.2),
    ]
    ts = engine.score_ticker("T", sigs, weights)
    assert ts.direction == "bear"


def test_expired_signal_contributes_nothing():
    weights = {"uw_flow": 1.0, "uw_darkpool": 1.0, "uw_gex": 1.0}
    sigs = [_sig("uw_flow"), _sig("uw_darkpool"), _sig("uw_gex", age_h=100, ttl=48, spot=40.0)]
    ts = engine.score_ticker("T", sigs, weights)
    # the expired gex signal drops -> only 2 live signals -> gate blocks
    assert not ts.passed_gate
