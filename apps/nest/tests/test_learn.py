"""The learning loop: IC→prior map, trust bar, and the human-gated apply roundtrip (offline)."""

from __future__ import annotations

from pathlib import Path

from nest import config
from nest.learn import proposer


def test_ic_to_prior_monotonic_and_bounded():
    # validated momentum edge (~0.17) lands near its current high prior; no-edge sits low
    assert abs(proposer.ic_to_prior(0.17) - 0.64) < 0.02
    assert proposer.ic_to_prior(0.0) == 0.30
    assert proposer.ic_to_prior(-0.10) < proposer.ic_to_prior(0.10)   # monotonic
    assert 0.20 <= proposer.ic_to_prior(-5) <= proposer.ic_to_prior(5) <= 0.80  # clamped


def test_apply_is_the_human_gate(tmp_path: Path):
    # point config at a scratch dir so we never touch real state
    config.DATA_DIR = tmp_path
    config.PRIOR_OVERRIDES = tmp_path / "prior_overrides.json"
    config.PROPOSALS_FILE = tmp_path / "proposals.json"
    config._OVR_CACHE = (-1.0, {})

    base = config.prior_of("uw_chart")            # code default, unchanged
    rec = {
        "ts": "2026-08-29T17:00:00", "window": "12 dates × 45 names", "sweep": {},
        "status": "pending", "watch": [],
        "proposals": [{
            "source": "uw_chart", "signal": "chart_combo", "current_prior": base,
            "suggested_prior": 0.30, "delta": round(0.30 - base, 2), "mean_ic": -0.10,
            "t_stat": -2.4, "oos": "3/11", "ls_spread": -1.2, "rationale": "test",
        }],
    }
    proposer._write(rec)

    # a proposal alone changes NOTHING — the prior is still the code default
    assert config.prior_of("uw_chart") == base

    applied = proposer.apply(["uw_chart"])
    assert len(applied) == 1
    # only after explicit apply does the override take effect (no redeploy)
    assert config.prior_of("uw_chart") == 0.30
    # and the pending record is cleared
    assert proposer.pending()["proposals"] == []


def test_apply_nothing_when_empty(tmp_path: Path):
    config.DATA_DIR = tmp_path
    config.PROPOSALS_FILE = tmp_path / "proposals.json"
    assert proposer.apply() == []
