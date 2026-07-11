from datetime import UTC, datetime, timedelta

from athena import config
from athena.reasoning.thesis import Thesis
from athena.risk import gatekeeper


def _thesis(**kw):
    base = dict(
        ticker="SPY", direction="long", regime_read="squeeze", catalyst="flip reclaim",
        structure="SPY 0DTE call", conviction=0.8, entry_zone="620.5",
        exit_nodes="622 wall", invalidation="below 619.4", size_guidance="2% risk",
        rationale="test", cited_sources=[],
    )
    base.update(kw)
    return Thesis(**base)


def _now():
    return datetime.now(UTC)


def test_approves_clean_thesis(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "KILL_FILE", tmp_path / "KILL")
    v = gatekeeper.check(_thesis(), _now().isoformat(), alerts_today=0)
    assert v.approved and not v.reasons


def test_conviction_floor():
    v = gatekeeper.check(_thesis(conviction=0.4), _now().isoformat(), alerts_today=0)
    assert not v.approved
    assert any("conviction" in r for r in v.reasons)


def test_daily_cap():
    v = gatekeeper.check(_thesis(), _now().isoformat(),
                         alerts_today=config.MAX_ALERTS_PER_DAY)
    assert not v.approved


def test_staleness_circuit_breaker():
    stale = (_now() - timedelta(seconds=config.DATA_STALENESS_MAX_S + 60)).isoformat()
    v = gatekeeper.check(_thesis(), stale, alerts_today=0)
    assert not v.approved
    assert any("stale" in r for r in v.reasons)


def test_kill_switch(tmp_path, monkeypatch):
    kill_file = tmp_path / "KILL"
    kill_file.write_text("x")
    monkeypatch.setattr(config, "KILL_FILE", kill_file)
    v = gatekeeper.check(_thesis(), _now().isoformat(), alerts_today=0)
    assert not v.approved
    assert any("kill" in r for r in v.reasons)


def test_stand_aside_never_alerts():
    v = gatekeeper.check(_thesis(direction="stand_aside"), _now().isoformat(), alerts_today=0)
    assert not v.approved


def test_missing_invalidation_rejected():
    v = gatekeeper.check(_thesis(invalidation="  "), _now().isoformat(), alerts_today=0)
    assert not v.approved
