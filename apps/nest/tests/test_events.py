"""Event spine: append, dedupe within TTL, hydrate, and query."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from nest.events.log import EventLog
from nest.events.schema import Call, Grade, Signal


@pytest.fixture()
def log(tmp_path):
    el = EventLog(db_path=tmp_path / "nest.db")
    yield el
    el.close()


def test_append_and_tail(log):
    sig = Signal(source="uw_flow", ticker="IREN", strength=0.5)
    assert log.append(sig) is not None
    tail = log.tail(10)
    assert len(tail) == 1
    assert isinstance(tail[0], Signal)
    assert tail[0].ticker == "IREN"


def test_dedupe_within_ttl(log):
    ts = datetime.now(UTC).isoformat(timespec="seconds")
    s1 = Signal(source="uw_darkpool", ticker="MU", strength=0.4, ttl_hours=48,
                ts=ts, meta={"price_level": 37.4, "print_size": 1_000_000})
    s2 = s1.model_copy()  # identical -> same dedupe hash
    assert log.append(s1) is not None
    assert log.append(s2) is None  # deduped
    # a different meta is a distinct observation
    s3 = s1.model_copy(update={"meta": {"price_level": 38.0, "print_size": 1_000_000}})
    assert log.append(s3) is not None


def test_dedupe_expires_after_ttl(log):
    old = (datetime.now(UTC) - timedelta(hours=50)).isoformat(timespec="seconds")
    now = datetime.now(UTC).isoformat(timespec="seconds")
    meta = {"price_level": 10.0}
    s_old = Signal(source="uw_flow", ticker="X", strength=0.3, ttl_hours=48, ts=old, meta=meta)
    s_new = Signal(source="uw_flow", ticker="X", strength=0.3, ttl_hours=48, ts=now, meta=meta)
    assert log.append(s_old) is not None
    # the old one is outside the new one's TTL window -> not deduped
    assert log.append(s_new) is not None


def test_calls_and_grades_roundtrip(log):
    call = Call(ticker="IREN", conviction=81, ref_price=37.85, thesis="t")
    log.append(call)
    assert len(log.calls()) == 1
    g = Grade(call_ts=call.ts, ticker="IREN", horizon="5d", ref_price=37.85,
              realized=41.10, return_pct=8.6, hit=True)
    log.append(g)
    assert log.graded_call_ts("5d") == {call.ts}
    assert len(log.grades()) == 1
