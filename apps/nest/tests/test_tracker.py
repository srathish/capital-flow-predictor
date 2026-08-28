"""Tracker: grading matures calls, per-source rollup drives weights, calibration buckets."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from nest.engine import weights as wmod
from nest.events.log import EventLog
from nest.events.schema import Call
from nest.tracker import grader


@pytest.fixture()
def log(tmp_path):
    el = EventLog(db_path=tmp_path / "nest.db")
    yield el
    el.close()


def _old_call(days_ago, ticker="IREN", conviction=82, ref=100.0, direction="bull", sources=None):
    ts = (datetime.now(UTC) - timedelta(days=days_ago)).isoformat(timespec="seconds")
    signals = [{"source": s, "direction": direction} for s in (sources or ["uw_flow", "uw_gex"])]
    return Call(ts=ts, ticker=ticker, conviction=conviction, direction=direction,
                ref_price=ref, signals=signals)


def test_grade_due_matures_and_is_idempotent(log):
    log.append(_old_call(days_ago=2))  # matured at 1d, not 5d/20d
    price_fn = grader.PriceFn(lambda t, d: 110.0)  # +10% -> bull hit
    written = grader.grade_due(log, price_fn)
    horizons = {g.horizon for g in written if not g.source}
    assert horizons == {"1d"}
    # per-source grades written too
    assert any(g.source == "uw_flow" and g.horizon == "1d" for g in written)
    # re-running writes nothing new (idempotent)
    assert grader.grade_due(log, price_fn) == []


def test_grade_hit_direction(log):
    log.append(_old_call(days_ago=2, direction="bear", ref=100.0))
    price_fn = grader.PriceFn(lambda t, d: 90.0)  # down -> bear hit
    written = grader.grade_due(log, price_fn)
    call_grade = next(g for g in written if not g.source and g.horizon == "1d")
    assert call_grade.hit is True
    assert call_grade.return_pct == -10.0


def test_source_weight_moves_off_prior_after_hits(log):
    # five matured winning calls all crediting uw_insider
    for i in range(5):
        log.append(_old_call(days_ago=2, ticker=f"T{i}", sources=["uw_insider"]))
    grader.grade_due(log, grader.PriceFn(lambda t, d: 130.0))
    live = wmod.compute_all(log, "1d")
    prior = 0.55  # uw_insider prior
    # 5 hits shrunk against prior*K -> weight should rise above the prior
    assert live["uw_insider"] > prior


def test_calibration_buckets(log):
    # two 80-90 calls, one hits one misses -> 50% at 5d
    log.append(_old_call(days_ago=8, ticker="A", conviction=85, ref=100.0))
    log.append(_old_call(days_ago=8, ticker="B", conviction=88, ref=100.0))
    prices = {"A": 120.0, "B": 90.0}
    grader.grade_due(log, grader.PriceFn(lambda t, d: prices[t]))
    cal = grader.calibration(log, "5d")
    assert cal.buckets["80-90"]["n"] == 2
    assert cal.buckets["80-90"]["hit_rate"] == 0.5
    note = grader.calibration_note(log, 86, "5d")
    assert "50%" in note
