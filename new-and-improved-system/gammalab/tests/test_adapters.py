"""Adapter tests against the local vendor files. Skipped when the files are absent (e.g. on another machine)."""
from datetime import timedelta

import pytest

from gammalab.adapters import skylit_replay, uw_m1
from gammalab.contract.calendar import in_session
from gammalab.contract.pairing import pair
from gammalab.contract.store import BarStore

DAY = "2025-12-15"
F = skylit_replay.DATA / f"gex-replay-{DAY}.json"
need = pytest.mark.skipif(not F.exists() or not (uw_m1.M1 / "SPY" / f"{DAY}.json").exists(), reason="vendor files absent")


@need
def test_replay_frames_inside_session_only():
    snaps = skylit_replay.load_day(F)
    assert snaps and all(in_session(s.provider_ts) for s in snaps)
    assert min(s.provider_ts for s in snaps).strftime("%H:%M") == "14:31"   # 09:30 frame (prior-close spot) dropped


@need
def test_replay_front_column_is_session_date():
    assert all(s.expirations[0] == DAY for s in skylit_replay.load_day(F))


@need
def test_replay_available_after_provider():
    assert all(s.available_at - s.provider_ts == timedelta(seconds=60) for s in skylit_replay.load_day(F))


@need
def test_weekend_file_yields_nothing(tmp_path):
    p = tmp_path / "gex-replay-2026-03-14.json"
    p.write_text('{"metadata": {"date": "2026-03-14"}, "frames": [{"timestamp": "2026-03-14T15:00:00Z", "tickers": {}}]}')
    assert skylit_replay.load_day(p) == []


@need
def test_uw_bars_regular_session_and_close_availability():
    bars = uw_m1.load_day("SPY", DAY)
    assert len(bars) == 390
    assert all(b.available_at == b.ts_close == b.ts_open + timedelta(seconds=60) for b in bars)


@need
def test_replay_pairs_with_uw_bars_within_gap():
    bs = BarStore(); bs.add_many(uw_m1.load_day("SPY", DAY))
    snaps = [s for s in skylit_replay.load_day(F, symbols=("SPY",))]
    paired = [pair(s, bs) for s in snaps]
    assert all(b.available_at <= s.available_at for s, b in zip(snaps, paired))


def test_compact_expiry_normalized():
    assert skylit_replay.norm_expiry("20251216") == "2025-12-16"
    assert skylit_replay.norm_expiry("2025-12-16") == "2025-12-16"
